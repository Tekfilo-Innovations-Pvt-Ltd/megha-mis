'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import { isSharedViewer } from '@/lib/settingChoices';
import { fmtDate } from '@/lib/format';
import type { SettingChoiceRow } from '@/lib/settingChoiceRows';

// Setting types for stones the ERP records none for: a bar saying what is in
// use, and a dialog listing the distinct stones (lot code + shape + MM size) in
// the current filters, each with a type to choose, plus the default for the
// rest. Saving recalculates every report figure.

type Data = {
  chart: { code: string; name: string };
  settingTypes: { code: string; name: string }[];
  defaultSettingType: string;
  choices: Record<string, string>;
  updatedAt: string | null;
  updatedBy: string | null;
  rows: SettingChoiceRow[];
};

const URL_ = '/api/reports/labour-vs-chart/setting-choices';
const PAGE = 100;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Request failed');
  return res.json();
}

export default function SettingTypesPanel({ filterParams }: { filterParams: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const query = new URLSearchParams(filterParams).toString();
  const data = useQuery({
    queryKey: ['setting-choices', query],
    queryFn: () => getJson<Data>(`${URL_}?${query}`),
  });
  const d = data.data;
  const typeName = (code: string | null | undefined) => d?.settingTypes.find((t) => t.code === code)?.name ?? code ?? '—';
  const chosenHere = d ? d.rows.filter((r) => r.chosen).length : 0;

  return (
    <section className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span className="font-semibold text-slate-900 text-sm">Setting types</span>
      {data.isLoading ? (
        <span className="text-slate-500">Loading…</span>
      ) : data.isError ? (
        <span className="text-red-600">{(data.error as Error).message}</span>
      ) : d ? (
        <span className="text-slate-600">
          {d.rows.length.toLocaleString()} stones (lot code / shape / MM) in these lines have no setting type in the ERP ·{' '}
          <b>{chosenHere.toLocaleString()}</b> chosen · the rest use the invoice&apos;s Setting row, else <b>{typeName(d.defaultSettingType)}</b>
          {d.updatedAt && <span className="text-slate-400"> · saved {fmtDate(d.updatedAt)}{d.updatedBy ? ` by ${d.updatedBy}` : ''}</span>}
        </span>
      ) : null}
      <button className="ml-auto px-2.5 py-1 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 disabled:opacity-40" disabled={!d} onClick={() => setOpen(true)}>
        Choose setting types…
      </button>
      {open && d && <SettingTypesDialog data={d} onClose={() => setOpen(false)} />}
    </section>
  );
}

function SettingTypesDialog({ data, onClose }: { data: Data; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canEdit = !!session?.user && !isSharedViewer(session.user.id);
  const [choices, setChoices] = useState<Record<string, string>>(data.choices); // every saved choice, not only these rows
  const [defaultType, setDefaultType] = useState(data.defaultSettingType);
  const [allType, setAllType] = useState('MICRO_PAVE');
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [bulkType, setBulkType] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = (code: string | null | undefined) => data.settingTypes.find((t) => t.code === code)?.name ?? code ?? '';
  const rows = useMemo(() => {
    const s = search.trim().toUpperCase();
    return data.rows.filter(
      (r) =>
        (!onlyOpen || !choices[r.key]) &&
        (!s || [r.lotCode, r.commodity, r.shape, r.mmSize].some((v) => (v ?? '').toUpperCase().includes(s))),
    );
  }, [data.rows, search, onlyOpen, choices]);
  useEffect(() => setPage(0), [search, onlyOpen]);
  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const dirty = defaultType !== data.defaultSettingType || JSON.stringify(choices) !== JSON.stringify(data.choices);

  const choose = (key: string, code: string) =>
    setChoices((c) => {
      const next = { ...c };
      if (code) next[key] = code;
      else delete next[key];
      return next;
    });
  // Bulk: the chosen type on every listed row it can price (rows of other sections keep theirs).
  const applyBulk = () => {
    if (!bulkType) return;
    setChoices((c) => {
      const next = { ...c };
      for (const r of rows) if (!r.allowedTypes || r.allowedTypes.includes(bulkType)) next[r.key] = bulkType;
      return next;
    });
  };
  // One click: this type for every stone without a setting type — each stone in
  // these lines (where the chart has the type for it) and the default for the rest.
  const useForAll = () => {
    setDefaultType(allType);
    setChoices((c) => {
      const next = { ...c };
      for (const r of data.rows) if (!r.allowedTypes || r.allowedTypes.includes(allType)) next[r.key] = allType;
      return next;
    });
  };
  const cannotTake = data.rows.filter((r) => r.allowedTypes && !r.allowedTypes.includes(allType)).length;
  const clearListed = () =>
    setChoices((c) => {
      const next = { ...c };
      for (const r of rows) delete next[r.key];
      return next;
    });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(URL_, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart: data.chart.code, defaultSettingType: defaultType, choices }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'Request failed');
      await qc.invalidateQueries(); // every report figure may change
      onClose();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const input = 'px-2 py-1 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:bg-slate-50';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="setting-types-title" className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl bg-white shadow-xl text-sm text-slate-700" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3">
          <div>
            <h2 id="setting-types-title" className="font-semibold text-slate-900">Setting types for stones without one — {data.chart.name}</h2>
            <p className="text-xs text-slate-500">
              A stone uses the ERP&apos;s setting type; if it has none, the type chosen here; else the type named on the invoice&apos;s Setting labour row; else the default.
              Choices apply to every report for this company and chart.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100" aria-label="Close"><XMarkIcon className="h-5 w-5" /></button>
        </div>

        {canEdit ? (
          <div className="px-5 py-3 border-b border-amber-200 bg-amber-50 flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">Use</span>
            <select value={allType} onChange={(e) => setAllType(e.target.value)} className={input} aria-label="Setting type for every stone">
              {data.settingTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
            <span className="text-slate-700">for every stone without a setting type</span>
            <button onClick={useForAll} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700">
              Apply to all {data.rows.length.toLocaleString()} stones
            </button>
            <span className="w-full text-xs text-slate-600">
              Sets every stone below and the default, then press <b>Save and recalculate</b>. You can still change single stones after.
              {cannotTake > 0 && <> {cannotTake.toLocaleString()} stone{cannotTake === 1 ? '' : 's'} can&apos;t take {name(allType)} in this chart and keep their type.</>}
            </span>
          </div>
        ) : (
          <div className="px-5 py-2 border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            View only — the shared viewer login can&apos;t change setting types. Sign in with your ERP login to change them.
          </div>
        )}

        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-end gap-3">
          <label className="text-xs"><span className="block text-slate-500 mb-1">Default — stones with no type anywhere</span>
            <select value={defaultType} onChange={(e) => setDefaultType(e.target.value)} disabled={!canEdit} className={input}>
              {data.settingTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
          </label>
          <label className="text-xs"><span className="block text-slate-500 mb-1">Find</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Lot code, commodity, shape, MM" className={`${input} w-56`} />
          </label>
          <label className="text-xs flex items-center gap-1.5 pb-1.5">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} className="rounded border-slate-300 text-amber-600" />
            Only stones without a choice
          </label>
          {canEdit && (
            <span className="ml-auto flex items-end gap-2 text-xs">
              <label><span className="block text-slate-500 mb-1">Set all {rows.length.toLocaleString()} listed to</span>
                <select value={bulkType} onChange={(e) => setBulkType(e.target.value)} className={input}>
                  <option value="">Choose a type…</option>
                  {data.settingTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                </select>
              </label>
              <button onClick={applyBulk} disabled={!bulkType} className="px-2.5 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40">Apply</button>
              <button onClick={clearListed} className="px-2.5 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50">Clear listed</button>
            </span>
          )}
        </div>

        <div className="overflow-auto flex-1">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                {['Lot code', 'Commodity', 'Shape', 'MM size'].map((h) => <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>)}
                <th className="px-3 py-1.5 text-right font-medium">Lines</th>
                <th className="px-3 py-1.5 text-right font-medium">Pcs</th>
                <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap">Without a choice</th>
                <th className="px-3 py-1.5 text-left font-medium whitespace-nowrap">Setting type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageRows.map((r) => {
                const options = r.allowedTypes ? data.settingTypes.filter((t) => r.allowedTypes!.includes(t.code)) : data.settingTypes;
                const chosen = choices[r.key] ?? '';
                return (
                  <tr key={r.key} className={chosen ? 'bg-emerald-50/60' : ''}>
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium text-slate-900">{r.lotCode ?? '—'}</td>
                    <td className="px-3 py-1.5">{r.commodity}</td>
                    <td className="px-3 py-1.5">{r.shape ?? '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.mmSize ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.lines.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.pieces.toLocaleString()}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">
                      {r.invoiceType ? <>From invoice: {name(r.invoiceType)}</> : <>Default: {name(defaultType)}</>}
                      {r.issue && <span className="block text-amber-700">Chart can&apos;t place this stone ({r.issue.replace(/_/g, ' ').toLowerCase()})</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <select value={chosen} onChange={(e) => choose(r.key, e.target.value)} disabled={!canEdit} className={input}>
                        <option value="">— no choice —</option>
                        {options.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">No stones without a setting type match.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-200 px-5 py-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500">
            {rows.length.toLocaleString()} stones listed · {Object.keys(choices).length.toLocaleString()} choices for this company and chart
          </span>
          {pages > 1 && (
            <span className="flex items-center gap-1.5 text-xs">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40">Previous</button>
              Page {page + 1} of {pages}
              <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page + 1 >= pages} className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40">Next</button>
            </span>
          )}
          {message && <span className={`text-xs ${message.ok ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</span>}
          <span className="ml-auto flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">{canEdit ? 'Cancel' : 'Close'}</button>
            {canEdit && (
              <button onClick={save} disabled={!dirty || busy} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">
                {busy ? 'Saving & recalculating…' : 'Save and recalculate'}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
