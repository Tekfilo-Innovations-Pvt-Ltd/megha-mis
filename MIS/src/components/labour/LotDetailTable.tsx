'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import type { LotReport } from '@/lib/labourReport';
import type { LotNoteCode, LotRowKind } from '@/lib/labourLotReport';
import { fmtDate, fmtNum } from '@/lib/format';
import { settingNotCountedRemark } from '@/lib/jobWorkBlocks';
import ChartAmount from '@/components/labour/ChartAmount';
import { StatusLabel, Variance } from '@/components/labour/LineComparisonDetail';

// Lot detail of the labour-vs-chart report: each invoice line's columns on its
// first row, then one row per metal charge / stone lot.

const KIND_TEXT: Record<LotRowKind, string> = {
  METAL: 'Metal',
  SETTING: 'Setting',
  SETTING_LINE: 'Setting (line)',
  OTHER: 'Other',
};

// The setting type notes are shown next to the type itself, not as labels.
const TYPE_NOTES = new Set<LotNoteCode>(['TYPE_DEFAULT', 'TYPE_INVOICE']);

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

export default function LotDetailTable({ groups }: { groups: LotReport['groups'] }) {
  const th = 'px-2 py-1.5 font-medium whitespace-nowrap';
  const td = 'px-2 py-1.5 tabular-nums';
  return (
    <table className="min-w-full text-xs">
      <thead className="text-slate-500 bg-slate-50">
        <tr>
          <th className={`${th} pl-4 text-left`}>Invoice No / Date</th>
          <th className={`${th} text-left`}>Jewellery No</th>
          <th className={`${th} text-left`}>SKU No</th>
          <th className={`${th} text-left`}>Job Category</th>
          <th className={`${th} text-right`}>Qty</th>
          <th className={`${th} text-right`}>Gross Wt</th>
          <th className={`${th} text-right`}>Net Wt</th>
          <th className={`${th} text-right`}>Dia Wt</th>
          <th className={`${th} text-right`}>CS Wt</th>
          <th className={`${th} text-left border-l border-slate-200`}>Lot Code</th>
          <th className={`${th} text-left`}>Commodity</th>
          <th className={`${th} text-left`}>Item</th>
          <th className={`${th} text-right`}>Qty Wt</th>
          <th className={`${th} text-right`}>Qty Pcs</th>
          <th className={`${th} text-right`}>Inv Rate</th>
          <th className={`${th} text-right`}>Inv Amount</th>
          <th className={`${th} text-right`}>Chart Rate</th>
          <th className={`${th} text-right`}>Chart Amount</th>
          <th className={`${th} text-right`}>Diff Amount</th>
          <th className={`${th} pr-4 text-right`}>Diff %</th>
        </tr>
      </thead>
      <tbody>
        {groups.map(({ line: l, rows, status }) => (
          <Fragment key={l.invDetId}>
            {rows.map((r, i) => (
              <tr key={i} className={`${i === 0 ? 'border-t border-slate-200' : ''} ${r.kind === 'OTHER' ? 'text-slate-500' : ''} align-top`}>
                {i === 0 ? (
                  <>
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
                    <td className="px-2 py-1.5 whitespace-nowrap" rowSpan={rows.length}>
                      {l.jewNo}
                      {l.bagNo && <span className="block text-slate-500">Bag {l.bagNo}</span>}
                      <span className="block text-slate-500">{l.productType ?? ''}</span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap" rowSpan={rows.length}>{l.skuNo ?? '—'}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap" rowSpan={rows.length}>
                      {/* Repair jobs are not new-make labour — make them stand out */}
                      <span className={l.jobCategory && l.jobCategory !== 'Normal' ? 'px-1.5 rounded bg-amber-100 text-amber-900' : ''}>{l.jobCategory ?? '—'}</span>
                    </td>
                    <td className={`${td} text-right`} rowSpan={rows.length}>{fmtNum(l.qty, 0)}</td>
                    <td className={`${td} text-right`} rowSpan={rows.length} title={l.grossWtCalculated ? 'Not on the invoice — net wt + stones (ct ÷ 5)' : undefined}>
                      {num(l.grossWt, 3)}{l.grossWtCalculated && <span className="text-slate-400">*</span>}
                    </td>
                    <td className={`${td} text-right`} rowSpan={rows.length}>{num(l.netWt, 3)}</td>
                    <td className={`${td} text-right`} rowSpan={rows.length}>{l.diamondWt ? num(l.diamondWt, 3) : '—'}</td>
                    <td className={`${td} text-right`} rowSpan={rows.length}>{l.colorStoneWt ? num(l.colorStoneWt, 3) : '—'}</td>
                  </>
                ) : null}
                <td className="px-2 py-1.5 whitespace-nowrap border-l border-slate-200 max-w-[10rem] truncate" title={r.lotCode ?? undefined}>{r.lotCode ?? '—'}</td>
                <td className="px-2 py-1.5 max-w-[9rem] truncate" title={r.commodity ?? undefined}>{r.commodity ?? '—'}</td>
                <td className="px-2 py-1.5 min-w-[9rem]">
                  <span className="text-slate-400">{KIND_TEXT[r.kind]} · </span>{r.item}
                  {(r.settingType || r.size) && (
                    <span className="block text-slate-500">
                      {r.settingType && (
                        <span title={r.notes.find((n) => n.code === 'TYPE_DEFAULT' || n.code === 'TYPE_INVOICE')?.text}>
                          {r.settingType}
                          {r.settingTypeSource === 'DEFAULT' ? ' (default)' : r.settingTypeSource === 'INVOICE' ? ' (from invoice)' : ''}
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
                <td className={`${td} text-right whitespace-nowrap`}>
                  {r.wt != null ? `${fmtNum(r.wt, 3)} ${r.wtUom ?? ''}` : '—'}
                  {r.perStoneWt != null && <span className="block text-slate-500">{fmtNum(r.perStoneWt, 4)} ct/pc</span>}
                </td>
                <td className={`${td} text-right`}>{num(r.pcs, 0)}</td>
                <td className={`${td} text-right`}>{num(r.invoiceRate, 4)}</td>
                <td className={`${td} text-right`}>{num(r.invoiceAmount, 2)}</td>
                <td className={`${td} text-right`}>{num(r.chartRate, 4)}</td>
                <td className={`${td} text-right`}><ChartAmount value={r.chartAmount} calc={r.chartCalc} empty="—" /></td>
                <td className={`${td} text-right whitespace-nowrap`}>{r.variance == null ? '—' : <Variance value={r.variance} />}</td>
                <td className={`${td} pr-4 text-right whitespace-nowrap ${(r.variancePct ?? 0) > 0 ? 'text-red-700' : (r.variancePct ?? 0) < 0 ? 'text-sky-700' : ''}`}>
                  {r.variancePct == null ? '—' : `${r.variancePct > 0 ? '+' : ''}${fmtNum(r.variancePct, 1)}%`}
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
        {groups.length === 0 && <tr><td colSpan={20} className="px-4 py-6 text-center text-slate-500">No lines match.</td></tr>}
      </tbody>
    </table>
  );
}
