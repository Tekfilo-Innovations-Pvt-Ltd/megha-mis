import {
  classifyProcess,
  METAL_ISSUE_TEXT,
  STONE_ISSUE_TEXT,
  type LabourClass,
  type LineComparison,
  type LineInput,
  type MetalIssue,
  type RangeStatus,
  type StoneIssue,
} from '@/lib/labourComparison';
import type { LineInfo } from '@/lib/labourComparisonData';
import type { PriceChart } from '@/lib/priceChart';
import { correctionText } from '@/lib/stoneCorrections';
import { chargePart, chartCalc, combinedCalc, stonePart, sumCalcs, type ChartCalc, type ChartCalcPart } from '@/lib/chartCalc';

// "Labour vs Chart — lot detail": one row per lot (metal charge, stone lot)
// of each invoice line, with the line's weights repeated on every row so the
// table can be filtered and pivoted in Excel.
//
//   METAL        a metal labour charge (Basic, J-back, …) of the line's metal lots;
//                rates are per piece of jewellery.
//   SETTING      one stone lot: setting labour from commodity + consumed weight
//                ÷ consumed pieces (per-stone weight) + setting type; rates per stone.
//                The ERP keeps a component per stone position, so components of
//                the same lot, setting type and chart size are merged into one row.
//   SETTING_LINE "Setting" labour the invoice could not tie to one lot, against
//                the chart amount of the stone lots without labour of their own.
//   OTHER        invoiced labour the chart has no rate for (plating, alloy, CAD…).

export type LotRowKind = 'METAL' | 'SETTING' | 'SETTING_LINE' | 'OTHER';

export interface LotLine {
  invDetId: number;
  invId: number;
  invNo: string;
  invDt: string;
  factoryName: string;
  jewNo: string;
  skuNo: string | null;
  soNo: string | null;
  bagNo: string | null;
  componentSettingNotCounted: number; // setting_amount on the stone components — not counted, setting comes from labour rows
  size: string | null;
  jobCategory: string | null;
  productType: string | null;
  qty: number;
  grossWt: number | null;
  grossWtCalculated: boolean; // not recorded on the invoice: net wt + stones (ct ÷ 5)
  netWt: number; // metal, grams (consumed)
  diamondWt: number; // carats (consumed)
  colorStoneWt: number; // carats (consumed)
  metals: { commodity: string; lotCode: string | null; grams: number }[]; // metal lots, consumed grams
}

// A remark on a row: a short label for the screen, the full text for hover and Excel.
export type LotNoteCode =
  | `METAL_${MetalIssue}`
  | `STONE_${StoneIssue}`
  | 'NO_CHART_RATE'
  | 'NOT_INVOICED'
  | 'TYPE_DEFAULT'
  | 'TYPE_INVOICE'
  | 'PRICED_AS_OVAL'
  | 'BILLED_ON_LINE'
  | 'LINE_AVERAGE'
  | 'LINE_EXTRA'
  | 'NOT_IN_CHART'
  | 'COMBINED'
  | 'MODEL_MAKING'
  | 'IN_COMBINED'
  | 'EMPTY_LINE'
  | 'CUSTOMER_CORRECTED';

export interface LotNote {
  code: LotNoteCode;
  short: string;
  text: string;
}

export interface LotRow {
  kind: LotRowKind;
  lotCode: string | null;
  masterLotCode: string | null; // stones only
  stone: 'DIAMOND' | 'COLOR' | null; // SETTING rows: diamond or colour stone
  commodity: string | null; // metal(s) of the line / the stone's commodity
  item: string; // charge name / stone shape
  settingType: string | null; // chart setting type name
  settingTypeSource: 'ERP' | 'INVOICE' | 'DEFAULT' | null;
  size: string | null; // chart weight range / size row used
  mmSize: string | null; // stones: MM size(s) as on the invoice
  wt: number | null;
  wtUom: 'g' | 'ct' | null;
  pcs: number | null;
  perStoneWt: number | null; // ct per stone
  settingOnStone: number; // SETTING rows: setting amount recorded on the stone component itself (0 when it's in a labour row)
  components: number; // ERP components merged into this row
  invoiceRate: number | null;
  invoiceAmount: number | null;
  chartRate: number | null;
  chartAmount: number | null;
  variance: number | null; // invoice − chart amount
  variancePct: number | null; // of the chart amount
  notes: LotNote[];
  chartCalc?: ChartCalc | null; // how the chart amount was worked out
}

