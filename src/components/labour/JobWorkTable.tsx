'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import type { LotReport } from '@/lib/labourReport';
import type { LotRow } from '@/lib/labourLotReport';
import { jobWorkBlock, jobWorkTotals, missingSide, rangeText, stoneSetting } from '@/lib/jobWorkBlocks';
import { fmtDate, fmtNum } from '@/lib/format';
import ChartAmount from '@/components/labour/ChartAmount';

// "Job Work" view of the labour-vs-chart report, in the layout of the ERP's
// Job Work Details Excel: one block per jewellery with metal, colour stone,
// diamond and labour breakups side by side, then invoice vs chart labour
// totals and their difference. An amount with nothing on the other side
// (no chart rate, or nothing invoiced) is shaded, as is that jewellery's
// difference, and the Remarks column says what is missing.

const STONE_HEADERS = ['Lot Code', 'Master Lot Code', 'Commodity', 'Shape', 'MM Size', 'PCS', 'Stone Wt', 'Invoice Setting Rate', 'Invoice Setting Amt', 'Chart Setting Rate', 'Chart Setting Amt'];

const cell = 'border border-slate-300 px-2 py-1 align-middle';
const head = `${cell} bg-[#F9F5F5] font-semibold text-slate-800 text-center`;
const text = `${cell} text-center`;
const num = `${cell} text-right tabular-nums whitespace-nowrap`;

const fmt = (v: number | null | undefined, digits: number) => (v == null ? '' : fmtNum(v, digits));
const diffClass = (v: number | null) => (v != null && v < 0 ? 'text-red-600' : '');
const pct = (v: number | null) => (v == null ? '' : `${fmtNum(v * 100, 2)}%`);
const MISSING_BG = 'bg-amber-100';
const shade = (on: boolean) => (on ? MISSING_BG : '');

function StoneCells({ s }: { s: LotRow | undefined }) {
  if (!s) return <>{STONE_HEADERS.map((h) => <td key={h} className={text} />)}</>;
  const missing = missingSide(s);
  const set = stoneSetting(s); // blank when the setting is in a labour breakup row
  return (
    <>
      <td className={text}>{s.lotCode}</td>
      <td className={text}>{s.masterLotCode}</td>
      <td className={text}>{s.commodity}</td>
      <td className={text}>{s.item}</td>
      <td className={text}>{s.mmSize}</td>
      <td className={num}>{fmt(s.pcs, 0)}</td>
      <td className={num}>{fmt(s.wt, 3)}</td>
      <td className={`${num} ${shade(missing === 'invoice')}`}>{fmt(set.invoiceRate, 2)}</td>
      <td className={`${num} ${shade(missing === 'invoice')}`}>{fmt(set.invoiceAmount, 2)}</td>
      <td className={`${num} ${shade(missing === 'chart')}`}>{fmt(set.chartRate, 2)}</td>
      <td className={`${num} ${shade(missing === 'chart')}`}><ChartAmount value={set.chartAmount} calc={s.chartCalc} /></td>
    </>
  );
}

