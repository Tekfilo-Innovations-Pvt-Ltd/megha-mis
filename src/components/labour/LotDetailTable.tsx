'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import type { LotReport } from '@/lib/labourReport';
import type { LotNoteCode, LotRowKind } from '@/lib/labourLotReport';
import { fmtDate, fmtNum } from '@/lib/format';
import { settingNotCountedRemark } from '@/lib/jobWorkBlocks';
import { metalTypeLabel } from '@/lib/metalType';
import ChartAmount from '@/components/labour/ChartAmount';
import { StatusLabel, Variance } from '@/components/labour/LineComparisonDetail';
import { SIDE } from '@/components/labour/sides';
import type { ColumnDef, HiddenColumns } from '@/components/labour/columns';
import type { SkuContext } from '@/components/labour/SkuOtherCompanies';

// Lot detail of the labour-vs-chart report: each invoice line's columns on its
// first row, then one row per metal charge / stone lot.

const KIND_TEXT: Record<LotRowKind, string> = {
  METAL: 'Metal',
  SETTING: 'Setting',
  SETTING_LINE: 'Setting (line)',
  OTHER: 'Other',
};

// The setting type notes are shown next to the type itself, not as labels.
const TYPE_NOTES = new Set<LotNoteCode>(['TYPE_DEFAULT', 'TYPE_INVOICE', 'TYPE_CHOSEN']);

// Informational notes are grey; anything else (the chart could not price it) amber.
const NOTE_STYLE: Partial<Record<LotNoteCode, string>> = {
  BILLED_ON_LINE: 'bg-slate-100 text-slate-600',
  LINE_AVERAGE: 'bg-slate-100 text-slate-600',
  NOT_IN_CHART: 'bg-slate-100 text-slate-600',
  NOT_INVOICED: 'bg-slate-100 text-slate-600',
  PRICED_AS_OVAL: 'bg-slate-100 text-slate-600',
  LINE_EXTRA: 'bg-red-50 text-red-700',
  EMPTY_LINE: 'bg-slate-100 text-slate-600',
};

const num = (v: number | null, digits: number) => (v == null ? '—' : fmtNum(v, digits));

// Every column the viewer can show or hide (the column picker); the less used start hidden.
export const LOT_DETAIL_COLUMNS: ColumnDef[] = [
  { key: 'invoice', label: 'Invoice No / Date', group: 'Line' },
  { key: 'jewellery', label: 'Jewellery No', group: 'Line' },
  { key: 'sku', label: 'SKU No', group: 'Line' },
  { key: 'jobCategory', label: 'Job Category', group: 'Line' },
  { key: 'metalType', label: 'Metal Type', group: 'Line' },
  { key: 'qty', label: 'Qty', group: 'Line' },
  { key: 'grossWt', label: 'Gross Wt', group: 'Line', hidden: true },
  { key: 'netWt', label: 'Net Wt', group: 'Line' },
  { key: 'diaWt', label: 'Dia Wt', group: 'Line', hidden: true },
  { key: 'csWt', label: 'CS Wt', group: 'Line', hidden: true },
  { key: 'lotCode', label: 'Lot Code', group: 'Lot / labour row' },
  { key: 'commodity', label: 'Commodity', group: 'Lot / labour row' },
  { key: 'item', label: 'Item', group: 'Lot / labour row' },
  { key: 'qtyWt', label: 'Qty Wt', group: 'Lot / labour row' },
  { key: 'pcs', label: 'Qty Pcs', group: 'Lot / labour row' },
  { key: 'invRate', label: 'Inv Rate', group: 'Invoice / chart', hidden: true },
  { key: 'invAmt', label: 'Inv Amount', group: 'Invoice / chart' },
  { key: 'chartRate', label: 'Chart Rate', group: 'Invoice / chart', hidden: true },
  { key: 'chartAmt', label: 'Chart Amount', group: 'Invoice / chart' },
  { key: 'diff', label: 'Diff Amount', group: 'Invoice / chart' },
  { key: 'diffPct', label: 'Diff %', group: 'Invoice / chart' },
];

// The line's SKU and figures for the chart pop-up's same-SKU comparison.
const skuOf = (l: LotReport['groups'][number]['line'], rows: LotReport['groups'][number]['rows'], chartCode?: string): SkuContext | undefined =>
  chartCode && l.skuNo
    ? { skuNo: l.skuNo, chartCode, qty: l.qty, invoicedLabour: rows.reduce((s, r) => s + (r.invoiceAmount ?? 0), 0), chart: rows.reduce((s, r) => s + (r.chartAmount ?? 0), 0), gramsPerPiece: l.qty > 0 && l.netWt > 0 ? l.netWt / l.qty : null }
    : undefined;

const ROW_COLUMNS = ['lotCode', 'commodity', 'item', 'qtyWt', 'pcs', 'invRate', 'invAmt', 'chartRate', 'chartAmt', 'diff', 'diffPct'];

