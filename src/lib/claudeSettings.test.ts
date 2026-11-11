import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The settings file lives in a temp dir; the module reads the env at import.
const dir = path.join(os.tmpdir(), `mis-settings-test-${process.pid}`);
let mod: typeof import('./claudeSettings');

beforeAll(async () => {
  vi.stubEnv('MIS_SETTINGS_DIR', dir);
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
  mod = await import('./claudeSettings');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('claude settings store', () => {
  const key = 'sk-ant-api03-abcdefghijklmnop-WXYZ';

  it('starts unconfigured with the default model', async () => {
    expect(await mod.getClaudeSettings()).toEqual({ apiKey: null, model: 'claude-opus-5-5' });
    expect((await mod.getClaudeSettingsStatus()).configured).toBe(false);
  });

  it('stores the key encrypted and gives the page only its last four characters', async () => {
    await mod.saveClaudeSettings({ apiKey: key, model: 'claude-sonnet-5-5' }, 'admin@example.com');
    const raw = await fs.readFile(path.join(dir, 'claude.json'), 'utf8');
    expect(raw).not.toContain(key);
    expect(raw).not.toContain('abcdefghijklmnop');
    expect(await mod.getClaudeSettings()).toEqual({ apiKey: key, model: 'claude-sonnet-5-5' });
    const status = await mod.getClaudeSettingsStatus();
    expect(status).toMatchObject({ configured: true, keyLast4: 'WXYZ', model: 'claude-sonnet-5-5', updatedBy: 'admin@example.com' });
    expect(JSON.stringify(status)).not.toContain(key);
  });

  it('keeps the key when only the model changes, and removes it on null', async () => {
    await mod.saveClaudeSettings({ model: 'claude-opus-5-5' }, 'admin@example.com');
    expect(await mod.getClaudeSettings()).toEqual({ apiKey: key, model: 'claude-opus-5-5' });
    await mod.saveClaudeSettings({ apiKey: null, model: 'claude-opus-5-5' }, 'admin@example.com');
    expect((await mod.getClaudeSettingsStatus()).configured).toBe(false);
  });

  it('treats a key saved under another NEXTAUTH_SECRET as not configured', async () => {
    await mod.saveClaudeSettings({ apiKey: key, model: 'claude-opus-5-5' }, 'admin@example.com');
    vi.stubEnv('NEXTAUTH_SECRET', 'a-different-secret');
    expect((await mod.getClaudeSettings()).apiKey).toBeNull();
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
    expect((await mod.getClaudeSettings()).apiKey).toBe(key);
  });
});
