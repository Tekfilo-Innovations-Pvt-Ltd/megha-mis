import {
  findRange,
  matchCommodity,
  metalRateIndex,
  rangeMargin,
  settingRateIndex,
  type PriceChart,
  type SizeRange,
} from '@/lib/priceChart';

// Applies a factory price chart to one factory-invoice line and compares the
// labour the factory invoiced with what the chart says it should be.
//
//   Metal:   product type + net metal weight per piece → weight range →
//            Basic (under 5 / 5 pcs up per style, by line qty) and add-ons
//            (cover back / J-back, soldering, rhodium, plating, two-tone,
//            laser stamping) × the range's margin × qty.
//   Setting: each stone → chart commodity → rate group (by shape) →
//            size range (consumed carats ÷ consumed pieces, else mm size) →
//            setting type (the stone's own, else the one named on its invoice
//            "Setting" labour row, else the default) → rate × pieces.
//            "Setting" labour rows are assigned to the stone lot they belong
//            to (see allocateSettingLabour); what can't be tied to one lot
//            stays a line-level amount.
//
// Invoice labour rows are line totals (qty 1, amount for all pieces), so chart
// amounts are line totals too. Pure — no database access — so it can be
// unit-tested; src/lib/labourComparisonData.ts loads the invoice lines.

// ---------- input ----------

export interface LineInput {
  invDetId: number;
  qty: number; // pieces on the line
  productType: string | null; // ERP product type name, upper case
  currency: string;
  metal: { commodity: string; grams: number; lotCode?: string }[]; // METAL components, net (consumed) grams
  labour: LabourInput[];
  stones: StoneInput[];
}

export interface LabourInput {
  process: string;
  amount: number;
  qty?: number; // as on the labour row — usually 1 (a line total), sometimes the pieces
  description?: string | null; // factories put the stone lot code or the setting type here
}

export interface StoneInput {
  componentId: number;
  lotCode?: string;
  masterLotCode?: string;
  commodity: string; // ERP commodity name, upper case
  commodityGroup: string;
  shape: string | null;
  mmSize: string | null; // as on the invoice, e.g. "10*8" or "1.1"
  carats: number | null; // consumed carats for the component; null when not weighed in carats
  pieces: number; // consumed pieces
  settingType: string | null; // ERP setting type name, upper case
  settingAmount: number; // setting labour invoiced on the stone itself
  // shape / mmSize replaced by the customer's stone corrections (src/lib/stoneCorrections.ts)
  corrected?: {
    source: 'STONE' | 'LOT';
    shape?: { erp: string | null; customer: string };
    mmSize?: { erp: string | null; customer: string };
  };
}

export interface ComparisonOptions {
  defaultSettingType: string; // chart setting type code used when the ERP records none
  tolerancePct: number; // variance within ±this is "in line"
}

// ---------- labour process → chart charge ----------

// Labour classes the invoice labour processes map onto. "BASIC" picks the chart's
// BASIC_UNDER_5 / BASIC_5_UP by quantity; each add-on is priced from the first of
// its CHART_CHARGES the weight range has a rate for.
export type LabourClass =
  | 'BASIC'
  | 'COVER_BACK'
  | 'J_BACK'
  | 'SOLDERING'
  | 'RHODIUM'
  | 'PLATING'
  | 'TWO_TONE'
  | 'LASER_STAMPING'
  | 'SETTING';
export const ADD_ONS: LabourClass[] = ['COVER_BACK', 'J_BACK', 'SOLDERING', 'RHODIUM', 'PLATING', 'TWO_TONE', 'LASER_STAMPING'];

// Cover back (网底) was priced on the chart's J-back column before the chart had
// its own Cover back charge (added for BANGLE from the Labour Bangle sheet,
// 2026-11-13); ranges without a Cover back rate still use J-back.
// Rhodium plating is billed as "Plating 电金" (Wilson, Golden Master, Nick) or
// "rhodium" (AAA); each is priced on the other's column where a range has no
// rate of its own. The user's rule (2026-11-14): plating uses the plain Rhodium
// rate (not the bangle sheet's × 1.35).
const CHART_CHARGES: Partial<Record<LabourClass, string[]>> = {
  COVER_BACK: ['COVER_BACK', 'J_BACK'],
  RHODIUM: ['RHODIUM', 'PLATING'],
  PLATING: ['PLATING', 'RHODIUM'],
};

// Non-precious metal parts (spring wire, steel posts) — not what a gold
// labour chart prices by weight.
export const isHardwareMetal = (commodity: string) => /TITANIUM|STEEL/.test(commodity.toUpperCase());
const chartChargesOf = (cls: LabourClass) => CHART_CHARGES[cls] ?? [cls];