// One row of the job work "Labour Breakup": the invoice's own labour rows
// (tbl_factory_invoice_labour), labour type = ERP process name, rows of the
// same process on the line added up. The chart amount is the one for that
// process: its metal charge, or for a setting process the setting chart amount
// of the stones it covers — "Side Stone Setting" the side stones (diamonds),
// "Center Stone Setting" the center stones, a plain "Setting" the rest.
// Stones whose setting is recorded on the component itself keep both amounts
// in the stone section instead. Chart amounts with no invoice row to sit
// against get a row of their own.
export interface LabourBreakupRow {
  process: string;
  invoiceAmount: number | null; // null on a chart-only row
  chartAmount: number | null; // null when the chart has no rate for this process
  chartCalc?: ChartCalc | null; // the metal charges / stones that make up the chart amount
  // CAD / model making: the chart's range for the style instead of an amount
  // (not in the chart total)
  chartRange?: { min: number; max: number; status: RangeStatus; basis: string } | null;
}

export interface LotGroup {
  line: LotLine;
  rows: LotRow[];
  labour: LabourBreakupRow[];
  stoneSettingInvoiced: number; // setting amounts on the stone components themselves (not in the labour table)
}

type StoneSectionKind = 'SIDE' | 'CENTER' | 'ANY';
const settingKind = (process: string): StoneSectionKind => {
  const n = process.toLowerCase();
  return n.includes('side') ? 'SIDE' : /cent(er|re)/.test(n) ? 'CENTER' : 'ANY';
};

export function buildLabourBreakup(input: LineInput, c: LineComparison, chart: PriceChart): LabourBreakupRow[] {
  const byProcess = new Map<string, { process: string; cls: LabourClass | null; invoice: number; chart: number | null; parts: (ChartCalcPart | null)[] }>();
  for (const l of input.labour) {
    if (l.amount === 0) continue;
    const key = l.process.trim();
    const row = byProcess.get(key) ?? { process: key, cls: classifyProcess(key), invoice: 0, chart: null, parts: [] };
    row.invoice += l.amount;
    byProcess.set(key, row);
  }
  const rows = Array.from(byProcess.values());
  const extra: LabourBreakupRow[] = [];
  const calcTitle = (process: string) => `Chart amount — ${process}`;

  // Combined rows ("CPF+ Setting + Rhodium") carry the chart amounts of their
  // parts, so those parts don't get rows of their own.
  const inCombined = new Set(c.combined.flatMap((x) => x.classes));
  for (const x of c.combined) {
    const target = rows.find((r) => r.process === x.process);
    if (!target || x.chartAmount == null) continue;
    target.chart = x.chartAmount;
    target.parts.push(...(combinedCalc(x, c, input, chart)?.parts ?? []));
  }

  // Metal charges → the first process of their class.
  for (const ch of c.metal.charges) {
    if (ch.chartAmount == null) continue;
    if (inCombined.has(ch.labourClass) && ch.invoiced === 0) continue;
    const cls = ch.labourClass;
    const target = rows.find((r) => r.cls === cls && cls != null);
    const part = chargePart(ch, c, input);
    if (target) {
      target.chart = r4((target.chart ?? 0) + ch.chartAmount);
      target.parts.push(part);
    } else extra.push({ process: ch.name, invoiceAmount: null, chartAmount: ch.chartAmount, chartCalc: chartCalc(calcTitle(ch.name), [part], ch.chartAmount) });
  }

  // Stone setting chart → the setting process for the stone's section.
  const settingRows = rows.filter((r) => r.cls === 'SETTING');
  const sectionOf = (rateGroup: string | null) => chart.settingChart.rateGroups.find((g) => g.code === rateGroup)?.section ?? null;
  // Stone setting that isn't in a labour row — recorded on the stone components
  // (AAA, e.g. bag B804664) or not invoiced at all — gets a "Side Stone Setting"
  // / "Center Stone Setting" row by the stone's chart section, so the chart
  // total's breakup is visible in the labour breakup. Its invoice amount is the
  // setting recorded on those stones, 0 when nothing was invoiced.
  const sectionRows = new Map<string, { invoice: number; chart: number | null; parts: (ChartCalcPart | null)[] }>();
  const sectionRow = (rateGroup: string | null) => {
    const section = sectionOf(rateGroup);
    const name = section === 'SIDE' ? 'Side Stone Setting' : section === 'CENTER' ? 'Center Stone Setting' : 'Stone setting';
    let x = sectionRows.get(name);
    if (!x) sectionRows.set(name, (x = { invoice: 0, chart: null, parts: [] }));
    return x;
  };
  for (const st of c.setting.stones) {
    if (inCombined.has('SETTING')) continue; // in the combined row's chart amount
    if (st.invoicedOnStone !== 0) {
      const x = sectionRow(st.rateGroup);
      x.invoice += st.invoicedOnStone;
      if (st.chartAmount != null) {
        x.chart = r4((x.chart ?? 0) + st.chartAmount);
        x.parts.push(stonePart(st, chart));
      }
      continue;
    }
    if (st.chartAmount == null) continue;
    const section = sectionOf(st.rateGroup);
    const target =
      settingRows.find((r) => settingKind(r.process) === section) ??
      settingRows.find((r) => settingKind(r.process) === 'ANY') ??
      settingRows[0];
    if (target) {
      target.chart = r4((target.chart ?? 0) + st.chartAmount);
      target.parts.push(stonePart(st, chart));
    } else {
      const x = sectionRow(st.rateGroup);
      x.chart = r4((x.chart ?? 0) + st.chartAmount);
      x.parts.push(stonePart(st, chart));
    }
  }
  for (const [name, x] of Array.from(sectionRows)) {
    extra.push({
      process: name,
      invoiceAmount: r4(x.invoice),
      chartAmount: x.chart,
      chartCalc: x.chart != null ? chartCalc(calcTitle(name), x.parts, x.chart) : null,
    });
  }

  const ranges = new Map(c.modelMaking.map((m) => [m.process, m]));
  return [
    ...rows.map((r) => {
      const m = ranges.get(r.process);
      return {
        process: r.process,
        invoiceAmount: r4(r.invoice),
        chartAmount: r.chart,
        chartCalc: r.chart != null ? chartCalc(calcTitle(r.process), r.parts, r.chart) : null,
        ...(m ? { chartRange: { min: m.min, max: m.max, status: m.status, basis: m.basis } } : {}),
      };
    }),
    ...extra,
  ];
}

