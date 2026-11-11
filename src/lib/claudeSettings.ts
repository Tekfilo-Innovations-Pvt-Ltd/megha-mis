import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

// Claude API settings for "Ask MIS", entered by an admin on the AI Settings
// page. MIS has no database of its own and never writes to the ERP, so they
// live in a JSON file on the server, with the API key encrypted (AES-256-GCM,
// key derived from NEXTAUTH_SECRET). The key never leaves the server — the
// page only ever sees its last four characters.
//   MIS_SETTINGS_DIR (default ./data/settings)
//     claude.json

const SETTINGS_DIR = process.env.MIS_SETTINGS_DIR || path.join(process.cwd(), 'data', 'settings');
const FILE = path.join(SETTINGS_DIR, 'claude.json');

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 — most capable (default)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 — faster, about half the cost' },
] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number]['id'];
export const DEFAULT_MODEL: ClaudeModel = 'claude-opus-5-5';
export const isClaudeModel = (m: unknown): m is ClaudeModel => CLAUDE_MODELS.some((x) => x.id === m);

interface StoredSettings {
  apiKey: { iv: string; tag: string; data: string } | null;
  keyLast4: string | null;
  model: ClaudeModel;
  updatedAt: string;
  updatedBy: string;
}

export interface ClaudeSettings {
  apiKey: string | null;
  model: ClaudeModel;
}

// What the settings page may see.
export interface ClaudeSettingsStatus {
  configured: boolean;
  keyLast4: string | null;
  model: ClaudeModel;
  updatedAt: string | null;
  updatedBy: string | null;
}

function cipherKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set — it is needed to encrypt the Claude API key');
  return createHash('sha256').update(`mis-claude-settings:${secret}`).digest();
}

function encrypt(text: string): NonNullable<StoredSettings['apiKey']> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(box: NonNullable<StoredSettings['apiKey']>): string {
  const decipher = createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

async function readStored(): Promise<StoredSettings | null> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as StoredSettings;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function writeStored(s: StoredSettings) {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  await fs.rename(tmp, FILE);
}

// The decrypted settings, for the server-side Claude client only. A key that
// no longer decrypts (NEXTAUTH_SECRET changed) counts as not configured.
export async function getClaudeSettings(): Promise<ClaudeSettings> {
  const s = await readStored();
  let apiKey: string | null = null;
  if (s?.apiKey) {
    try {
      apiKey = decrypt(s.apiKey);
    } catch {
      apiKey = null;
    }
  }
  return { apiKey, model: s && isClaudeModel(s.model) ? s.model : DEFAULT_MODEL };
}

export async function getClaudeSettingsStatus(): Promise<ClaudeSettingsStatus> {
  const s = await readStored();
  const { apiKey, model } = await getClaudeSettings();
  return { configured: apiKey != null, keyLast4: apiKey ? (s?.keyLast4 ?? null) : null, model, updatedAt: s?.updatedAt ?? null, updatedBy: s?.updatedBy ?? null };
}

// apiKey: a new key, null to remove it, undefined to keep the current one.
export async function saveClaudeSettings(change: { apiKey?: string | null; model: ClaudeModel }, user: string) {
  const s = await readStored();
  const apiKey = change.apiKey === undefined ? (s?.apiKey ?? null) : change.apiKey ? encrypt(change.apiKey) : null;
  const keyLast4 = change.apiKey === undefined ? (s?.keyLast4 ?? null) : change.apiKey ? change.apiKey.slice(-4) : null;
  await writeStored({ apiKey, keyLast4, model: change.model, updatedAt: new Date().toISOString(), updatedBy: user });
}

// One line per question asked: who, when, model, tokens — for keeping an eye on cost.
export async function logClaudeUsage(entry: Record<string, unknown>) {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  await fs.appendFile(path.join(SETTINGS_DIR, 'claude-usage.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}