// Plating and laser stamping are on nearly every ERP line but only some
// product types have a chart rate for them; without one they stay "not in chart"
// (as before they were charted) rather than making the line partial.
const ONLY_WHEN_CHARTED = new Set<LabourClass>(['PLATING', 'LASER_STAMPING']);

// A combined labour row ("CPF+ Setting + Rhodium") whose every part is a
// charge the chart prices: its classes, compared with the chart amounts of
// those charges added up for the line. Null when it isn't combined or a part
// has no chart counterpart ("Basic +CAD new pic", "Cad+Wax").
export function combinedClasses(name: string): LabourClass[] | null {
  if (!name.includes('+')) return null;
  const parts = name.split('+').map((p) => p.trim()).filter(Boolean);
  const classes = parts.map(classifyProcess);
  if (parts.length < 2 || classes.some((c) => c == null)) return null;
  return Array.from(new Set(classes as LabourClass[]));
}

// CAD / model-making labour ("cad", "CAD CHARGES", "Cad+Wax", "CAD new pic 畫圖"):
// checked against the chart's model-making table, a min–max range per style.
export const isModelMakingProcess = (name: string) => /cad/i.test(name) && !/basic|setting|cpf|胚底/i.test(name);

// ERP process names vary ("Basic 胚底", "Basic胚底", "Cover Back 网底", "solder 嵌件"…).
export function classifyProcess(name: string): LabourClass | null {
  const n = name.toLowerCase();
  if (n.includes('+')) return null; // combined rows ("CPF+ Setting + Rhodium", "Basic +CAD new pic") can't be split
  if (n.includes('setting')) return 'SETTING';
  if (n.includes('total') || n.includes('总')) return null; // summary rows, e.g. "总胚底Total Basic"
  if (n.includes('cad')) return null;
  // CPF (casting, polishing, finishing) is AAA jewelry's basic labour — the ERP's own price chart uses it for metal labour.
  if (n.includes('basic') || n.includes('胚底') || /\bcpf\b/.test(n)) return 'BASIC';
  if (n.includes('cover back') || n.includes('coverback') || n.includes('网底') || n.includes('影底')) return 'COVER_BACK';
  if (n.includes('solder') || n.includes('嵌件')) return 'SOLDERING';
  if (n.includes('rhodium')) return 'RHODIUM';
  if (n.includes('plating') || n.includes('电金')) return 'PLATING';
  if (n.includes('two-tone') || n.includes('two tone') || n.includes('分色')) return 'TWO_TONE';
  if (n.includes('laser') || n.includes('stamping') || n.includes('镭射') || n.includes('字印')) return 'LASER_STAMPING';
  return null;
}

// ---------- output ----------

export type MetalIssue = 'NO_QTY' | 'NO_METAL' | 'OTHER_METAL' | 'NO_PRODUCT_TYPE' | 'NO_WEIGHT_RANGE' | 'CURRENCY';
export type StoneIssue = 'NO_COMMODITY' | 'NO_SHAPE' | 'NO_PIECES' | 'NO_SIZE' | 'NO_SETTING_TYPE' | 'NO_RATE' | 'CURRENCY';

export interface ChargeComparison {
  code: string; // chart charge type code (BASIC_5_UP, J_BACK, …)
  labourClass: LabourClass; // the invoice labour it is compared with
  name: string;
  invoiced: number;
  baseRate?: number | null; // the chart cell, before the range's margin
  margin?: number | null; // the range's margin, when it isn't 1
  chartRate: number | null; // per piece, margin applied
  chartAmount: number | null; // rate × qty; null when the chart has no comparable rate
  note: string | null;
}

// A combined labour row (see combinedClasses) against the chart amounts of
// its parts on this line: the metal charges (rate × qty) and, for SETTING, the
// setting chart amount of the line's stones.
export interface CombinedComparison {
  process: string;
  classes: LabourClass[];
  invoiced: number;
  charges: ChargeComparison[]; // the metal parts, each with its chart amount
  settingChart: number | null; // the setting part; null when the row has none
  chartAmount: number | null; // all parts; null when one can't be priced
  note: string | null;
}

// CAD / model-making labour against the chart's model-making range for the
// style (min = simple design, max = difficult design at that weight; or the
// per-style min–max). A range, so it is checked, not added to the line totals.
export type RangeStatus = 'BELOW' | 'WITHIN' | 'ABOVE';
export interface ModelMakingCheck {
  process: string;
  invoiced: number;
  basis: string; // which chart row, e.g. "Rings, 3-5g: simple 40 – difficult 50"
  min: number;
  max: number;
  status: RangeStatus;
}

