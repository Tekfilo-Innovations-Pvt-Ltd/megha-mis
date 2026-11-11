'use client';

import type { SkuRow } from '@/lib/labourReport';
import { fmtDate, fmtNum } from '@/lib/format';
import { Variance, VariancePct } from '@/components/labour/LineComparisonDetail';
import ChartAmount from '@/components/labour/ChartAmount';
import { chartCalc } from '@/lib/chartCalc';

// A SKU's chart amount is its comparable lines' chart labour added up; the
// per-line working is on the Lines tab (click the SKU to open its lines).
const lines = (s: SkuRow) => `${s.comparableLines.toLocaleString()} comparable line${s.comparableLines === 1 ? '' : 's'}`;
const skuCalc = (s: SkuRow) =>
  chartCalc(
    `Chart labour — SKU ${s.skuNo ?? '(none)'}`,
    [
      { title: `Metal labour chart, ${lines(s)}`, steps: [], formula: null, amount: s.metalChart },
      { title: `Setting labour chart, ${lines(s)}`, steps: [], formula: null, amount: s.settingChart },
    ],
    s.chart,
    'Each line counts only the labour the factory invoiced and the chart could price. Click the SKU to see its lines; each line’s chart amount opens its own working.',
  );
const perPcCalc = (s: SkuRow) =>
  s.chartPerPc == null
    ? null
    : chartCalc(
        `Chart labour per piece — SKU ${s.skuNo ?? '(none)'}`,
        [
          {
            title: 'Chart labour ÷ pieces',
            steps: [
              { label: 'Chart labour', value: `${fmtNum(s.chart)} (${lines(s)})` },
              { label: 'Pieces', value: `${fmtNum(s.qty, 0)} on those lines` },
            ],
            formula: `${fmtNum(s.chart)} ÷ ${fmtNum(s.qty, 0)} pcs`,
            amount: s.chartPerPc,
          },
        ],
        s.chartPerPc,
      );

// The report grouped by SKU: each SKU's lines added up. Clicking a SKU shows its lines.
export default function SkuTable({ skus, onOpenSku }: { skus: SkuRow[]; onOpenSku: (skuNo: string) => void }) {
  const th = 'px-3 py-1.5 font-medium whitespace-nowrap';
  const td = 'px-3 py-2 text-right tabular-nums';
  return (
    <table className="min-w-full text-sm">
      <thead className="text-slate-500 bg-slate-50">
        <tr>
          <th className={`${th} pl-4 text-left`}>SKU No</th>
          <th className={`${th} text-right`}>Jewellery</th>
          <th className={`${th} text-right`}>Invoices</th>
          <th className={`${th} text-right`}>Lines</th>
          <th className={`${th} text-right`} title="Pieces on the comparable lines">Qty</th>
          <th className={`${th} text-right`}>Inv / pc</th>
          <th className={`${th} text-right`}>Chart / pc</th>
          <th className={`${th} text-right`}>Invoiced</th>
          <th className={`${th} text-right`}>Chart</th>
          <th className={`${th} text-right`}>Diff Amount</th>
          <th className={`${th} pr-4 text-right`}>Diff %</th>
        </tr>
      </thead>
      <tbody>
        {skus.map((s) => (
          <tr key={s.skuNo ?? ''} className="border-t border-slate-100 align-top">
            <td className="pl-4 pr-3 py-2 whitespace-nowrap">
              {s.skuNo ? (
                <button onClick={() => onOpenSku(s.skuNo!)} className="font-medium text-amber-700 hover:underline" title="Show this SKU's lines">
                  {s.skuNo}
                </button>
              ) : (
                <span className="text-slate-500">(no SKU)</span>
              )}
              <span className="block text-xs text-slate-500">
                {s.productTypes.join(', ') || '—'} · last {fmtDate(s.lastInvDt)}
              </span>
            </td>
            <td className={td}>{s.jewelleries.toLocaleString()}</td>
            <td className={td}>{s.invoices.toLocaleString()}</td>
            <td className={`${td} whitespace-nowrap`}>
              {s.lines.toLocaleString()}
              <span className="block text-xs">
                {s.over > 0 && <span className="text-red-700">{s.over} over</span>}
                {s.over > 0 && s.under > 0 && ' · '}
                {s.under > 0 && <span className="text-sky-700">{s.under} under</span>}
                {s.notComparable > 0 && <span className="block text-slate-500">{s.notComparable} not comparable</span>}
              </span>
            </td>
            <td className={td}>{fmtNum(s.qty, 0)}</td>
            <td className={td}>{s.invoicedPerPc == null ? '—' : fmtNum(s.invoicedPerPc)}</td>
            <td className={td}><ChartAmount value={s.chartPerPc} calc={perPcCalc(s)} empty="—" /></td>
            <td className={td}>{s.comparableLines ? fmtNum(s.invoiced) : '—'}</td>
            <td className={td}>{s.comparableLines ? <ChartAmount value={s.chart} calc={skuCalc(s)} /> : '—'}</td>
            <td className={td}>{s.comparableLines ? <Variance value={s.variance} /> : '—'}</td>
            <td className={`${td} pr-4`}>{s.comparableLines ? <VariancePct pct={s.variancePct} /> : '—'}</td>
          </tr>
        ))}
        {skus.length === 0 && <tr><td colSpan={11} className="px-4 py-6 text-center text-slate-500">No SKUs match.</td></tr>}
      </tbody>
    </table>
  );
}