export default function JobWorkTable({
  groups,
  startIndex,
  pageOnly,
}: {
  groups: LotReport['groups'];
  startIndex: number; // S.No of the first block, so numbering carries across pages
  pageOnly: boolean; // more lines exist than shown — the total row covers this page only
}) {
  const blocks = groups.map(jobWorkBlock);
  const t = jobWorkTotals(blocks);
  const lineHeads: [string, string][] = [
    ['S.No', ''], ['Job Work Invoice No', ''], ['Invoice Date', ''], ['SO No', ''], ['Job No', ''], ['Bag No', ''], ['SKU No', ''], ['Jewellery Category', ''], ['Size', ''], ['Qty', ''], ['Gross Wt(g)', ''],
  ];
  const totalHeads = ['Total Invoice Labor Amount', 'Total Chart Labor Amount', 'Difference Amount', 'Difference %', 'Remarks'];

  return (
    <table className="min-w-full text-xs border-collapse border border-slate-300 bg-white">
      <thead>
        <tr>
          {lineHeads.map(([h]) => (
            <th key={h} rowSpan={2} className={head}>{h}</th>
          ))}
          <th colSpan={3} className={head}>Metal Details - Breakup</th>
          <th colSpan={11} className={head}>Color Stone Details</th>
          <th colSpan={11} className={head}>Diamond Details</th>
          <th colSpan={3} className={head}>Labour Breakup - Row wise</th>
          {totalHeads.map((h) => (
            <th key={h} rowSpan={2} className={`${head} min-w-[6rem]`}>{h}</th>
          ))}
        </tr>
        <tr>
          {['Metal', 'Metal Lot Code', 'Metal Wt'].map((h) => <th key={h} className={head}>{h}</th>)}
          {STONE_HEADERS.map((h) => <th key={`cs-${h}`} className={head}>{h}</th>)}
          {STONE_HEADERS.map((h) => <th key={`d-${h}`} className={head}>{h}</th>)}
          {['Labour Type', 'Invoice Amount', 'Chart Amount'].map((h) => <th key={h} className={head}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {blocks.length === 0 && (
          <tr>
            <td colSpan={44}className="px-4 py-3 text-sm text-slate-500">No lines match the filters.</td>
          </tr>
        )}
        {blocks.map((b, i) => {
          const l = b.group.line;
          return (
            <Fragment key={l.invDetId}>
              {Array.from({ length: b.height }, (_, k) => {
                const m = l.metals[k];
                const x = b.labour[k];
                const xMissing = x ? missingSide(x) : null;
                return (
                  <tr key={k} className={k === 0 ? 'border-t-2 border-slate-400' : ''}>
                    {k === 0 && (
                      <>
                        <td rowSpan={b.height} className={text}>{startIndex + i + 1}</td>
                        <td rowSpan={b.height} className={`${text} whitespace-nowrap`}>
                          <Link href={`/dashboard/factory-invoices/${l.invId}`} className="text-amber-700 hover:underline" title="Open the invoice">
                            {l.invNo}
                          </Link>
                        </td>
                        <td rowSpan={b.height} className={`${text} whitespace-nowrap`}>{fmtDate(l.invDt)}</td>
                        <td rowSpan={b.height} className={`${text} whitespace-nowrap`}>{l.soNo}</td>
                        <td rowSpan={b.height} className={`${text} whitespace-nowrap`}>{l.jewNo}</td>
                        <td rowSpan={b.height} className={`${text} whitespace-nowrap`}>{l.bagNo}</td>
                        <td rowSpan={b.height} className={`${text} whitespace-nowrap`}>{l.skuNo}</td>
                        <td rowSpan={b.height} className={text}>{l.productType}</td>
                        <td rowSpan={b.height} className={text}>{l.size}</td>
                        <td rowSpan={b.height} className={num}>{fmt(l.qty, 0)}</td>
                        <td rowSpan={b.height} className={num}>{fmt(l.grossWt, 3)}</td>
                      </>
                    )}
                    <td className={text}>{m?.commodity}</td>
                    <td className={`${text} whitespace-nowrap`}>{m?.lotCode}</td>
                    <td className={num}>{fmt(m?.grams, 3)}</td>
                    <StoneCells s={b.colour[k]} />
                    <StoneCells s={b.diamonds[k]} />
                    <td className={`${text} whitespace-nowrap`}>{x?.process ?? ''}</td>
                    <td className={`${num} ${shade(xMissing === 'invoice')}`}>{fmt(x?.invoiceAmount, 2)}</td>
                    <td className={`${num} ${shade(xMissing === 'chart' && !x?.chartRange)}`} title={x?.chartRange ? `Model-making range — ${x.chartRange.basis}` : undefined}>
                      {x?.chartRange && x.chartAmount == null ? (
                        <span className={`whitespace-nowrap ${x.chartRange.status === 'ABOVE' ? 'text-red-700 font-medium' : 'text-slate-500'}`}>{rangeText(x.chartRange)}</span>
                      ) : (
                        <ChartAmount value={x?.chartAmount} calc={x?.chartCalc} />
                      )}
                    </td>
                    {k === 0 && (
                      <>
                        <td rowSpan={b.height} className={num}>{fmt(b.invoiceTotal, 2)}</td>
                        <td rowSpan={b.height} className={num}><ChartAmount value={b.chartTotal} calc={b.chartCalc} /></td>
                        <td rowSpan={b.height} className={`${num} font-medium ${diffClass(b.difference)} ${shade(b.incomplete)}`}>{fmt(b.difference, 2)}</td>
                        <td rowSpan={b.height} className={`${num} font-medium ${diffClass(b.differencePct)} ${shade(b.incomplete)}`}>{pct(b.differencePct)}</td>
                        <td rowSpan={b.height} className={`${cell} text-left min-w-[16rem] text-slate-600`}>{b.remarks}</td>
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
          <tr className="border-t-2 border-slate-400">
            <td colSpan={9} className={text}>{pageOnly ? 'Total (this page)' : 'Total'}</td>
            <td className={num}>{fmt(t.qty, 0)}</td>
            <td className={num}>{fmt(t.grossWt, 3)}</td>
            <td className={text} />
            <td className={text} />
            <td className={num}>{fmt(t.metalWt, 3)}</td>
            {Array.from({ length: 5 }, (_, k) => <td key={`cs${k}`} className={text} />)}
            <td className={num}>{fmt(t.colourPcs, 0)}</td>
            <td className={num}>{fmt(t.colourWt, 3)}</td>
            {Array.from({ length: 4 }, (_, k) => <td key={`csr${k}`} className={text} />)}
            {Array.from({ length: 5 }, (_, k) => <td key={`d${k}`} className={text} />)}
            <td className={num}>{fmt(t.diamondPcs, 0)}</td>
            <td className={num}>{fmt(t.diamondWt, 3)}</td>
            {Array.from({ length: 4 }, (_, k) => <td key={`dr${k}`} className={text} />)}
            {Array.from({ length: 3 }, (_, k) => <td key={`l${k}`} className={text} />)}
            <td className={num}>{fmt(t.invoiceTotal, 2)}</td>
            <td className={num}><ChartAmount value={t.chartTotal} calc={t.chartCalc} /></td>
            <td className={`${num} ${diffClass(t.difference)}`}>{fmt(t.difference, 2)}</td>
            <td className={`${num} ${diffClass(t.differencePct)}`}>{pct(t.differencePct)}</td>
            <td className={text} />
          </tr>
        </tfoot>
      )}
    </table>
  );
}