// A charge / the setting counts in the line totals only when it was invoiced.
export const isComparedCharge = (c: ChargeComparison) => c.chartAmount != null && c.invoiced > 0;
export const isComparedSetting = (s: SettingComparison) => s.invoiced > 0 && s.chartAmount > 0;

export interface MetalComparison {
  issue: MetalIssue | null;
  grams: number;
  gramsPerPiece: number | null;
  metals: string[]; // metals weighed for the chart
  hardwareMetals?: string[]; // left out of the weight (see isHardwareMetal)
  rangeId: string | null;
  wtFrom: number | null;
  wtTo: number | null;
  variant: string | null; // STUD back type — assumed when the chart has several
  charges: ChargeComparison[];
}

export type SettingTypeSource = 'ERP' | 'INVOICE' | 'DEFAULT';

export interface StoneComparison {
  componentId: number;
  lotCode: string | null;
  commodity: string;
  shape: string | null;
  pieces: number;
  carats: number | null;
  caratsPerStone: number | null;
  mmSize: string | null;
  chartCommodity: string | null; // chart commodity code
  rateGroup: string | null;
  rangeId: string | null;
  sizeLabel: string | null; // the chart row used, e.g. "0.10–0.149 ct" or "≤ 10 mm"
  pricedAsShape?: string; // priced on this shape's chart row instead of its own (e.g. round Ruby as OVAL)
  settingType: string | null; // chart setting type code
  settingTypeAssumed: boolean; // the default was used
  settingTypeSource: SettingTypeSource | null;
  chartRate: number | null;
  chartAmount: number | null;
  invoicedOnStone: number; // setting amount on the stone itself
  invoicedLabour: number; // "Setting" labour rows assigned to this lot
  invoiced: number; // both
  issue: StoneIssue | null;
}

export interface SettingComparison {
  invoicedLabour: number; // "Setting" labour rows
  invoicedOnStones: number; // setting amounts on the stones
  invoiced: number;
  chartAmount: number; // sum over stones the chart could price
  stones: StoneComparison[];
  // "Setting" labour rows that could not be tied to one lot, and the chart
  // amount of the stones with no setting invoiced of their own (neither a
  // labour row nor an amount on the stone).
  unallocatedLabour: number;
  unallocatedChart: number;
  unpricedStones: number;
  possibleDoubleCharge: boolean; // labour row equals the stones' own setting total
}

export type LineStatus = 'IN_LINE' | 'OVER' | 'UNDER' | 'NOT_COMPARABLE';

export interface LineComparison {
  invDetId: number;
  metal: MetalComparison;
  setting: SettingComparison;
  combined: CombinedComparison[];
  modelMaking: ModelMakingCheck[];
  notInChart: { process: string; amount: number }[];
  invoicedCompared: number; // labour that has a chart counterpart
  chartTotal: number;
  variance: number; // invoiced − chart
  variancePct: number | null;
  status: LineStatus;
  partial: boolean; // some invoiced labour or stones could not be priced from the chart
}

