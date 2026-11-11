import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { askMisTools } from '@/lib/askMisTools';
import { getClaudeSettings, logClaudeUsage } from '@/lib/claudeSettings';
import { getPriceChart, listPriceCharts } from '@/lib/priceChartStore';
import { requirePermission } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST /api/ask { messages: [{ role: 'user' | 'assistant', content: string }, …] }
// "Ask MIS": answers a question about the current company's reports with
// Claude and the read-only tools in src/lib/askMisTools.ts. The reply is
// newline-delimited JSON, so the page can show progress while tools run:
//   { type: 'tool', name, input }   a report being run
//   { type: 'answer', text }        the final answer (markdown)
//   { type: 'error', message }
// Only plain text turns are kept between questions, so earlier tool results
// are not re-sent; Claude runs the reports again when it needs the figures.

const MAX_TURNS = 20;
const MAX_CHARS = 4000;
const MAX_ITERATIONS = 10;

const SYSTEM = `You are "Ask MIS", the assistant inside Megha MIS, a jewellery manufacturer's management information system. You answer questions about the company's factory invoices and the Labour vs Chart report: labour the factories invoiced compared with what the factory price chart says it should cost (metal labour from the Metal Chart, stone setting from the Setting Chart).

Use the tools to get figures; never estimate or invent numbers. Run a report whenever a question needs data, and narrow it with filters (dates, product type, SKU, invoice or jewellery number) when the question names them. Say which filters and date range an answer covers. Amounts are in the chart's currency.

Things to know when reading the reports:
- Report totals cover comparable lines only; NOT_COMPARABLE lines (the chart could not price them) are counted separately with a reason.
- Labour the chart has no rate for (e.g. order opening, filing, findings) is in an invoice's total but not compared.
- Line-level "Setting" labour is setting the invoice did not tie to one stone lot.
- You can only read data. If asked to change anything (invoices, charts, settings), say that it must be done in the ERP or on the relevant MIS page.

Answer concisely in markdown. Use a table for more than a few rows, and keep to the point.`;

type Turn = { role: 'user' | 'assistant'; content: string };

function parseTurns(body: unknown): Turn[] | string {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return 'Ask a question';
  const turns = messages.slice(-MAX_TURNS);
  for (const t of turns) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string' || !t.content.trim()) {
      return 'Messages must be user / assistant text';
    }
    if (t.content.length > MAX_CHARS * 4) return 'A message is too long';
  }
  if (turns[turns.length - 1].role !== 'user') return 'The last message must be the question';
  if (turns[turns.length - 1].content.length > MAX_CHARS) return `Keep a question under ${MAX_CHARS} characters`;
  // The API wants the conversation to start with the user.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns as Turn[];
}

const textOf = (m: BetaMessage) =>
  m.content
    .filter((b): b is Extract<(typeof m.content)[number], { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

export async function POST(request: Request) {
  const denied = await requirePermission('use_ask_mis');
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  const companyId = session?.user?.companyId ?? null;
  if (companyId == null) return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  const company = session?.user?.companies?.find((c) => c.id === companyId)?.name ?? `company ${companyId}`;

  const turns = parseTurns(await request.json().catch(() => null));
  if (typeof turns === 'string') return NextResponse.json({ message: turns }, { status: 400 });

  const { apiKey, model } = await getClaudeSettings();
  if (!apiKey) {
    return NextResponse.json({ message: 'Ask MIS is not set up yet — an admin needs to add the Claude API key under AI Settings.' }, { status: 503 });
  }
  const code = (await listPriceCharts())[0]?.code;
  const chart = code ? await getPriceChart(code) : null;
  if (!chart) return NextResponse.json({ message: 'No factory price chart found' }, { status: 404 });

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  const user = session?.user?.email || session?.user?.name || 'unknown';

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };
      let last: BetaMessage | null = null;
      try {
        const runner = client.beta.messages.toolRunner({
          model,
          max_tokens: 16000,
          max_iterations: MAX_ITERATIONS,
          output_config: { effort: 'medium' },
          // If a safety classifier declines, the API retries on a fallback model instead of failing.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: [
            { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
            {
              type: 'text',
              text: `Today is ${new Date().toISOString().slice(0, 10)}. The user is working in company "${company}". Price chart: ${chart.name} (${chart.currency}).`,
            },
          ],
          tools: askMisTools(companyId, chart, { defaultSettingType: 'PRONG_PAVE', tolerancePct: 5 }),
          messages: turns as BetaMessageParam[],
        });
        for await (const message of runner) {
          last = message;
          usage.requests++;
          usage.input += message.usage.input_tokens;
          usage.output += message.usage.output_tokens;
          usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
          usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
          for (const block of message.content) {
            if (block.type === 'tool_use') send({ type: 'tool', name: block.name, input: block.input });
          }
        }
        if (!last) throw new Error('No reply from Claude');
        if (last.stop_reason === 'refusal') {
          send({ type: 'error', message: 'Claude declined to answer this question. Try rephrasing it.' });
        } else if (last.stop_reason === 'tool_use') {
          send({ type: 'answer', text: `${textOf(last)}\n\n_The question needed more report runs than allowed (${MAX_ITERATIONS}). Try a narrower question._`.trim() });
        } else {
          send({ type: 'answer', text: textOf(last) || '_No answer was returned._' });
        }
      } catch (e) {
        const message =
          e instanceof Anthropic.AuthenticationError
            ? 'The saved Claude API key was rejected — an admin needs to update it under AI Settings.'
            : e instanceof Anthropic.RateLimitError
              ? 'The Claude API is rate limiting requests — try again in a minute.'
              : e instanceof Anthropic.APIError
                ? `Claude API error ${e.status}: ${e.message}`
                : `Something went wrong: ${(e as Error).message}`;
        send({ type: 'error', message });
      } finally {
        await logClaudeUsage({ user, companyId, model: last?.model ?? model, stop: last?.stop_reason ?? null, ...usage }).catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
