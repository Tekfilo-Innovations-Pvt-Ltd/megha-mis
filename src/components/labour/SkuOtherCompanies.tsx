'use client';

import { useQuery } from '@tanstack/react-query';
import { fmtDate, fmtNum } from '@/lib/format';
import type { SkuCompany } from '@/lib/skuOtherCompanies';

// In the chart labour pop-up: the same SKU in the user's other companies (e.g.
// an AAA line's SKU at RTPHK) — labour per piece, beside this line's.

export interface SkuContext {
  skuNo: string;
  chartCode: string;
  qty: number;
  invoicedLabour: number; // this line's whole invoice labour
  chart: number | null; // this line's chart labour (compared part)
  gramsPerPiece: number | null;
}

type Response = { companies: SkuCompany[] };

const per = (v: number | null | undefined, qty: number) => (v == null || qty <= 0 ? null : v / qty);
const n = (v: number | null | undefined, digits = 2) => (v == null ? '—' : fmtNum(v, digits));

export default function SkuOtherCompanies({ context, currency }: { context: SkuContext; currency?: string }) {
  const q = useQuery({
    queryKey: ['sku-other-companies', context.skuNo, context.chartCode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/labour-vs-chart/sku-other-companies?${new URLSearchParams({ sku: context.skuNo, chart: context.chartCode })}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Request failed');
      return (await res.json()) as Response;
    },
    staleTime: 5 * 60 * 1000,
  });
  const ownPerPc = per(context.invoicedLabour, context.qty);
  const th = 'px-2 py-1 font-medium whitespace-nowrap';
  const td = 'px-2 py-1 tabular-nums whitespace-nowrap';

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <h3 className="font-medium text-slate-900">Same SKU in your other companies — {context.skuNo.replace(/-A$/i, '')} (incl. its -A clone)</h3>
      <p className="text-xs text-slate-600 mb-2">
        This line: invoice labour <b className="tabular-nums">{n(ownPerPc)}</b>/pc · chart <b className="tabular-nums">{n(per(context.chart, context.qty))}</b>/pc
        {context.gramsPerPiece != null && <> · {fmtNum(context.gramsPerPiece, 3)} g/pc</>} {currency}
      </p>
      {q.isLoading && <p className="text-xs text-slate-500">Looking up the SKU…</p>}
      {q.isError && <p className="text-xs text-red-600">{(q.error as Error).message}</p>}
      {q.data && q.data.companies.length === 0 && <p className="text-xs text-slate-500">This SKU isn&apos;t invoiced in any other company you can open.</p>}
      {q.data?.companies.map((co) => (
        <div key={co.companyId} className="mt-2">
          <div className="text-xs font-semibold text-slate-800">
            {co.company} — {co.totalLines.toLocaleString()} line{co.totalLines === 1 ? '' : 's'}
            {co.averages.map((a) => (
              <span key={a.currency} className="ml-2 font-normal text-slate-600">
                average <b className="tabular-nums">{fmtNum(a.labourPerPc)}</b>/pc {a.currency} (setting {fmtNum(a.settingPerPc)}, other {fmtNum(a.otherPerPc)}) over {fmtNum(a.qty, 0)} pcs
                {ownPerPc != null && a.labourPerPc > 0 && a.currency === currency && (
                  <span className={ownPerPc > a.labourPerPc ? 'text-red-700' : 'text-sky-700'}>
                    {' '}· this line {ownPerPc > a.labourPerPc ? '+' : ''}{fmtNum(((ownPerPc - a.labourPerPc) / a.labourPerPc) * 100, 1)}%
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto mt-1">
            <table className="min-w-full text-xs bg-white rounded border border-slate-200">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className={th}>Invoice</th><th className={th}>Date</th><th className={th}>Factory</th><th className={th}>Jewellery</th>
                  <th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>g/pc</th>
                  <th className={`${th} text-right bg-indigo-100`}>Labour/pc</th><th className={`${th} text-right bg-indigo-100`}>Setting/pc</th><th className={`${th} text-right bg-indigo-100`}>Other/pc</th>
                  <th className={`${th} text-right bg-emerald-100`}>Chart/pc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {co.lines.map((l) => (
                  <tr key={`${l.invId}-${l.jewNo}`}>
                    <td className={td}>{l.invNo}</td>
                    <td className={td}>{fmtDate(l.invDt)}</td>
                    <td className="px-2 py-1">{l.factory}</td>
                    <td className={td}>{l.jewNo}{l.skuNo && l.skuNo.toUpperCase() !== context.skuNo.toUpperCase() && <span className="text-slate-500"> · {l.skuNo}</span>}{l.jobCategory && l.jobCategory !== 'Normal' && <span className="text-amber-700"> ({l.jobCategory})</span>}</td>
                    <td className={`${td} text-right`}>{fmtNum(l.qty, 0)}</td>
                    <td className={`${td} text-right`}>{n(l.gramsPerPiece, 3)}</td>
                    <td className={`${td} text-right font-medium`}>{n(l.labourPerPc)} <span className="text-slate-400">{l.currency}</span></td>
                    <td className={`${td} text-right`}>{n(l.settingPerPc)}</td>
                    <td className={`${td} text-right`}>{n(l.otherPerPc)}</td>
                    <td className={`${td} text-right`}>{n(l.chartPerPc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {co.totalLines > co.lines.length && <p className="text-[11px] text-slate-500 mt-0.5">Newest {co.lines.length} of {co.totalLines} lines shown; the average covers all.</p>}
          </div>
        </div>
      ))}
    </section>
  );
}