// ---------- helpers ----------

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function mmDims(mmSize: string | null): number[] {
  if (!mmSize) return [];
  return (mmSize.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
}

// mm-size rows are listed small → large; a round stone (one dimension) uses
// the row's round diameter, other stones (and any stone priced as oval) their
// largest dimension against the oval size.
function findMmRange(ranges: SizeRange[], mmSize: string | null, asOval = false): SizeRange | undefined {
  const dims = mmDims(mmSize);
  if (dims.length === 0) return undefined;
  const round_ = dims.length === 1 && !asOval;
  const size = Math.max(...dims);
  return ranges.find((r) => {
    const bound = round_ ? (r.mmMaxRound ?? r.mmMax) : r.mmMax;
    return bound != null && size <= bound;
  });
}

const fmt = (n: number) => String(round(n, 4));
export function sizeLabel(r: SizeRange): string {
  if (r.wtFrom != null) return r.wtTo == null ? `${fmt(r.wtFrom)} ct and above` : `${fmt(r.wtFrom)}–${fmt(r.wtTo)} ct`;
  return r.sizeMm ?? `≤ ${r.mmMax} mm`;
}

// Shapes priced on another shape's chart row, per chart commodity. The user's
// rule (2026-10-30): Ruby, Sapphire and Fancy Sapphire that is round (RD),
// triangle (TRI) or cushion (CU) is priced as oval — the Oval column of the
// Ruby / Sapphire chart.
// The user's rule (2026-11-13, matching AAA invoices to the Wilson chart):
// faceted colour-stone shapes the chart has no column for are priced as oval
// (largest dimension). Cabochons, MIX, NA and free sizes stay unpriced.
const FACETED_AS_OVAL = Object.fromEntries(
  ['EM CUT', 'SQ EM CUT', 'HEART', 'SQUARE', 'SQUARE CUSHION', 'BAGUETTE', 'BAGGUATE', 'BG', 'MARQUISE', 'OCTOGON', 'TRAPEZOID',
    'ASSCHER', 'PRINCESS', 'PRINCESS CUT', 'RADIANT', 'RECTANGLE', 'TAPER', 'TAPPER'].map((s) => [s, 'OVAL']),
);
const AS_OVAL = { ...FACETED_AS_OVAL, ROUND: 'OVAL', RD: 'OVAL', TRIANGLE: 'OVAL', TRILLION: 'OVAL', TRI: 'OVAL', CUSHION: 'OVAL', CU: 'OVAL' };
const PRICE_AS_SHAPE: Record<string, Record<string, string>> = {
  RUBY: AS_OVAL,
  SAPPHIRE: AS_OVAL,
  FANCY_SAPPHIRE: AS_OVAL,
};
// The user's rule (2026-11-10): every other colour stone (all chart
// commodities but Diamond, whose fancy group prices cushion itself) that is
// cushion (CU) or trillion is priced as oval too. Triangle keeps its own column.
const CU_TRILLION_AS_OVAL = { ...FACETED_AS_OVAL, CUSHION: 'OVAL', CU: 'OVAL', TRILLION: 'OVAL' };
export const pricedAsShape = (chartCommodity: string, shape: string | null) =>
  (shape && (PRICE_AS_SHAPE[chartCommodity] ?? (chartCommodity === 'DIAMOND' ? undefined : CU_TRILLION_AS_OVAL))?.[shape]) || null;

// ---------- setting labour → stone lots ----------

// Chart setting types named in a labour description, e.g. "Micro paveProng
// setting" → MICRO_PAVE + PRONG_PAVE. Longer ERP names are matched first so
// "MICRO PAVE" is not also read as "PAVE".
export function settingTypesIn(description: string | null | undefined, chart: PriceChart): string[] {
  let text = (description ?? '').toUpperCase();
  if (!text.trim()) return [];
  const names = chart.settingChart.settingTypes
    .flatMap((t) => t.erpNames.map((name) => ({ name, code: t.code })))
    .sort((a, b) => b.name.length - a.name.length);
  const found = new Set<string>();
  for (const { name, code } of names) {
    if (text.includes(name)) {
      found.add(code);
      text = text.split(name).join(' ');
    }
  }
  return Array.from(found);
}

export interface SettingAllocation {
  byStone: Map<number, LabourInput[]>; // componentId → labour rows
  unallocated: LabourInput[];
}

// Ties each "Setting" labour row to the stone lot it was charged for:
//   1. the description names the lot code (company 10 writes e.g. "RD11500");
//   2. only one stone lot is left without labour → the remaining rows are its;
//   3. the row's qty equals the pieces of exactly one remaining lot.
// Anything else (one row for a whole line of mixed stones) stays unallocated.
export function allocateSettingLabour(rows: LabourInput[], stones: StoneInput[]): SettingAllocation {
  const byStone = new Map<number, LabourInput[]>();
  const give = (s: StoneInput, r: LabourInput) => byStone.set(s.componentId, [...(byStone.get(s.componentId) ?? []), r]);
  let rest: LabourInput[] = [];

  for (const r of rows) {
    const desc = (r.description ?? '').toUpperCase();
    const named = stones
      .filter((s) => s.lotCode && s.lotCode.length >= 3 && desc.includes(s.lotCode.toUpperCase()))
      .sort((a, b) => b.lotCode!.length - a.lotCode!.length)[0];
    if (named) give(named, r);
    else rest.push(r);
  }

  const open = stones.filter((s) => !byStone.has(s.componentId));
  if (rest.length > 0 && open.length === 1) {
    for (const r of rest) give(open[0], r);
    rest = [];
  } else {
    rest = rest.filter((r) => {
      const qty = r.qty ?? 1;
      const match = qty > 1 ? open.filter((s) => s.pieces === qty) : [];
      if (match.length !== 1) return true;
      give(match[0], r);
      return false;
    });
  }
  return { byStone, unallocated: rest };
}

// ---------- model making (CAD) ----------

// ERP product type → the chart's model-making style: its "by style" row and
// (rings, pendants, earrings) the Chinese word of its "by weight" rows, which
// come in a simple (简单) and a difficult (复杂) version.
const MODEL_STYLES: Record<string, { style: string; zh?: string }> = {
  RING: { style: 'Rings', zh: '戒指' },
  PENDANT: { style: 'Pendant', zh: '吊咀' },
  'PENDANT WITH CHAIN': { style: 'Pendant', zh: '吊咀' },
  EARRINGS: { style: 'Earring', zh: '耳环' },
  STUD: { style: 'Earring', zh: '耳环' },
  BRACELET: { style: 'Bracelet' },
  BANGLE: { style: 'Bangle' },
  NECKLACE: { style: 'Necklace' },
};

// Upper weight of a band as written: "Below 3g" → 3, "3-5g" → 5.
const bandMax = (band: string) => {
  const nums = band.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return nums.length ? nums[nums.length - 1] : null;
};

// The model-making range for a product type and weight per piece: simple –
// difficult design rate of the weight band when the chart has one, else the
// style's min – max. Null when the chart has neither.
export function modelMakingRange(
  chart: PriceChart,
  productType: string | null,
  gramsPerPiece: number | null,
): { basis: string; min: number; max: number } | null {
  const m = productType ? MODEL_STYLES[productType] : undefined;
  if (!m) return null;
  const { byStyle, byWeight } = chart.metalChart.modelMaking;
  if (m.zh && gramsPerPiece != null && gramsPerPiece > 0) {
    const band = byWeight.weightBands.findIndex((b) => {
      const max = bandMax(b);
      return max != null && gramsPerPiece <= max;
    });
    const simple = byWeight.rows.find((r) => r.styleZh?.includes(m.zh!) && r.styleZh.includes('简单'));
    const difficult = byWeight.rows.find((r) => r.styleZh?.includes(m.zh!) && r.styleZh.includes('复杂'));
    const lo = band >= 0 ? simple?.rates[band] : null;
    const hi = band >= 0 ? difficult?.rates[band] : null;
    if (lo != null && hi != null) {
      return { basis: `${m.style}, ${byWeight.weightBands[band]}: simple ${lo} – difficult ${hi}`, min: Math.min(lo, hi), max: Math.max(lo, hi) };
    }
  }
  const row = byStyle.find((r) => r.style === m.style);
  return row ? { basis: `${m.style}: ${row.min} – ${row.max} per style`, min: row.min, max: row.max } : null;
}

// ---------- comparison ----------

export function compareLine(line: LineInput, chart: PriceChart, options: ComparisonOptions): LineComparison {
  const metalRate = metalRateIndex(chart.metalChart);
  const settingRate = settingRateIndex(chart.settingChart);
  const chargeName = (code: string) => chart.metalChart.chargeTypes.find((t) => t.code === code)?.name ?? code;
  const currencyOk = line.currency.toUpperCase() === chart.currency.toUpperCase();

  // Invoiced labour by class.
  const byClass = new Map<LabourClass, number>();
  const rowsOf = new Map<LabourClass, LabourInput[]>();
  const notInChart: { process: string; amount: number }[] = [];
  const settingRows: LabourInput[] = [];
  const combinedRows: { row: LabourInput; classes: LabourClass[] }[] = [];
  const modelMakingRows: LabourInput[] = [];
  for (const l of line.labour) {
    const c = classifyProcess(l.process);
    const parts = c ? null : combinedClasses(l.process);
    if (c) {
      byClass.set(c, (byClass.get(c) ?? 0) + l.amount);
      rowsOf.set(c, [...(rowsOf.get(c) ?? []), l]);
    } else if (l.amount === 0) continue;
    else if (parts) combinedRows.push({ row: l, classes: parts });
    else if (isModelMakingProcess(l.process)) modelMakingRows.push(l);
    else notInChart.push({ process: l.process, amount: l.amount });
    if (c === 'SETTING') settingRows.push(l);
  }
  // A class priced only where charted, with no chart rate: back to "not in chart".
  const uncharted = (c: LabourClass) => {
    for (const l of rowsOf.get(c) ?? []) if (l.amount !== 0) notInChart.push({ process: l.process, amount: l.amount });
  };

  // ---- metal ----
  // Hardware (e.g. AAA bangles' titanium spring wire) is neither priced nor
  // weighed by the chart: it doesn't block the line or count in the weight.
  const counted = line.metal.filter((m) => !isHardwareMetal(m.commodity));
  const grams = sum(counted.map((m) => m.grams));
  const metals = Array.from(new Set(counted.map((m) => m.commodity)));
  const hardware = Array.from(new Set(line.metal.filter((m) => isHardwareMetal(m.commodity)).map((m) => m.commodity)));
  const metal: MetalComparison = {
    issue: null,
    grams: round(grams),
    gramsPerPiece: null,
    metals,
    ...(hardware.length ? { hardwareMetals: hardware } : {}),
    rangeId: null,
    wtFrom: null,
    wtTo: null,
    variant: null,
    charges: [],
  };
  // Prices one labour class on the line's weight range (set once the range is found).
  let priceClass: ((cls: LabourClass, invoiced: number) => ChargeComparison) | null = null;
  const chartMetal = chart.metal.toUpperCase();
  if (!currencyOk) metal.issue = 'CURRENCY';
  else if (line.qty <= 0) metal.issue = 'NO_QTY';
  else if (grams <= 0) metal.issue = 'NO_METAL';
  else if (!metals.every((m) => m.includes(chartMetal))) metal.issue = 'OTHER_METAL';
  else if (!line.productType || !chart.metalChart.productTypes.some((p) => p.code === line.productType)) metal.issue = 'NO_PRODUCT_TYPE';
  else {
    metal.gramsPerPiece = round(grams / line.qty);
    const ranges = chart.metalChart.weightRanges.filter((r) => r.productType === line.productType);
    // STUD has one row per back type; the invoice doesn't say which — use the first.
    const variant = ranges[0]?.variant ?? null;
    const range = findRange(ranges.filter((r) => r.variant === variant), metal.gramsPerPiece);
    if (!range) metal.issue = 'NO_WEIGHT_RANGE';
    else {
      Object.assign(metal, { rangeId: range.id, wtFrom: range.wtFrom, wtTo: range.wtTo, variant });
      const margin = rangeMargin(range);
      const basicCode = line.qty < 5 ? 'BASIC_UNDER_5' : 'BASIC_5_UP';
      const charge = (cls: LabourClass, code: string, invoiced: number): ChargeComparison => {
        const r = metalRate(range.id, code);
        const perPiece = r && r.unit === 'per pc';
        const rate = r ? round(r.rate * margin) : null;
        return {
          code,
          labourClass: cls,
          name: chargeName(code),
          invoiced: round(invoiced),
          ...(r && margin !== 1 ? { baseRate: r.rate, margin } : {}),
          chartRate: rate,
          chartAmount: perPiece ? round(rate! * line.qty) : null,
          note: !r ? 'No chart rate for this weight range' : perPiece ? null : `Chart rate is ${r.unit} — not comparable`,
        };
      };
      metal.charges.push(charge('BASIC', basicCode, byClass.get('BASIC') ?? 0));
      priceClass = (cls, invoiced) => {
        if (cls === 'BASIC') return charge(cls, basicCode, invoiced);
        const codes = chartChargesOf(cls);
        return charge(cls, codes.find((x) => metalRate(range.id, x)) ?? codes[0], invoiced);
      };
      for (const c of ADD_ONS) {
        const invoiced = byClass.get(c) ?? 0;
        if (invoiced === 0) continue;
        const codes = chartChargesOf(c);
        const code = codes.find((x) => metalRate(range.id, x)) ?? codes[0];
        if (ONLY_WHEN_CHARTED.has(c) && !metalRate(range.id, code)) uncharted(c);
        else metal.charges.push(charge(c, code, invoiced));
      }
    }
  }
  if (metal.issue) {
    // Keep invoiced metal labour visible even when the chart can't price it.
    for (const c of ['BASIC' as LabourClass, ...ADD_ONS]) {
      const invoiced = byClass.get(c) ?? 0;
      if (invoiced === 0) continue;
      if (ONLY_WHEN_CHARTED.has(c)) uncharted(c);
      else metal.charges.push({ code: c, labourClass: c, name: c === 'BASIC' ? 'Basic' : chargeName(chartChargesOf(c)[0]), invoiced: round(invoiced), chartRate: null, chartAmount: null, note: null });
    }
  }

  // ---- setting ----
  const allocation = allocateSettingLabour(settingRows, line.stones);
  // A setting type named on the line's unallocated rows applies to its other
  // stones only when those rows name exactly one type.
  const lineTypes = Array.from(new Set(allocation.unallocated.flatMap((r) => settingTypesIn(r.description, chart))));
  const stones: StoneComparison[] = line.stones.map((s) => {
    const own = allocation.byStone.get(s.componentId) ?? [];
    const ownTypes = Array.from(new Set(own.flatMap((r) => settingTypesIn(r.description, chart))));
    const invoiceType = own.length > 0 ? (ownTypes.length === 1 ? ownTypes[0] : null) : lineTypes.length === 1 ? lineTypes[0] : null;
    const invoicedLabour = round(sum(own.map((r) => r.amount)));
    const out: StoneComparison = {
      componentId: s.componentId,
      lotCode: s.lotCode ?? null,
      commodity: s.commodity,
      shape: s.shape,
      pieces: s.pieces,
      carats: s.carats,
      caratsPerStone: s.pieces > 0 && s.carats != null ? round(s.carats / s.pieces) : null,
      mmSize: s.mmSize,
      chartCommodity: null,
      rateGroup: null,
      rangeId: null,
      sizeLabel: null,
      settingType: null,
      settingTypeAssumed: false,
      settingTypeSource: null,
      chartRate: null,
      chartAmount: null,
      invoicedOnStone: round(s.settingAmount),
      invoicedLabour,
      invoiced: round(s.settingAmount + invoicedLabour),
      issue: null,
    };
    const commodity = matchCommodity(chart.settingChart.commodities, s.commodity, s.commodityGroup);
    if (!commodity) return { ...out, issue: 'NO_COMMODITY' };
    out.chartCommodity = commodity.code;
    const groups = commodity.rateGroups.map((code) => chart.settingChart.rateGroups.find((g) => g.code === code)!).filter(Boolean);
    const asShape = pricedAsShape(commodity.code, s.shape);
    if (asShape) out.pricedAsShape = asShape;
    const shape = asShape ?? s.shape;
    const group = groups.find((g) => shape != null && g.shapes.includes(shape));
    if (!group) return { ...out, issue: 'NO_SHAPE' };
    out.rateGroup = group.code;
    if (!currencyOk) return { ...out, issue: 'CURRENCY' };
    if (s.pieces <= 0) return { ...out, issue: 'NO_PIECES' };

    const ranges = chart.settingChart.sizeRanges.filter((r) => r.rateGroup === group.code);
    const range =
      (out.caratsPerStone != null ? findRange(ranges.filter((r) => r.wtFrom != null), out.caratsPerStone) : undefined) ??
      findMmRange(ranges.filter((r) => r.wtFrom == null), s.mmSize, asShape === 'OVAL');
    if (!range) return { ...out, issue: 'NO_SIZE' };
    out.rangeId = range.id;
    out.sizeLabel = sizeLabel(range);

    const types = chart.settingChart.settingTypes.filter((t) => t.sections.includes(group.section));
    const source: SettingTypeSource = s.settingType ? 'ERP' : invoiceType ? 'INVOICE' : 'DEFAULT';
    const type =
      source === 'ERP'
        ? types.find((t) => t.erpNames.includes(s.settingType!))
        : types.find((t) => t.code === (source === 'INVOICE' ? invoiceType : options.defaultSettingType));
    if (!type) return { ...out, settingTypeSource: source, issue: 'NO_SETTING_TYPE' };
    out.settingType = type.code;
    out.settingTypeSource = source;
    out.settingTypeAssumed = source === 'DEFAULT';

    const rate = settingRate(range.id, type.code);
    if (rate == null) return { ...out, issue: 'NO_RATE' };
    return { ...out, chartRate: rate, chartAmount: round(rate * s.pieces) };
  });

  const invoicedLabour = round(byClass.get('SETTING') ?? 0);
  const invoicedOnStones = round(sum(line.stones.map((s) => s.settingAmount)));
  const setting: SettingComparison = {
    invoicedLabour,
    invoicedOnStones,
    invoiced: round(invoicedLabour + invoicedOnStones),
    chartAmount: round(sum(stones.map((s) => s.chartAmount ?? 0))),
    stones,
    unpricedStones: stones.filter((s) => s.issue).length,
    unallocatedLabour: round(sum(allocation.unallocated.map((r) => r.amount))),
    unallocatedChart: round(sum(stones.filter((s) => s.invoiced === 0).map((s) => s.chartAmount ?? 0))),
    possibleDoubleCharge: invoicedLabour > 0 && invoicedOnStones > 0 && Math.abs(invoicedLabour - invoicedOnStones) < 0.01,
  };

  // ---- combined rows ("CPF+ Setting + Rhodium") ----
  // Their setting part takes the setting chart of every stone on the line, so
  // a line that also has its own setting rows can't be split fairly.
  const combined: CombinedComparison[] = combinedRows.map(({ row, classes }) => {
    const out: CombinedComparison = { process: row.process.trim(), classes, invoiced: round(row.amount), charges: [], settingChart: null, chartAmount: null, note: null };
    const metalParts = classes.filter((c) => c !== 'SETTING');
    if (metalParts.length && !priceClass) return { ...out, note: metal.issue ? METAL_ISSUE_TEXT[metal.issue] : 'No metal weight range' };
    out.charges = metalParts.map((c) => priceClass!(c, 0));
    if (classes.includes('SETTING')) {
      if (setting.invoiced > 0) return { ...out, note: 'The line also has setting invoiced on its own — setting part not separable' };
      out.settingChart = setting.chartAmount;
    }
    const missing = out.charges.find((c) => c.chartAmount == null);
    if (missing) return { ...out, note: missing.note ?? `No chart rate for ${missing.name}` };
    if (out.settingChart != null && setting.unpricedStones > 0) out.note = 'Some stones could not be priced — setting part is partial';
    out.chartAmount = round(sum(out.charges.map((c) => c.chartAmount!)) + (out.settingChart ?? 0));
    return out;
  });

  // ---- CAD / model making ----
  const modelMaking: ModelMakingCheck[] = [];
  for (const row of modelMakingRows) {
    const range = modelMakingRange(chart, line.productType, metal.gramsPerPiece ?? (line.qty > 0 && grams > 0 ? grams / line.qty : null));
    if (!range) {
      notInChart.push({ process: row.process, amount: row.amount });
      continue;
    }
    const invoiced = round(row.amount);
    modelMaking.push({ process: row.process.trim(), invoiced, ...range, status: invoiced < range.min ? 'BELOW' : invoiced > range.max ? 'ABOVE' : 'WITHIN' });
  }

  // ---- line totals ----
  // Only labour the factory actually charged is compared: a chart amount with
  // nothing invoiced (e.g. setting billed on another line) is shown, not counted.
  // CAD is checked against a range, so it isn't in the totals.
  const comparableCharges = metal.charges.filter(isComparedCharge);
  const settingComparable = isComparedSetting(setting);
  const comparedCombined = combined.filter((x) => x.chartAmount != null && x.chartAmount > 0);
  const invoicedCompared = round(
    sum(comparableCharges.map((c) => c.invoiced)) + (settingComparable ? setting.invoiced : 0) + sum(comparedCombined.map((x) => x.invoiced)),
  );
  const chartTotal = round(
    sum(comparableCharges.map((c) => c.chartAmount!)) + (settingComparable ? setting.chartAmount : 0) + sum(comparedCombined.map((x) => x.chartAmount!)),
  );
  const variance = round(invoicedCompared - chartTotal, 2);
  const variancePct = chartTotal > 0 ? round((variance / chartTotal) * 100, 1) : null;

  const uncomparedInvoiced =
    metal.charges.some((c) => c.chartAmount == null && c.invoiced !== 0) ||
    (setting.invoiced > 0 && !settingComparable) ||
    combined.some((x) => x.chartAmount == null);
  const partial = uncomparedInvoiced || setting.unpricedStones > 0;
  const status: LineStatus =
    chartTotal <= 0
      ? 'NOT_COMPARABLE'
      : Math.abs(variancePct!) <= options.tolerancePct
        ? 'IN_LINE'
        : variance > 0
          ? 'OVER'
          : 'UNDER';

  return { invDetId: line.invDetId, metal, setting, combined, modelMaking, notInChart, invoicedCompared, chartTotal, variance, variancePct, status, partial };
}

export const METAL_ISSUE_TEXT: Record<MetalIssue, string> = {
  NO_QTY: 'Line has no quantity',
  NO_METAL: 'No metal weight on the line',
  OTHER_METAL: 'Metal is not covered by this chart',
  NO_PRODUCT_TYPE: 'Product type is not in the chart',
  NO_WEIGHT_RANGE: 'Weight per piece is outside the chart’s ranges',
  CURRENCY: 'Invoice currency differs from the chart',
};

export const STONE_ISSUE_TEXT: Record<StoneIssue, string> = {
  NO_COMMODITY: 'Commodity not in the chart',
  NO_SHAPE: 'Shape not priced for this commodity',
  NO_PIECES: 'No piece count',
  NO_SIZE: 'Size outside the chart',
  NO_SETTING_TYPE: 'Setting type not in the chart',
  NO_RATE: 'No chart rate for this setting type and size',
  CURRENCY: 'Invoice currency differs from the chart',
};
