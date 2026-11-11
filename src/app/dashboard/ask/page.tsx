'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PaperAirplaneIcon, SparklesIcon } from '@heroicons/react/24/outline';

// Ask MIS: questions about the current company's reports, answered by Claude
// with read-only report tools (src/app/api/ask/route.ts). The conversation
// lives in this page only; switching company starts a new one.

type Turn = { role: 'user' | 'assistant'; content: string; error?: boolean };

const TOOL_TEXT: Record<string, string> = {
  labour_vs_chart_report: 'Running the Labour vs Chart report',
  labour_vs_chart_by_sku: 'Grouping Labour vs Chart by SKU',
  jewellery_job_work_details: 'Looking up job work details',
  setting_not_in_chart: 'Checking stones with no setting chart value',
};

const EXAMPLES = [
  'Summarise labour vs chart for last month',
  'Which 10 jewellery are most over the chart this year?',
  'Which SKUs are consistently over the chart?',
  'Which stone combinations are missing from the setting chart?',
];

// Short description of a tool call's filters, for the progress list.
function describe(input: Record<string, unknown>): string {
  const parts = Object.entries(input)
    .filter(([k, v]) => v != null && v !== '' && k !== 'limit')
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

export default function AskPage() {
  const { data: session } = useSession();
  const companyId = session?.user?.companyId ?? null;
  const company = session?.user?.companies?.find((c) => c.id === companyId)?.name;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTurns([]);
    setProgress([]);
  }, [companyId]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [turns, progress]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = [...turns.filter((t) => !t.error), { role: 'user' as const, content: q }];
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setInput('');
    setProgress([]);
    setBusy(true);
    let answer: Turn | null = null;
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = done ? '' : lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'tool') setProgress((p) => [...p, `${TOOL_TEXT[event.name] ?? event.name}${describe(event.input ?? {})}`]);
          else if (event.type === 'answer') answer = { role: 'assistant', content: event.text };
          else if (event.type === 'error') answer = { role: 'assistant', content: event.message, error: true };
        }
        if (done) break;
      }
      if (!answer) throw new Error('The answer was cut off — try again.');
    } catch (e) {
      answer = { role: 'assistant', content: (e as Error).message, error: true };
    } finally {
      setTurns((t) => [...t, answer!]);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ask MIS</h1>
          <p className="text-sm text-slate-500">
            Questions about {company ?? 'this company'}&apos;s factory invoices and Labour vs Chart, answered by Claude from the same reports. Read-only.
          </p>
        </div>
        {turns.length > 0 && (
          <button
            onClick={() => {
              setTurns([]);
              setProgress([]);
            }}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            New conversation
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {turns.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <p className="text-sm text-slate-600">Try one of these, or ask your own:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => ask(e)} className="px-3 py-1.5 rounded-full text-xs bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100">
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-xl bg-slate-800 text-white px-4 py-2 text-sm whitespace-pre-wrap">{t.content}</div>
            </div>
          ) : (
            <div key={i} className={`rounded-xl border px-4 py-3 text-sm ${t.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200 text-slate-800'}`}>
              {t.error ? (
                t.content
              ) : (
                <div className="space-y-2 overflow-x-auto [&_table]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.content}</ReactMarkdown>
                </div>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <SparklesIcon className="h-4 w-4 animate-pulse text-amber-600" /> Working on it…
            </div>
            {progress.map((p, i) => (
              <div key={i} className="text-xs text-slate-500 pl-6">
                {p}
              </div>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 border-t border-slate-200 pt-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Ask about invoices, labour vs chart, SKUs, jewellery… (Enter to send, Shift+Enter for a new line)"
          className="flex-1 resize-none border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button type="submit" disabled={busy || !input.trim()} className="px-4 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1.5 text-sm">
          <PaperAirplaneIcon className="h-4 w-4" /> Ask
        </button>
      </form>
    </div>
  );
}
