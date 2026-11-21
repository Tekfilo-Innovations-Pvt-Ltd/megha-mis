'use client';

import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import type { LotReport } from '@/lib/labourReport';
import type { LotLine, LotRow } from '@/lib/labourLotReport';
import { jobWorkBlock, jobWorkTotals, missingSide, rangeText, stoneSetting } from '@/lib/jobWorkBlocks';
import { fmtDate, fmtNum } from '@/lib/format';
import { metalTypeLabel } from '@/lib/metalType';
import ChartAmount from '@/components/labour/ChartAmount';
import { SIDE } from '@/components/labour/sides';
import type { ColumnDef, HiddenColumns } from '@/components/labour/columns';

// "Job Work" view of the labour-vs-chart report, in the layout of the ERP's
// Job Work Details Excel: one block per jewellery with metal, colour stone,
// diamond and labour breakups side by side, then invoice vs chart labour
// totals and their difference. An amount with nothing on the other side
// (no chart rate, or nothing invoiced) is shaded, as is that jewellery's
// difference, and the Remarks column says what is missing.
//
// Columns can be hidden (JOB_WORK_COLUMNS); the less used ones start hidden
// so the table needs less sideways scrolling.

const cell = 'border border-slate-300 px-2 py-1 align-middle';
const head = `${cell} bg-[#F9F5F5] font-semibold text-slate-800 text-center`;
const text = `${cell} text-center`;
const num = `${cell} text-right tabular-nums whitespace-nowrap`;

const fmt = (v: number | null | undefined, digits: number) => (v == null ? '' : fmtNum(v, digits));
const diffClass = (v: number | null) => (v != null && v < 0 ? 'text-red-600' : '');
const pct = (v: number | null) => (v == null ? '' : `${fmtNum(v * 100, 2)}%`);
const MISSING_BG = 'bg-amber-100';
// Each jewellery starts below a thick dark rule, and blocks alternate white / grey,
// so where one item ends and the next begins is plain at a glance.
const BLOCK_START = 'border-t-[3px] border-t-slate-600';
// Invoice / chart / difference columns carry their colour band; a missing amount's amber wins.
type Side = keyof typeof SIDE;
const tint = (side: Side | undefined, missing = false) => (missing ? MISSING_BG : side ? SIDE[side].cell : '');
const headFor = (side?: Side) => (side ? `${cell} font-semibold text-center ${SIDE[side].head}` : head);

type Block = ReturnType<typeof jobWorkBlock>;
type Totals = ReturnType<typeof jobWorkTotals>;

// Columns of the jewellery (one cell spanning its block).
const LINE_COLS: { key: string; label: string; hidden?: boolean; cls: string; render: (l: LotLine, sNo: number) => ReactNode; total?: (t: Totals) => ReactNode }[] = [
  { key: 'sNo', label: 'S.No', cls: `${text} w-10`, render: (_, n) => n },
  {
    key: 'invNo', label: 'Job Work Invoice No', cls: `${text} whitespace-nowrap`,
    render: (l) => <Link href={`/dashboard/factory-invoices/${l.invId}`} className="text-amber-700 hover:underline" title="Open the invoice">{l.invNo}</Link>,
  },
  { key: 'invDt', label: 'Invoice Date', cls: `${text} whitespace-nowrap`, render: (l) => fmtDate(l.invDt) },
  { key: 'soNo', label: 'SO No', hidden: true, cls: `${text} whitespace-nowrap`, render: (l) => l.soNo },
  { key: 'jobNo', label: 'Job No', cls: `${text} whitespace-nowrap font-semibold text-slate-900`, render: (l) => l.jewNo },
  { key: 'bagNo', label: 'Bag No', hidden: true, cls: `${text} whitespace-nowrap`, render: (l) => l.bagNo },
  { key: 'sku', label: 'SKU No', cls: `${text} whitespace-nowrap`, render: (l) => l.skuNo },
  { key: 'category', label: 'Jewellery Category', cls: text, render: (l) => l.productType },
  { key: 'metalType', label: 'Metal Type', cls: `${text} whitespace-nowrap`, render: (l) => metalTypeLabel(l.metalType) },
  { key: 'size', label: 'Size', hidden: true, cls: text, render: (l) => l.size },
  { key: 'qty', label: 'Qty', cls: num, render: (l) => fmt(l.qty, 0), total: (t) => fmt(t.qty, 0) },
  { key: 'grossWt', label: 'Gross Wt(g)', hidden: true, cls: num, render: (l) => fmt(l.grossWt, 3), total: (t) => fmt(t.grossWt, 3) },
];

