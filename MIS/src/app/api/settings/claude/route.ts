import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { CLAUDE_MODELS, getClaudeSettings, getClaudeSettingsStatus, isClaudeModel, saveClaudeSettings, type ClaudeModel } from '@/lib/claudeSettings';

export const dynamic = 'force-dynamic';

const PERMISSION = 'manage_ai_settings'; // ADMIN only until permissions are loaded into the session

// Checks a key against the Claude API by looking up the chosen model —
// no tokens are used. Returns an error message, or null when it works.
async function checkKey(apiKey: string, model: ClaudeModel): Promise<string | null> {
  try {
    await new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 }).models.retrieve(model);
    return null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected by Anthropic — check it was copied in full.';
    if (e instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model.';
    if (e instanceof Anthropic.NotFoundError) return 'That model is not available to this API key.';
    if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API from the server — check its internet access.';
    if (e instanceof Anthropic.APIError) return `Claude API error ${e.status}: ${e.message}`;
    throw e;
  }
}

// GET /api/settings/claude — current status (never the key itself) and the model choices.
export async function GET() {
  const denied = await requirePermission(PERMISSION);
  if (denied) return denied;
  return NextResponse.json({ ...(await getClaudeSettingsStatus()), models: CLAUDE_MODELS });
}

// PUT /api/settings/claude { apiKey?: string | null, model }
//   apiKey string → test it, then store it encrypted; null → remove; absent → keep.
export async function PUT(request: Request) {
  const denied = await requirePermission(PERMISSION);
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  const body = (await request.json().catch(() => null)) as { apiKey?: unknown; model?: unknown } | null;
  if (!body || !isClaudeModel(body.model)) {
    return NextResponse.json({ message: 'Choose one of the listed models' }, { status: 400 });
  }
  const model = body.model;
  let apiKey: string | null | undefined;
  if (body.apiKey === null) apiKey = null;
  else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    apiKey = body.apiKey.trim();
    if (!apiKey.startsWith('sk-ant-')) {
      return NextResponse.json({ message: 'Anthropic API keys start with "sk-ant-"' }, { status: 400 });
    }
  }

  // Test whichever key will be in use with the chosen model before saving.
  const keyToCheck = apiKey === undefined ? (await getClaudeSettings()).apiKey : apiKey;
  if (keyToCheck) {
    const problem = await checkKey(keyToCheck, model);
    if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  }

  await saveClaudeSettings({ apiKey, model }, session?.user?.email || session?.user?.name || 'unknown');
  return NextResponse.json({ ...(await getClaudeSettingsStatus()), models: CLAUDE_MODELS });
}

// POST /api/settings/claude — test the saved key without changing anything.
export async function POST() {
  const denied = await requirePermission(PERMISSION);
  if (denied) return denied;
  const { apiKey, model } = await getClaudeSettings();
  if (!apiKey) return NextResponse.json({ message: 'No API key is saved yet' }, { status: 400 });
  const problem = await checkKey(apiKey, model);
  if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  return NextResponse.json({ ok: true, message: `Connected — ${model} is available.` });
}
