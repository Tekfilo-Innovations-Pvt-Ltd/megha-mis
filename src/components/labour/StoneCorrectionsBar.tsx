'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { fmtDate } from '@/lib/format';

type Status = { fileName: string; uploadedAt: string; uploadedBy: string | null; stoneRows: number; lots: number } | null;
const URL_ = '/api/reports/labour-vs-chart/stone-corrections';

// Shows whether the customer's stone corrections (shape / MM size) are in use,
// with upload / remove for users who manage price charts.
export default function StoneCorrectionsBar() {
  const qc = useQueryClient();
  const { has } = usePermissions();
  const canManage = has('manage_price_charts');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const status = useQuery<Status>({
    queryKey: ['stone-corrections'],
    queryFn: async () => {
      const res = await fetch(URL_);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Request failed');
      return res.json();
    },
  });

  const run = async (init: RequestInit) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(URL_, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Request failed');
      setMessage({ ok: true, text: body?.message ?? 'Done' });
      // Every report figure may change.
      await qc.invalidateQueries();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const upload = (file: File) => {
    const form = new FormData();
    form.append('file', file);
    run({ method: 'POST', body: form });
  };

  const s = status.data;
  const button = 'px-2.5 py-1 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 disabled:opacity-40';
  return (
    <section className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span className="font-semibold text-slate-900 text-sm">Customer stone corrections</span>
      {status.isLoading ? (
        <span className="text-slate-500">Loading…</span>
      ) : s ? (
        <span className="text-slate-600">
          <span className="inline-block rounded bg-emerald-50 text-emerald-700 px-1.5 py-0.5 font-medium mr-1.5">In use</span>
          Shape / MM from <b>{s.fileName}</b> — {s.stoneRows.toLocaleString()} stone rows, {s.lots.toLocaleString()} lots · uploaded {fmtDate(s.uploadedAt)}
          {s.uploadedBy ? ` by ${s.uploadedBy}` : ''}
        </span>
      ) : (
        <span className="text-slate-500">None — shape and MM size are as in the ERP.</span>
      )}
      {canManage && (
        <span className="ml-auto flex items-center gap-2">
          <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button className={button} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Working…' : s ? 'Replace…' : 'Upload…'}
          </button>
          {s && (
            <button className={button} disabled={busy} onClick={() => run({ method: 'DELETE' })}>
              Remove
            </button>
          )}
        </span>
      )}
      {message && <span className={`w-full ${message.ok ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</span>}
    </section>
  );
}