const METAL_COLS: { key: string; label: string; hidden?: boolean; cls: string; render: (m: LotLine['metals'][number] | undefined) => ReactNode; total?: (t: Totals) => ReactNode }[] = [
  { key: 'metal', label: 'Metal', cls: text, render: (m) => m?.commodity },
  { key: 'metalLot', label: 'Metal Lot Code', hidden: true, cls: `${text} whitespace-nowrap`, render: (m) => m?.lotCode },
  { key: 'metalWt', label: 'Metal Wt', cls: num, render: (m) => fmt(m?.grams, 3), total: (t) => fmt(t.metalWt, 3) },
];

// Colour stones and diamonds share one "Stone Details" group — colour stones
// first, then diamonds — told apart by the Stone Type column.
type StoneCtx = { s: LotRow; diamond: boolean; set: ReturnType<typeof stoneSetting>; missing: ReturnType<typeof missingSide> };
const STONE_COLS: {
  key: string; label: string; hidden?: boolean; side?: Side; numeric?: boolean;
  render: (c: StoneCtx) => ReactNode; missingOn?: 'invoice' | 'chart';
  total?: (t: Totals) => ReactNode;
}[] = [
  { key: 'type', label: 'Stone Type', render: ({ diamond }) => (diamond ? 'Diamond' : 'Colour Stone') },
  { key: 'lot', label: 'Lot Code', render: ({ s }) => s.lotCode },
  { key: 'master', label: 'Master Lot Code', hidden: true, render: ({ s }) => s.masterLotCode },
  { key: 'commodity', label: 'Commodity', render: ({ s }) => s.commodity },
  { key: 'shape', label: 'Shape', render: ({ s }) => s.item },
  { key: 'mm', label: 'MM Size', render: ({ s }) => s.mmSize },
  { key: 'pcs', label: 'PCS', numeric: true, render: ({ s }) => fmt(s.pcs, 0), total: (t) => fmt((t.colourPcs ?? 0) + (t.diamondPcs ?? 0), 0) },
  { key: 'wt', label: 'Stone Wt', numeric: true, render: ({ s }) => fmt(s.wt, 3), total: (t) => fmt((t.colourWt ?? 0) + (t.diamondWt ?? 0), 3) },
  { key: 'invRate', label: 'Invoice Setting Rate', hidden: true, side: 'invoice', numeric: true, missingOn: 'invoice', render: ({ set }) => fmt(set.invoiceRate, 2) },
  { key: 'invAmt', label: 'Invoice Setting Amt', side: 'invoice', numeric: true, missingOn: 'invoice', render: ({ set }) => fmt(set.invoiceAmount, 2) },
  { key: 'chartRate', label: 'Chart Setting Rate', hidden: true, side: 'chart', numeric: true, missingOn: 'chart', render: ({ set }) => fmt(set.chartRate, 2) },
  { key: 'chartAmt', label: 'Chart Setting Amt', side: 'chart', numeric: true, missingOn: 'chart', render: ({ s, set }) => <ChartAmount value={set.chartAmount} calc={s.chartCalc} /> },
];

const LABOUR_COLS = [
  { key: 'labourType', label: 'Labour Type' },
  { key: 'labourInv', label: 'Invoice Amount', side: 'invoice' as Side },
  { key: 'labourChart', label: 'Chart Amount', side: 'chart' as Side },
];

const TOTAL_COLS: { key: string; label: string; side?: Side }[] = [
  { key: 'totalInv', label: 'Total Invoice Labor Amount', side: 'invoice' },
  { key: 'totalChart', label: 'Total Chart Labor Amount', side: 'chart' },
  { key: 'diff', label: 'Difference Amount', side: 'diff' },
  { key: 'diffPct', label: 'Difference %', side: 'diff' },
  { key: 'remarks', label: 'Remarks' },
];

const STONE_PREFIX = 'st.';