export default function LotDetailTable({ groups, hidden, chartCode }: { groups: LotReport['groups']; hidden: HiddenColumns; chartCode?: string }) {
  const show = (key: string) => !hidden.has(key);
  const th = 'px-2 py-1.5 font-medium whitespace-nowrap';
  const td = 'px-2 py-1.5 tabular-nums';
  // The first visible lot column carries the divider between the line and its rows.
  const firstRowCol = ROW_COLUMNS.find(show);
  const divider = (key: string) => (key === firstRowCol ? 'border-l border-slate-200' : '');
  const visible = LOT_DETAIL_COLUMNS.filter((c) => show(c.key)).length;
  return (
    <table className="min-w-full text-xs">
      <thead className="text-slate-500 bg-slate-50">
        <tr>
          {show('invoice') && <th className={`${th} pl-4 text-left`}>Invoice No / Date</th>}
          {show('jewellery') && <th className={`${th} text-left`}>Jewellery No</th>}
          {show('sku') && <th className={`${th} text-left`}>SKU No</th>}
          {show('jobCategory') && <th className={`${th} text-left`}>Job Category</th>}
          {show('metalType') && <th className={`${th} text-left`}>Metal Type</th>}
          {show('qty') && <th className={`${th} text-right`}>Qty</th>}
          {show('grossWt') && <th className={`${th} text-right`}>Gross Wt</th>}
          {show('netWt') && <th className={`${th} text-right`}>Net Wt</th>}
          {show('diaWt') && <th className={`${th} text-right`}>Dia Wt</th>}
          {show('csWt') && <th className={`${th} text-right`}>CS Wt</th>}
          {show('lotCode') && <th className={`${th} text-left ${divider('lotCode')}`}>Lot Code</th>}
          {show('commodity') && <th className={`${th} text-left ${divider('commodity')}`}>Commodity</th>}
          {show('item') && <th className={`${th} text-left ${divider('item')}`}>Item</th>}
          {show('qtyWt') && <th className={`${th} text-right ${divider('qtyWt')}`}>Qty Wt</th>}
          {show('pcs') && <th className={`${th} text-right ${divider('pcs')}`}>Qty Pcs</th>}
          {show('invRate') && <th className={`${th} text-right ${SIDE.invoice.head}`}>Inv Rate</th>}
          {show('invAmt') && <th className={`${th} text-right ${SIDE.invoice.head}`}>Inv Amount</th>}
          {show('chartRate') && <th className={`${th} text-right ${SIDE.chart.head}`}>Chart Rate</th>}
          {show('chartAmt') && <th className={`${th} text-right ${SIDE.chart.head}`}>Chart Amount</th>}
          {show('diff') && <th className={`${th} text-right ${SIDE.diff.head}`}>Diff Amount</th>}
          {show('diffPct') && <th className={`${th} pr-4 text-right ${SIDE.diff.head}`}>Diff %</th>}
        </tr>
      </thead>
      <tbody>
        {groups.map(({ line: l, rows, status }, g) => (
          <Fragment key={l.invDetId}>
            {rows.map((r, i) => (
              <tr key={i} className={`${i === 0 ? 'border-t-[3px] border-t-slate-600' : 'border-t border-slate-200'} ${g % 2 ? 'bg-slate-100' : 'bg-white'} ${r.kind === 'OTHER' ? 'text-slate-500' : ''} align-top`}>
                {i === 0 ? (
                  <>
                    {show('invoice') && (
                      <td className="pl-4 pr-2 py-1.5 whitespace-nowrap" rowSpan={rows.length}>
                        <Link href={`/dashboard/factory-invoices/${l.invId}`} className="font-medium text-amber-700 hover:underline">{l.invNo}</Link>
                        <span className="block text-slate-500">{fmtDate(l.invDt)}</span>
                        <span className="block text-slate-500 max-w-[8rem] truncate" title={l.factoryName}>{l.factoryName}</span>
                        <span className="block mt-0.5"><StatusLabel status={status} /></span>
                        {l.componentSettingNotCounted !== 0 && (
                          <span className="block mt-0.5 max-w-[10rem] whitespace-normal text-amber-800" title={settingNotCountedRemark(l.componentSettingNotCounted)}>
                            Component setting {fmtNum(l.componentSettingNotCounted)} not counted
                          </span>
                        )}
                      </td>
                    )}
                    {show('jewellery') && (
                      <td className="px-2 py-1.5 whitespace-nowrap" rowSpan={rows.length}>
                        <span className="font-semibold text-slate-900">{l.jewNo}</span>
                        {l.bagNo && <span className="block text-slate-500">Bag {l.bagNo}</span>}
                        <span className="block text-slate-500">{l.productType ?? ''}</span>
                      </td>
                    )}
                    {show('sku') && <td className="px-2 py-1.5 whitespace-nowrap" rowSpan={rows.length}>{l.skuNo ?? '—'}</td>}
                    {show('jobCategory') && (
                      <td className="px-2 py-1.5 whitespace-nowrap" rowSpan={rows.length}>
                        {/* Repair jobs are not new-make labour — make them stand out */}
                        <span className={l.jobCategory && l.jobCategory !== 'Normal' ? 'px-1.5 rounded bg-amber-100 text-amber-900' : ''}>{l.jobCategory ?? '—'}</span>
                      </td>
                    )}
                    {show('metalType') && <td className="px-2 py-1.5 whitespace-nowrap" rowSpan={rows.length}>{metalTypeLabel(l.metalType)}</td>}
                    {show('qty') && <td className={`${td} text-right`} rowSpan={rows.length}>{fmtNum(l.qty, 0)}</td>}
                    {show('grossWt') && (
                      <td className={`${td} text-right`} rowSpan={rows.length} title={l.grossWtCalculated ? 'Not on the invoice — net wt + stones (ct ÷ 5)' : undefined}>
                        {num(l.grossWt, 3)}{l.grossWtCalculated && <span className="text-slate-400">*</span>}
                      </td>
                    )}
                    {show('netWt') && <td className={`${td} text-right`} rowSpan={rows.length}>{num(l.netWt, 3)}</td>}
                    {show('diaWt') && <td className={`${td} text-right`} rowSpan={rows.length}>{l.diamondWt ? num(l.diamondWt, 3) : '—'}</td>}
                    {show('csWt') && <td className={`${td} text-right`} rowSpan={rows.length}>{l.colorStoneWt ? num(l.colorStoneWt, 3) : '—'}</td>}
                  </>
                ) : null}
                {show('lotCode') && <td className={`px-2 py-1.5 whitespace-nowrap max-w-[10rem] truncate ${divider('lotCode')}`} title={r.lotCode ?? undefined}>{r.lotCode ?? '—'}</td>}
                {show('commodity') && <td className={`px-2 py-1.5 max-w-[9rem] truncate ${divider('commodity')}`} title={r.commodity ?? undefined}>{r.commodity ?? '—'}</td>}
                {show('item') && (
                  <td className={`px-2 py-1.5 min-w-[9rem] ${divider('item')}`}>
                    <span className="text-slate-400">{KIND_TEXT[r.kind]} · </span>{r.item}
                    {(r.settingType || r.size) && (
                      <span className="block text-slate-500">
                        {r.settingType && (
                          <span title={r.notes.find((n) => TYPE_NOTES.has(n.code))?.text}>
                            {r.settingType}
                            {r.settingTypeSource === 'DEFAULT' ? ' (default)' : r.settingTypeSource === 'INVOICE' ? ' (from invoice)' : r.settingTypeSource === 'CHOSEN' ? ' (chosen)' : ''}
                          </span>
                        )}
                        {r.settingType && r.size && ' · '}
                        {r.size}
                      </span>
                    )}
                    {r.notes.some((n) => !TYPE_NOTES.has(n.code)) && (
                      <span className="flex flex-wrap gap-1 mt-0.5">
                        {r.notes.filter((n) => !TYPE_NOTES.has(n.code)).map((n) => (
                          <span key={n.code} title={n.text} className={`px-1.5 rounded text-[11px] cursor-help ${NOTE_STYLE[n.code] ?? 'bg-amber-50 text-amber-800'}`}>
                            {n.short}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                )}
                {show('qtyWt') && (
                  <td className={`${td} text-right whitespace-nowrap ${divider('qtyWt')}`}>
                    {r.wt != null ? `${fmtNum(r.wt, 3)} ${r.wtUom ?? ''}` : '—'}
                    {r.perStoneWt != null && <span className="block text-slate-500">{fmtNum(r.perStoneWt, 4)} ct/pc</span>}
                  </td>
                )}
                {show('pcs') && <td className={`${td} text-right ${divider('pcs')}`}>{num(r.pcs, 0)}</td>}
                {show('invRate') && <td className={`${td} text-right ${SIDE.invoice.cell}`}>{num(r.invoiceRate, 4)}</td>}
                {show('invAmt') && <td className={`${td} text-right ${SIDE.invoice.cell}`}>{num(r.invoiceAmount, 2)}</td>}
                {show('chartRate') && <td className={`${td} text-right ${SIDE.chart.cell}`}>{num(r.chartRate, 4)}</td>}
                {show('chartAmt') && <td className={`${td} text-right ${SIDE.chart.cell}`}><ChartAmount value={r.chartAmount} calc={r.chartCalc} empty="—" sku={skuOf(l, rows, chartCode)} /></td>}
                {show('diff') && <td className={`${td} text-right whitespace-nowrap ${SIDE.diff.cell}`}>{r.variance == null ? '—' : <Variance value={r.variance} />}</td>}
                {show('diffPct') && (
                  <td className={`${td} pr-4 text-right whitespace-nowrap ${SIDE.diff.cell} ${(r.variancePct ?? 0) > 0 ? 'text-red-700' : (r.variancePct ?? 0) < 0 ? 'text-sky-700' : ''}`}>
                    {r.variancePct == null ? '—' : `${r.variancePct > 0 ? '+' : ''}${fmtNum(r.variancePct, 1)}%`}
                  </td>
                )}
              </tr>
            ))}
          </Fragment>
        ))}
        {groups.length === 0 && <tr><td colSpan={Math.max(1, visible)} className="px-4 py-6 text-center text-slate-500">No lines match.</td></tr>}
      </tbody>
    </table>
  );
}