const METAL_SHORT: Record<MetalIssue, string> = {
  NO_QTY: 'No qty',
  NO_METAL: 'No metal wt',
  OTHER_METAL: 'Metal not in chart',
  NO_PRODUCT_TYPE: 'Product type not in chart',
  NO_WEIGHT_RANGE: 'Wt outside chart',
  CURRENCY: 'Other currency',
};

const STONE_SHORT: Record<StoneIssue, string> = {
  NO_COMMODITY: 'Commodity not in chart',
  NO_SHAPE: 'Shape not in chart',
  NO_PIECES: 'No pcs',
  NO_SIZE: 'Size outside chart',
  NO_SETTING_TYPE: 'Setting type not in chart',
  NO_RATE: 'No chart rate',
  CURRENCY: 'Other currency',
};

const NOTES: Record<Exclude<LotNoteCode, `METAL_${string}` | `STONE_${string}`>, Omit<LotNote, 'code'>> = {
  NO_CHART_RATE: { short: 'No chart rate', text: 'No per-piece chart rate for this weight range' },
  NOT_INVOICED: { short: 'Not invoiced', text: 'No metal labour invoiced' },
  TYPE_DEFAULT: { short: 'Default type', text: 'Setting type not recorded — default used' },
  TYPE_INVOICE: { short: 'Type from invoice', text: 'Setting type from the invoice labour description' },
  PRICED_AS_OVAL: { short: 'Priced as oval', text: 'Priced on the Oval column of the chart: round / triangle / cushion Ruby or Sapphire, cushion / trillion colour stones' },
  BILLED_ON_LINE: { short: 'Billed on line', text: 'Invoiced in the line-level setting row' },
  LINE_AVERAGE: { short: 'Avg per stone', text: 'Invoice setting labour not tied to one lot — rates are averages per stone' },
  LINE_EXTRA: {
    short: 'Possible double setting',
    text: 'Line-level setting labour on top of the setting already invoiced on every stone — check for double charging',
  },
  NOT_IN_CHART: { short: 'Not in chart', text: 'The chart has no rate for this labour' },
  COMBINED: { short: 'Combined row', text: 'One invoice row for several charges — compared with their chart amounts added up' },
  MODEL_MAKING: { short: 'Model making range', text: "CAD checked against the chart's model-making range (not in the totals)" },
  IN_COMBINED: { short: 'In combined row', text: 'Invoiced inside a combined labour row on this line' },
  EMPTY_LINE: { short: 'Nothing to compare', text: 'No metal weight, stones or labour on this line' },
  CUSTOMER_CORRECTED: { short: 'Customer correction', text: 'Shape / MM size from the customer stone sheet' },
};