// Every column the viewer can show or hide, for the column picker.
export const JOB_WORK_COLUMNS: ColumnDef[] = [
  ...LINE_COLS.map((c) => ({ key: c.key, label: c.label, group: 'Jewellery', hidden: c.hidden })),
  ...METAL_COLS.map((c) => ({ key: c.key, label: c.label, group: 'Metal', hidden: c.hidden })),
  ...STONE_COLS.map((c) => ({ key: STONE_PREFIX + c.key, label: c.label, group: 'Stones (colour stone + diamond)', hidden: c.hidden })),
  ...LABOUR_COLS.map((c) => ({ key: c.key, label: c.label, group: 'Labour breakup' })),
  ...TOTAL_COLS.map((c) => ({ key: c.key, label: c.label, group: 'Totals' })),
];

export default function JobWorkTable({
  groups,
  startIndex,
  pageOnly,
  hidden,
}: {
  groups: LotReport['groups'];
  startIndex: number; // S.No of the first block, so numbering carries across pages
  pageOnly: boolean; // more lines exist than shown — the total row covers this page only
  hidden: HiddenColumns;
}) {
  const blocks = groups.map(jobWorkBlock);
  const t = jobWorkTotals(blocks);
  const show = (key: string) => !hidden.has(key);
  const lineCols = LINE_COLS.filter((c) => show(c.key));
  const metalCols = METAL_COLS.filter((c) => show(c.key));
  const stoneCols = STONE_COLS.filter((c) => show(STONE_PREFIX + c.key));
  const labourCols = LABOUR_COLS.filter((c) => show(c.key));
  const totalCols = TOTAL_COLS.filter((c) => show(c.key));
  const columnCount = lineCols.length + metalCols.length + stoneCols.length + labourCols.length + totalCols.length;
  // The totals row's label spans the jewellery columns before the first one with a total.
  const firstTotal = lineCols.findIndex((c) => c.total);
  const labelSpan = Math.max(1, firstTotal < 0 ? lineCols.length : firstTotal);

  const stoneCells = (st: { s: LotRow; diamond: boolean } | undefined) => {
    if (!st) return stoneCols.map((c) => <td key={c.key} className={`${c.numeric ? num : text} ${tint(c.side)}`} />);
    const ctx: StoneCtx = { ...st, set: stoneSetting(st.s), missing: missingSide(st.s) };
    return stoneCols.map((c) => (
      <td key={c.key} className={`${c.numeric ? num : `${text} whitespace-nowrap`} ${tint(c.side, !!c.missingOn && ctx.missing === c.missingOn)}`}>{c.render(ctx)}</td>
    ));
  };

  return (
    <table className="min-w-full text-xs border-collapse border border-slate-300 bg-white">
      <thead>
        <tr>
          {lineCols.map((c) => <th key={c.key} rowSpan={2} className={head}>{c.label}</th>)}
          {metalCols.length > 0 && <th colSpan={metalCols.length} className={head}>Metal Details - Breakup</th>}
          {stoneCols.length > 0 && <th colSpan={stoneCols.length} className={head}>Stone Details (Colour Stone &amp; Diamond)</th>}
          {labourCols.length > 0 && <th colSpan={labourCols.length} className={head}>Labour Breakup - Row wise</th>}
          {totalCols.map((c) => <th key={c.key} rowSpan={2} className={`${headFor(c.side)} min-w-[6rem]`}>{c.label}</th>)}
        </tr>
        <tr>
          {metalCols.map((c) => <th key={c.key} className={head}>{c.label}</th>)}
          {stoneCols.map((c) => <th key={c.key} className={headFor(c.side)}>{c.label}</th>)}
          {labourCols.map((c) => <th key={c.key} className={headFor(c.side)}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {blocks.length === 0 && (
          <tr>
            <td colSpan={Math.max(1, columnCount)} className="px-4 py-3 text-sm text-slate-500">No lines match the filters.</td>
          </tr>
        )}
        {blocks.map((b: Block, i) => {
          const l = b.group.line;
          const stones = [...b.colour.map((s) => ({ s, diamond: false })), ...b.diamonds.map((s) => ({ s, diamond: true }))];
          // Stones stack in one group here, so a block can be taller than the ERP layout's.
          const height = Math.max(1, l.metals.length, stones.length, b.labour.length);
          return (
            <Fragment key={l.invDetId}>
              {Array.from({ length: height }, (_, k) => {
                const m = l.metals[k];
                const x = b.labour[k];
                const xMissing = x ? missingSide(x) : null;
                return (
                  <tr key={k} className={`${k === 0 ? BLOCK_START : ''} ${i % 2 ? 'bg-slate-100' : 'bg-white'}`}>
                    {k === 0 && lineCols.map((c) => <td key={c.key} rowSpan={height} className={c.cls}>{c.render(l, startIndex + i + 1)}</td>)}
                    {metalCols.map((c) => <td key={c.key} className={c.cls}>{c.render(m)}</td>)}
                    {stoneCells(stones[k])}
                    {show('labourType') && <td className={`${text} whitespace-nowrap`}>{x?.process ?? ''}</td>}
                    {show('labourInv') && <td className={`${num} ${tint('invoice', xMissing === 'invoice')}`}>{fmt(x?.invoiceAmount, 2)}</td>}
                    {show('labourChart') && (
                      <td className={`${num} ${tint('chart', xMissing === 'chart' && !x?.chartRange)}`} title={x?.chartRange ? `Model-making range — ${x.chartRange.basis}` : undefined}>
                        {x?.chartRange && x.chartAmount == null ? (
                          <span className={`whitespace-nowrap ${x.chartRange.status === 'ABOVE' ? 'text-red-700 font-medium' : 'text-slate-500'}`}>{rangeText(x.chartRange)}</span>
                        ) : (
                          <ChartAmount value={x?.chartAmount} calc={x?.chartCalc} />
                        )}
                      </td>
                    )}
                    {k === 0 && (
                      <>
                        {show('totalInv') && <td rowSpan={height} className={`${num} ${tint('invoice')}`}>{fmt(b.invoiceTotal, 2)}</td>}
                        {show('totalChart') && <td rowSpan={height} className={`${num} ${tint('chart')}`}><ChartAmount value={b.chartTotal} calc={b.chartCalc} /></td>}
                        {show('diff') && <td rowSpan={height} className={`${num} font-medium ${diffClass(b.difference)} ${tint('diff', b.incomplete)}`}>{fmt(b.difference, 2)}</td>}
                        {show('diffPct') && <td rowSpan={height} className={`${num} font-medium ${diffClass(b.differencePct)} ${tint('diff', b.incomplete)}`}>{pct(b.differencePct)}</td>}
                        {show('remarks') && <td rowSpan={height} className={`${cell} text-left min-w-[13rem] text-slate-600`}>{b.remarks}</td>}
                      </>
                    )}
                  </tr>
                );
              })}
            </Fragment>
          );
        })}
      </tbody>
      {blocks.length > 0 && (
        <tfoot className="font-semibold">
          <tr className={BLOCK_START}>
            {/* "Total" spans the columns before the first total, so it doesn't widen S.No */}
            {lineCols.length > 0 && <td colSpan={labelSpan} className={`${text} whitespace-nowrap`}>{pageOnly ? 'Total (this page)' : 'Total'}</td>}
            {lineCols.slice(labelSpan).map((c) => <td key={c.key} className={c.total ? num : text}>{c.total?.(t)}</td>)}
            {metalCols.map((c) => <td key={c.key} className={c.total ? num : text}>{c.total?.(t)}</td>)}
            {stoneCols.map((c) => <td key={c.key} className={`${c.numeric ? num : text} ${tint(c.side)}`} title={c.total ? 'Colour stones and diamonds together' : undefined}>{c.total?.(t)}</td>)}
            {labourCols.map((c) => <td key={c.key} className={`${text} ${tint(c.side)}`} />)}
            {show('totalInv') && <td className={`${num} ${tint('invoice')}`}>{fmt(t.invoiceTotal, 2)}</td>}
            {show('totalChart') && <td className={`${num} ${tint('chart')}`}><ChartAmount value={t.chartTotal} calc={t.chartCalc} /></td>}
            {show('diff') && <td className={`${num} ${diffClass(t.difference)} ${tint('diff')}`}>{fmt(t.difference, 2)}</td>}
            {show('diffPct') && <td className={`${num} ${diffClass(t.differencePct)} ${tint('diff')}`}>{pct(t.differencePct)}</td>}
            {show('remarks') && <td className={text} />}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
