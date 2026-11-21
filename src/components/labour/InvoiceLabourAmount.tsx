'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { fmtNum } from '@/lib/format';
import type { InvoiceLabourSource } from '@/lib/labourLotReport';

// An invoice amount in the labour breakup that opens the factory invoice's own
// labour rows behind it (tbl_factory_invoice_labour): process, description, qty,
// what the factory entered in its currency, and rate / amount in the invoice
// currency. Without rows (setting recorded on the stones) it is plain text.

const n = (v: number | null | undefined, digits = 2) => (v == null ? '—' : fmtNum(v, digits));

export default function InvoiceLabourAmount({ value, process, sources }: { value: number | null | undefined; process: string; sources?: InvoiceLabourSource[] }) {
  const [open, setOpen] = useState(false);
  if (value == null) return null;
  const text = fmtNum(value, 2);
  if (!sources?.length) return <>{text}</>;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Show the factory invoice labour rows"
        className="tabular-nums underline decoration-dotted decoration-slate-400 underline-offset-2 hover:text-amber-700 hover:decoration-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-sm"
      >
        {text}
      </button>
      {open && <SourcesDialog process={process} sources={sources} total={value} onClose={() => setOpen(false)} />}
    </>
  );
}

function SourcesDialog({ process, sources, total, onClose }: { process: string; sources: InvoiceLabourSource[]; total: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const currency = sources[0]?.currency ?? '';
  const th = 'px-2 py-1.5 font-medium whitespace-nowrap';
  const td = 'px-2 py-1.5 tabular-nums whitespace-nowrap';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="inv-labour-title" className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-xl text-sm text-slate-700 text-left" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
          <div>
            <h2 id="inv-labour-title" className="font-semibold text-slate-900">Invoice labour — {process}</h2>
            <p className="text-slate-500">From the factory invoice labour table · = <b className="tabular-nums text-slate-900">{fmtNum(total)}</b> {currency}</p>
          </div>
          <button type="button" onClick={onClose} autoFocus className="p-1 rounded hover:bg-slate-100" aria-label="Close"><XMarkIcon className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className={`${th} text-left`} rowSpan={2}>Process</th>
                <th className={`${th} text-left`} rowSpan={2}>Description</th>
                <th className={`${th} text-right`} rowSpan={2}>Qty</th>
                <th colSpan={4} className={`${th} text-center bg-slate-100`}>As entered by the factory</th>
                <th colSpan={2} className={`${th} text-center bg-indigo-200 text-indigo-950`}>Invoice ({currency})</th>
              </tr>
              <tr>
                <th className={`${th} text-left bg-slate-100`}>Input currency</th>
                <th className={`${th} text-right bg-slate-100`}>Exchange rate</th>
                <th className={`${th} text-right bg-slate-100`}>Input rate</th>
                <th className={`${th} text-right bg-slate-100`}>Input amount</th>
                <th className={`${th} text-right bg-indigo-200 text-indigo-950`}>Rate</th>
                <th className={`${th} text-right bg-indigo-200 text-indigo-950`}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sources.map((s, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">{s.process}</td>
                  <td className="px-2 py-1.5 text-slate-600">{s.description ?? '—'}</td>
                  <td className={`${td} text-right`}>{n(s.qty, 2)}</td>
                  <td className={td}>{s.inputCurrency ?? '—'}</td>
                  <td className={`${td} text-right`}>{s.inputExchangeRate ? n(s.inputExchangeRate, 4) : '—'}</td>
                  <td className={`${td} text-right`}>{s.inputRate ? n(s.inputRate, 4) : '—'}</td>
                  <td className={`${td} text-right`}>{s.inputAmount ? n(s.inputAmount) : '—'}</td>
                  <td className={`${td} text-right bg-indigo-50`}>{n(s.rate, 4)}</td>
                  <td className={`${td} text-right bg-indigo-50 font-medium`}>{n(s.amount)}</td>
                </tr>
              ))}
            </tbody>
            {sources.length > 1 && (
              <tfoot className="font-semibold border-t-2 border-slate-300">
                <tr>
                  <td className="px-2 py-1.5" colSpan={2}>Total</td>
                  <td className={`${td} text-right`}>{n(sources.reduce((s, x) => s + (x.qty ?? 0), 0), 2)}</td>
                  <td colSpan={3} />
                  <td className={`${td} text-right`}>{(() => { const cur = new Set(sources.map((s) => s.inputCurrency)); return cur.size === 1 ? n(sources.reduce((s, x) => s + (x.inputAmount ?? 0), 0)) : ''; })()}</td>
                  <td className="bg-indigo-50" />
                  <td className={`${td} text-right bg-indigo-50`}>{n(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}
