'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

// AI Settings (admin): the Claude API key and model "Ask MIS" uses. The key is
// tested against Anthropic before it is saved, stored encrypted on the server
// and never sent back to the browser — only its last four characters.

interface Status {
  configured: boolean;
  keyLast4: string | null;
  model: string;
  updatedAt: string | null;
  updatedBy: string | null;
  models: { id: string; name: string }[];
}

const inputClass = 'border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-amber-500';
const buttonClass = 'px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50';

async function call(method: string, body?: unknown): Promise<Status & { message?: string }> {
  const res = await fetch('/api/settings/claude', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data;
}

export default function AiSettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);

  useEffect(() => {
    call('GET')
      .then((s) => {
        setStatus(s);
        setModel(s.model);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const run = async (kind: 'save' | 'test' | 'remove', action: () => Promise<Status & { message?: string }>, success: string) => {
    setBusy(kind);
    try {
      const s = await action();
      if (kind !== 'test') {
        setStatus(s);
        setApiKey('');
      }
      toast.success(s.message ?? success);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!status) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI Settings</h1>
        <p className="text-sm text-slate-500">The Claude API key and model used by Ask MIS. Only admins can see this page.</p>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${status.configured ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          {status.configured ? (
            <span>
              API key saved, ending in <span className="font-mono">…{status.keyLast4}</span>
              {status.updatedAt && (
                <span className="text-slate-500">
                  {' '}— updated {new Date(status.updatedAt).toLocaleString()} by {status.updatedBy}
                </span>
              )}
            </span>
          ) : (
            <span className="text-slate-600">No API key saved — Ask MIS is switched off.</span>
          )}
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{status.configured ? 'Replace API key' : 'Claude API key'}</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-…"
            className={`${inputClass} font-mono`}
          />
          <span className="block text-xs text-slate-500">
            Create one at console.anthropic.com → API Keys. Usage is billed to that Anthropic account. A Claude.ai subscription login can&apos;t be used here.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
            {status.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            disabled={busy != null || (!apiKey.trim() && model === status.model) || (!apiKey.trim() && !status.configured)}
            onClick={() => run('save', () => call('PUT', { apiKey: apiKey.trim() || undefined, model }), 'Saved — the key works')}
            className={`${buttonClass} bg-amber-600 text-white hover:bg-amber-700`}
          >
            {busy === 'save' ? 'Testing & saving…' : 'Test & save'}
          </button>
          {status.configured && (
            <>
              <button
                disabled={busy != null}
                onClick={() => run('test', () => call('POST'), 'Connected')}
                className={`${buttonClass} border border-slate-300 text-slate-700 hover:bg-slate-50`}
              >
                {busy === 'test' ? 'Testing…' : 'Test connection'}
              </button>
              <button
                disabled={busy != null}
                onClick={() => run('remove', () => call('PUT', { apiKey: null, model: status.model }), 'API key removed — Ask MIS is off')}
                className={`${buttonClass} border border-red-200 text-red-700 hover:bg-red-50 ml-auto`}
              >
                Remove key
              </button>
            </>
          )}
        </div>
      </section>

      <section className="text-xs text-slate-500 space-y-1">
        <p>The key is stored encrypted on the MIS server (data/settings) and is never shown again or sent to the browser.</p>
        <p>Questions send the report figures they need (invoice lines, amounts, SKUs) to Anthropic to be answered. Every question is logged with its token use in data/settings/claude-usage.jsonl.</p>
      </section>
    </div>
  );
}