const note = (code: keyof typeof NOTES): LotNote => ({ code, ...NOTES[code] });
const metalNote = (i: MetalIssue): LotNote => ({ code: `METAL_${i}`, short: METAL_SHORT[i], text: METAL_ISSUE_TEXT[i] });
const stoneNote = (i: StoneIssue): LotNote => ({ code: `STONE_${i}`, short: STONE_SHORT[i], text: STONE_ISSUE_TEXT[i] });

export const lotNoteText = (notes: LotNote[]) => notes.map((n) => n.text).join('; ');

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const per = (amount: number, qty: number | null) => (qty && qty > 0 ? r4(amount / qty) : null);
const isDiamond = (commodity: string, group: string) => commodity.includes('DIAMOND') || group.includes('DIA');

// Adds up nullable amounts: null only when every part is null.
const addNullable = (xs: (number | null)[]) => (xs.every((x) => x == null) ? null : r4(sum(xs.map((x) => x ?? 0))));

// Merges SETTING rows of the same lot, stone, setting type and chart size row;
// weights, pieces and amounts are added up and the rates worked out again.
function mergeSettingRows(rows: LotRow[]): LotRow[] {
  const byKey = new Map<string, LotRow[]>();
  for (const r of rows) {
    const key = [r.lotCode, r.item, r.settingType, r.settingTypeSource, r.size, r.settingOnStone !== 0, r.notes.map((n) => n.code).join(',')].join('|');
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  return Array.from(byKey.values()).map((group) => {
    if (group.length === 1) return group[0];
    const wt = addNullable(group.map((r) => r.wt));
    const pcs = sum(group.map((r) => r.pcs ?? 0));
    const invoiceAmount = addNullable(group.map((r) => r.invoiceAmount));
    const chartAmount = addNullable(group.map((r) => r.chartAmount));
    return {
      ...group[0],
      wt,
      pcs,
      perStoneWt: wt != null ? per(wt, pcs) : null,
      components: sum(group.map((r) => r.components)),
      invoiceRate: invoiceAmount != null ? per(invoiceAmount, pcs) : null,
      invoiceAmount,
      chartRate: chartAmount != null ? per(chartAmount, pcs) : null,
      chartAmount,
      chartCalc: chartAmount != null ? sumCalcs(group[0].chartCalc?.title ?? 'Chart setting amount', group.map((r) => r.chartCalc), chartAmount) : null,
      mmSize: Array.from(new Set(group.map((r) => r.mmSize).filter(Boolean))).join(', ') || null,
      settingOnStone: r4(sum(group.map((r) => r.settingOnStone))),
      variance: addNullable(group.map((r) => r.variance)),
      variancePct: null,
    };
  });
}

export function buildLotGroup(info: LineInfo, input: LineInput, c: LineComparison, chart: PriceChart): LotGroup {
  const groupOf = new Map(input.stones.map((s) => [s.componentId, s]));
  const carats = (dia: boolean) =>
    r4(sum(input.stones.filter((s) => isDiamond(s.commodity, s.commodityGroup) === dia).map((s) => s.carats ?? 0)));
  const netWt = r4(sum(input.metal.map((m) => m.grams)));
  const diamondWt = carats(true);
  const colorStoneWt = carats(false);

  const line: LotLine = {
    invDetId: info.invDetId,
    invId: info.invId,
    invNo: info.invNo,
    invDt: info.invDt,
    factoryName: info.factoryName,
    jewNo: info.jewNo,
    skuNo: info.skuNo,
    soNo: info.soNo,
    bagNo: info.bagNo,
    componentSettingNotCounted: info.componentSettingNotCounted,
    size: info.size,
    jobCategory: info.jobCategory,
    productType: input.productType,
    qty: input.qty,
    grossWt: info.grossWt ?? r4(netWt + (diamondWt + colorStoneWt) / 5),
    grossWtCalculated: info.grossWt == null,
    netWt,
    diamondWt,
    colorStoneWt,
    metals: input.metal.map((m) => ({ commodity: m.commodity, lotCode: m.lotCode ?? null, grams: m.grams })),
  };

  const rows: LotRow[] = [];
  const blank = {
    masterLotCode: null,
    stone: null,
    settingType: null,
    settingTypeSource: null,
    size: null,
    mmSize: null,
    perStoneWt: null,
    components: 1,
    settingOnStone: 0,
  } as const;

  // ---- metal ----
  const metalLots = input.metal.map((m) => m.lotCode).filter(Boolean).join(', ') || null;
  const metals = c.metal.metals.join(', ') || null;
  const range = c.metal.wtFrom != null ? `${c.metal.wtFrom}–${c.metal.wtTo ?? '…'} g/pc` : null;
  for (const ch of c.metal.charges) {
    const compared = ch.chartAmount != null && ch.invoiced > 0;
    rows.push({
      ...blank,
      kind: 'METAL',
      lotCode: metalLots,
      commodity: metals,
      item: ch.name,
      size: range,
      wt: netWt,
      wtUom: 'g',
      pcs: input.qty,
      invoiceRate: per(ch.invoiced, input.qty),
      invoiceAmount: ch.invoiced,
      chartRate: ch.chartRate,
      chartAmount: ch.chartAmount,
      chartCalc: chartCalc(`Chart amount — ${ch.name}`, [chargePart(ch, c, input)], ch.chartAmount),
      variance: compared ? r4(ch.invoiced - ch.chartAmount!) : null,
      variancePct: null,
      notes: c.metal.issue ? [metalNote(c.metal.issue)] : ch.note ? [{ ...note('NO_CHART_RATE'), text: ch.note }] : [],
    });
  }
  if (c.metal.charges.length === 0 && netWt > 0) {
    rows.push({
      ...blank,
      kind: 'METAL',
      lotCode: metalLots,
      commodity: metals,
      item: 'Metal labour',
      size: range,
      wt: netWt,
      wtUom: 'g',
      pcs: input.qty,
      invoiceRate: null,
      invoiceAmount: 0,
      chartRate: null,
      chartAmount: null,
      variance: null,
      variancePct: null,
      notes: [c.metal.issue ? metalNote(c.metal.issue) : note('NOT_INVOICED')],
    });
  }

  // ---- setting, per stone lot ----
  const typeName = (code: string | null) => (code ? (chart.settingChart.settingTypes.find((t) => t.code === code)?.name ?? code) : null);
  const hasLineSetting = c.setting.unallocatedLabour !== 0;
  const stoneRows: LotRow[] = c.setting.stones.map((st) => {
    const own = st.invoiced !== 0;
    const s = groupOf.get(st.componentId);
    const notes = [
      s?.corrected ? { ...note('CUSTOMER_CORRECTED'), text: `Customer stone sheet: ${correctionText(s.corrected)} (ERP value replaced)` } : null,
      st.issue ? stoneNote(st.issue) : null,
      st.settingTypeSource === 'DEFAULT' ? note('TYPE_DEFAULT') : null,
      st.settingTypeSource === 'INVOICE' ? note('TYPE_INVOICE') : null,
      st.pricedAsShape === 'OVAL' ? note('PRICED_AS_OVAL') : null,
      !own && hasLineSetting ? note('BILLED_ON_LINE') : null,
    ].filter((n): n is LotNote => n != null);
    return {
      kind: 'SETTING',
      settingOnStone: st.invoicedOnStone,
      lotCode: st.lotCode,
      masterLotCode: s?.masterLotCode ?? null,
      stone: s && !isDiamond(s.commodity, s.commodityGroup) ? 'COLOR' : 'DIAMOND',
      commodity: st.commodity,
      item: st.shape ?? '—',
      settingType: typeName(st.settingType),
      settingTypeSource: st.settingTypeSource,
      size: st.sizeLabel,
      mmSize: st.mmSize,
      wt: s?.carats ?? null,
      wtUom: s?.carats != null ? 'ct' : null,
      pcs: st.pieces,
      perStoneWt: st.caratsPerStone,
      components: 1,
      invoiceRate: own ? per(st.invoiced, st.pieces) : null,
      invoiceAmount: own ? st.invoiced : null,
      chartRate: st.chartRate,
      chartAmount: st.chartAmount,
      chartCalc: chartCalc(`Chart setting amount — ${[st.commodity, st.shape].filter(Boolean).join(' ')}`, [stonePart(st, chart)], st.chartAmount),
      variance: own && st.chartAmount != null ? r4(st.invoiced - st.chartAmount) : null,
      variancePct: null,
      notes,
    };
  });
  rows.push(...mergeSettingRows(stoneRows));

  if (hasLineSetting) {
    const open = c.setting.stones.filter((s) => s.invoiced === 0);
    const pcs = sum(open.map((s) => s.pieces));
    const chartAmount = c.setting.unallocatedChart;
    rows.push({
      ...blank,
      kind: 'SETTING_LINE',
      lotCode: Array.from(new Set(open.map((s) => s.lotCode).filter(Boolean))).join(', ') || null,
      commodity: Array.from(new Set(open.map((s) => s.commodity))).join(', ') || null,
      item: 'Setting — whole line',
      wt: null,
      wtUom: null,
      pcs,
      invoiceRate: per(c.setting.unallocatedLabour, pcs),
      invoiceAmount: c.setting.unallocatedLabour,
      chartRate: chartAmount > 0 ? per(chartAmount, pcs) : null,
      chartAmount: chartAmount > 0 ? chartAmount : null,
      chartCalc: chartAmount > 0 ? chartCalc('Chart setting amount — whole line', open.map((s) => stonePart(s, chart)), chartAmount) : null,
      variance: chartAmount > 0 ? r4(c.setting.unallocatedLabour - chartAmount) : null,
      variancePct: null,
      notes: [note(open.length === 0 && c.setting.stones.length > 0 ? 'LINE_EXTRA' : 'LINE_AVERAGE')],
    });
  }

  // ---- combined rows and CAD ----
  for (const x of c.combined) {
    rows.push({
      ...blank,
      kind: 'OTHER',
      lotCode: null,
      commodity: null,
      item: x.process,
      wt: null,
      wtUom: null,
      pcs: input.qty,
      invoiceRate: per(x.invoiced, input.qty),
      invoiceAmount: x.invoiced,
      chartRate: x.chartAmount != null ? per(x.chartAmount, input.qty) : null,
      chartAmount: x.chartAmount,
      chartCalc: combinedCalc(x, c, input, chart),
      variance: x.chartAmount != null ? r4(x.invoiced - x.chartAmount) : null,
      variancePct: null,
      notes: [x.note ? { ...note('COMBINED'), text: `${NOTES.COMBINED.text}. ${x.note}` } : note('COMBINED')],
    });
  }
  for (const m of c.modelMaking) {
    rows.push({
      ...blank,
      kind: 'OTHER',
      lotCode: null,
      commodity: null,
      item: m.process,
      size: `${m.min}–${m.max}`,
      wt: null,
      wtUom: null,
      pcs: input.qty,
      invoiceRate: null,
      invoiceAmount: m.invoiced,
      chartRate: null,
      chartAmount: null,
      variance: null,
      variancePct: null,
      notes: [{ ...note('MODEL_MAKING'), short: `Model making ${m.status.toLowerCase()} range`, text: `${m.basis} — invoiced ${m.invoiced} is ${m.status === 'WITHIN' ? 'within the range' : m.status === 'ABOVE' ? 'above the range' : 'below the range'} (not in the totals)` }],
    });
  }

  // ---- labour with no chart rate ----
  for (const x of c.notInChart) {
    rows.push({
      ...blank,
      kind: 'OTHER',
      lotCode: null,
      commodity: null,
      item: x.process,
      wt: null,
      wtUom: null,
      pcs: input.qty,
      invoiceRate: per(x.amount, input.qty),
      invoiceAmount: r4(x.amount),
      chartRate: null,
      chartAmount: null,
      variance: null,
      variancePct: null,
      notes: [note('NOT_IN_CHART')],
    });
  }

  // Every line gets a row, so none silently drops out of the Excel.
  if (rows.length === 0) {
    rows.push({
      ...blank,
      kind: 'OTHER',
      lotCode: null,
      commodity: null,
      item: 'No labour',
      wt: null,
      wtUom: null,
      pcs: input.qty,
      invoiceRate: null,
      invoiceAmount: null,
      chartRate: null,
      chartAmount: null,
      variance: null,
      variancePct: null,
      notes: [note('EMPTY_LINE')],
    });
  }

  for (const r of rows) {
    r.variancePct = r.variance != null && r.chartAmount ? Math.round((r.variance / r.chartAmount) * 1000) / 10 : null;
  }
  return {
    line,
    rows,
    labour: buildLabourBreakup(input, c, chart),
    stoneSettingInvoiced: r4(sum(input.stones.map((s) => s.settingAmount))),
  };
}
