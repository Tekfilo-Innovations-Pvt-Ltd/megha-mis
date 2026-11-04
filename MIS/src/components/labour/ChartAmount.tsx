'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { ChartCalc } from '@/lib/chartCalc';
import { fmtNum } from '@/lib/format';

// A chart amount that opens how it was worked out: the chart rows looked up
// for each metal charge / stone lot, rate × quantity, and how the parts add
// up to the amount shown. The working comes with the amount (calc) or is
// fetched on click (getCalc). Without either it is plain text.

type Props = {
  value: number | null | undefined;
  digits?: number;
  calc?: ChartCalc | null;
  getCalc?: () => Promise<ChartCalc | null>;
  currency?: string;
  empty?: string; // shown when there is no value
};

export default function ChartAmount({ value, digits = 2, calc, getCalc, currency, empty = '' }: Props) {
  const [open, setOpen] = useState(false);
  if (value == null) return <>{empty}</>;
  const text = fmtNum(value, digits);
  if (!calc && !getCalc) return <>{text}</>;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // the Lines tab opens a line on row click
          setOpen(true);
        }}
        title="How the chart amount is worked out"
        className="tabular-nums underline decoration-dotted decoration-slate-400 underline-offset-2 hover:text-amber-700 hover:decoration-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-sm"
      >
        {text}
      </button>
      {open && <CalcDialog calc={calc} getCalc={getCalc} currency={currency} onClose={() => setOpen(false)} />}
    </>
  );
}

function CalcDialog({ calc, getCalc, currency, onClose }: { calc?: ChartCalc | null; getCalc?: () => Promise<ChartCalc | null>; currency?: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState<{ calc: ChartCalc | null; error?: string } | null>(calc ? { calc } : null);

  useEffect(() => {
    if (loaded || !getCalc) return;
    let live = true;
    getCalc()
      .then((c) => live && setLoaded({ calc: c }))
      .catch((e: Error) => live && setLoaded({ calc: null, error: e.message || 'Could not load the working' }));
    return () => {
      live = false;
    };
  }, [loaded, getCalc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = loaded?.calc;
  return createPortal(
    // React events bubble through the portal to the table — keep them here.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-calc-title"
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-xl text-sm text-slate-700 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
          <div>
            <h2 id="chart-calc-title" className="font-semibold text-slate-900">{c?.title ?? 'Chart amount'}</h2>
            {c && (
              <p className="text-slate-500">
                = <b className="tabular-nums text-slate-900">{fmtNum(c.total)}</b> {currency}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} autoFocus className="p-1 rounded hover:bg-slate-100" aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!loaded && <p className="text-slate-500">Loading…</p>}
          {loaded?.error && <p className="text-red-600">{loaded.error}</p>}
          {loaded && !loaded.error && !c && <p className="text-slate-500">No working is available for this amount.</p>}
          {c && (
            <>
              {c.parts.map((p, i) => (
                <section key={i} className={c.parts.length > 1 ? 'rounded-lg border border-slate-200 p-3' : ''}>
                  {c.parts.length > 1 && <h3 className="mb-1.5 font-medium text-slate-900">{i + 1}. {p.title}</h3>}
                  {p.steps.length > 0 && (
                    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1">
                      {p.steps.map((s, k) => (
                        <div key={k} className="contents">
                          <dt className="text-slate-500">{s.label}</dt>
                          <dd className="tabular-nums">{s.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className={`tabular-nums ${p.steps.length ? 'mt-2 pt-2 border-t border-dashed border-slate-200' : ''}`}>
                    {p.formula && <>{p.formula} = </>}
                    <b className="text-slate-900">{fmtNum(p.amount)}</b>
                  </p>
                </section>
              ))}
              {c.parts.length > 1 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 tabular-nums">
                  {c.parts.length <= 12 ? c.parts.map((p) => fmtNum(p.amount)).join(' + ') : `Sum of ${c.parts.length} amounts`} ={' '}
                  <b className="text-slate-900">{fmtNum(c.total)}</b> {currency}
                </p>
              )}
              {c.note && <p className="text-xs text-slate-500">{c.note}</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
