import type { LabourBreakupRow, LotGroup, LotRow } from '@/lib/labourLotReport';
import { chartCalc, sumCalcs, type ChartCalc } from '@/lib/chartCalc';

// One jewellery block of the "Job Work Details" layout (ERP Job Work Details
// report): metal lots, colour stones, diamonds and the invoice's labour rows
// side by side, with invoice vs chart labour totals. Shared by the screen table
// and the Excel sheet so both show the same figures.
//
// The labour breakup is the invoice's own labour table (process names as
// invoiced), each row with its chart amount — see buildLabourBreakup. A
// stone's setting shows in one place only: in the labour row it was invoiced
// in ("Side Stone Setting", "Setting"…), or — when the line has no setting
// labour row and the amount is on the stone components — in the stone
// section (labourComparisonData decides which). So:
//   chart total   = breakup chart amounts + chart of stones set on the stone
//   invoice total = breakup invoice amounts + setting recorded on the stones

// The setting amounts a stone shows in the stone section: its own when the
// setting is recorded on the stone, none when it's in a labour row.
export interface StoneSetting {
  invoiceRate: number | null;
  invoiceAmount: number | null;
  chartRate: number | null;
  chartAmount: number | null;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function stoneSetting(s: LotRow): StoneSetting {
  if (s.settingOnStone === 0) return { invoiceRate: null, invoiceAmount: null, chartRate: null, chartAmount: null };
  return {
    invoiceRate: s.pcs ? r4(s.settingOnStone / s.pcs) : null,
    invoiceAmount: s.settingOnStone,
    chartRate: s.chartRate,
    chartAmount: s.chartAmount,
  };
}

// Which side of a row has no amount, so the screen and Excel can shade it: a
// stone the setting chart can't price, labour the chart has no rate for, or a
// chart amount with nothing invoiced against it. A stone set in a labour row
// is only flagged when the chart can't price it (its amounts are in that row).
export type MissingSide = 'chart' | 'invoice' | null;

export function missingSide(r: LotRow | LabourBreakupRow): MissingSide {
  const hasChart = r.chartAmount != null;
  if ('kind' in r && r.kind === 'SETTING' && r.settingOnStone === 0) return hasChart ? null : 'chart';
  const hasInvoice = (('kind' in r && r.kind === 'SETTING' ? r.settingOnStone : r.invoiceAmount) ?? 0) !== 0;
  if (hasInvoice && !hasChart) return 'chart';
  if (hasChart && !hasInvoice) return 'invoice';
  return null;
}

const stoneName = (r: LotRow) => [r.commodity, r.item !== '—' ? r.item : null].filter(Boolean).join(' ');

// The note for a line with setting both in a labour row and on the stone
// components: the labour row counts, the component amount is left out.
export const settingNotCountedRemark = (amount: number) =>
  amount ? `Component setting ${amount.toFixed(2)} not counted — setting taken from the labour rows` : '';

// "No chart amount: Findings, TANZANITE TRILLION; No invoice amount: Basic — under 5 pcs per style"
// "35–65 within" — a CAD row's model-making range and where the invoice falls.
export const rangeText = (r: NonNullable<LabourBreakupRow['chartRange']>) =>
  `${r.min}–${r.max} ${r.status === 'WITHIN' ? 'within' : r.status === 'ABOVE' ? 'above' : 'below'}`;

function remarksFor(stones: LotRow[], labour: LabourBreakupRow[], componentSettingNotCounted: number): string {
  const noChart = new Set<string>();
  const noInvoice = new Set<string>();
  const ranges: string[] = [];
  for (const s of stones) if (missingSide(s) === 'chart') noChart.add(stoneName(s));
  for (const x of labour) {
    if (x.chartRange) {
      ranges.push(`${x.process} ${x.invoiceAmount} vs model-making range ${rangeText(x.chartRange)} (not in the totals)`);
      continue;
    }
    const side = missingSide(x);
    if (side === 'chart') noChart.add(x.process);
    else if (side === 'invoice') noInvoice.add(x.process);
  }
  return [
    noChart.size ? `No chart amount: ${Array.from(noChart).join(', ')}` : null,
    noInvoice.size ? `No invoice amount: ${Array.from(noInvoice).join(', ')}` : null,
    ...ranges,
    settingNotCountedRemark(componentSettingNotCounted) || null,
  ]
    .filter(Boolean)
    .join('; ');
}

export interface JobWorkBlock {
  group: LotGroup;
  colour: LotRow[];
  diamonds: LotRow[];
  labour: LabourBreakupRow[];
  height: number; // rows the block takes: the longest breakup, at least 1
  invoiceTotal: number;
  chartTotal: number;
  difference: number; // invoice − chart
  differencePct: number | null; // fraction of the chart total; null when the chart total is 0
  incomplete: boolean; // some stone or labour row has only one side, so the difference isn't like for like
  remarks: string; // what is missing, empty when nothing is
  chartCalc: ChartCalc | null; // how the chart total is made up: every labour row and stone set on the stone
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export function jobWorkBlock(group: LotGroup): JobWorkBlock {
  const stones = group.rows.filter((r) => r.kind === 'SETTING');
  const colour = stones.filter((r) => r.stone === 'COLOR');
  const diamonds = stones.filter((r) => r.stone !== 'COLOR');
  const labour = group.labour;
  const invoiceTotal = r2(sum(labour.map((x) => x.invoiceAmount)) + group.stoneSettingInvoiced);
  const chartTotal = r2(sum(labour.map((x) => x.chartAmount)) + sum(stones.map((s) => stoneSetting(s).chartAmount)));
  return {
    group,
    colour,
    diamonds,
    labour,
    height: Math.max(1, group.line.metals.length, colour.length, diamonds.length, labour.length),
    invoiceTotal,
    chartTotal,
    difference: r2(invoiceTotal - chartTotal),
    differencePct: chartTotal > 0 ? (invoiceTotal - chartTotal) / chartTotal : null,
    incomplete: [...stones, ...labour].some((r) => missingSide(r) != null),
    remarks: remarksFor(stones, labour, group.line.componentSettingNotCounted),
    chartCalc: sumCalcs(
      'Total chart labour',
      [
        ...labour.map((x) => withPrefix(x.process, x.chartCalc)),
        ...stones.filter((s) => stoneSetting(s).chartAmount != null).map((s) => withPrefix('Setting on the stone', s.chartCalc)),
      ],
      chartTotal,
    ),
  };
}

// Parts of a labour row's calc, titled with the row they belong to in the total.
const withPrefix = (prefix: string, calc: ChartCalc | null | undefined): ChartCalc | null =>
  calc ? { ...calc, parts: calc.parts.map((p) => ({ ...p, title: `${prefix} · ${p.title}` })) } : null;

export interface JobWorkTotals {
  qty: number;
  grossWt: number;
  metalWt: number;
  colourPcs: number;
  colourWt: number;
  diamondPcs: number;
  diamondWt: number;
  invoiceTotal: number;
  chartTotal: number;
  difference: number;
  differencePct: number | null;
  chartCalc: ChartCalc | null; // the chart total of every jewellery added up
}

export function jobWorkTotals(blocks: JobWorkBlock[]): JobWorkTotals {
  const add = (pick: (b: JobWorkBlock) => number) => blocks.reduce((a, b) => a + pick(b), 0);
  const invoiceTotal = r2(add((b) => b.invoiceTotal));
  const chartTotal = r2(add((b) => b.chartTotal));
  return {
    qty: add((b) => b.group.line.qty),
    grossWt: add((b) => b.group.line.grossWt ?? 0),
    metalWt: add((b) => sum(b.group.line.metals.map((m) => m.grams))),
    colourPcs: add((b) => sum(b.colour.map((s) => s.pcs))),
    colourWt: add((b) => sum(b.colour.map((s) => s.wt))),
    diamondPcs: add((b) => sum(b.diamonds.map((s) => s.pcs))),
    diamondWt: add((b) => sum(b.diamonds.map((s) => s.wt))),
    invoiceTotal,
    chartTotal,
    difference: r2(invoiceTotal - chartTotal),
    differencePct: chartTotal > 0 ? (invoiceTotal - chartTotal) / chartTotal : null,
    chartCalc: chartCalc(
      'Total chart labour',
      blocks.filter((b) => b.chartTotal !== 0).map((b) => ({ title: `${b.group.line.jewNo} · ${b.group.line.invNo}`, steps: [], formula: null, amount: b.chartTotal })),
      chartTotal,
    ),
  };
}
