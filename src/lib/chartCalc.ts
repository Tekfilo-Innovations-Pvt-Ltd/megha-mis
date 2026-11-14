import {
  type CombinedComparison,
  isComparedCharge,
  isComparedSetting,
  type ChargeComparison,
  type LineComparison,
  type LineInput,
  type StoneComparison,
} from '@/lib/labourComparison';
import type { PriceChart } from '@/lib/priceChart';

// How a chart amount was worked out, for the pop-up behind every clickable
// chart amount: one part per metal charge or stone lot that makes it up —
// the chart rows looked up (steps) and rate × quantity — and their total.
// Built where the amounts are, from the same comparison, so it always adds up
// to the figure shown.

export interface ChartCalcStep {
  label: string;
  value: string;
}

export interface ChartCalcPart {
  title: string;
  steps: ChartCalcStep[];
  formula: string | null; // "0.21 × 384 pcs"; null for a part that is itself a total
  amount: number;
}

export interface ChartCalc {
  title: string;
  parts: ChartCalcPart[];
  total: number;
  note?: string;
}

// 2–4 decimals: rates like 0.21 or 0.3375 read as written in the chart.
// One formatter per decimals setting: toLocaleString builds a new Intl
// formatter on every call, and this runs for every row of every line — it was
// 22 of the 24 s of building RT's lot detail (9,000 lines).
const formatters = new Map<string, Intl.NumberFormat>();
const n = (v: number | null | undefined, min = 2, max = 4) => {
  if (v == null) return '—';
  const key = `${min}|${max}`;
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: min, maximumFractionDigits: max })));
  return f.format(v);
};
const pcs = (v: number) => `${n(v, 0, 0)} pcs`;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

const SOURCE_TEXT = {
  ERP: 'recorded on the stone in the ERP',
  INVOICE: 'named on the invoice setting labour row',
  DEFAULT: 'not recorded — default used',
} as const;

// A metal labour charge: product type and weight per piece pick the chart's
// weight range, whose per-piece rate × the line quantity is the amount.
export function chargePart(ch: ChargeComparison, c: LineComparison, line: Pick<LineInput, 'qty' | 'productType'>): ChartCalcPart | null {
  if (ch.chartAmount == null || ch.chartRate == null) return null;
  const m = c.metal;
  const steps: ChartCalcStep[] = [
    { label: 'Product type', value: line.productType ?? '—' },
    {
      label: 'Net metal weight',
      value: `${n(m.grams, 3, 3)} g${m.metals.length ? ` (${m.metals.join(', ')})` : ''}${m.hardwareMetals?.length ? ` — ${m.hardwareMetals.join(', ').toLowerCase()} not counted` : ''}`,
    },
    { label: 'Weight per piece', value: `${n(m.grams, 3, 3)} g ÷ ${pcs(line.qty)} = ${n(m.gramsPerPiece, 3, 4)} g/pc` },
    {
      label: 'Chart weight range',
      value: `${n(m.wtFrom)} – ${m.wtTo == null ? 'and above' : n(m.wtTo)} g/pc${m.variant ? ` (${m.variant}, assumed)` : ''}`,
    },
  ];
  if (ch.code.startsWith('BASIC')) {
    steps.push({ label: 'Basic charge', value: `${ch.name} — line qty ${n(line.qty, 0, 0)} is ${line.qty < 5 ? 'under 5' : '5 or more'}` });
  }
  steps.push({
    label: 'Chart rate',
    value: ch.margin != null && ch.baseRate != null
      ? `${n(ch.baseRate)} × margin ${n(ch.margin)} = ${n(ch.chartRate)} per pc`
      : `${n(ch.chartRate)} per pc`,
  });
  return { title: ch.name, steps, formula: `${n(ch.chartRate)} × ${pcs(line.qty)}`, amount: ch.chartAmount };
}

// A stone lot: commodity and shape pick the chart's rate group, the weight per
// stone (else the mm size) its size row, plus the setting type; that rate ×
// the stone pieces is the amount.
export function stonePart(st: StoneComparison, chart: PriceChart): ChartCalcPart | null {
  if (st.chartAmount == null || st.chartRate == null) return null;
  const sc = chart.settingChart;
  const commodity = sc.commodities.find((x) => x.code === st.chartCommodity);
  const group = sc.rateGroups.find((x) => x.code === st.rateGroup);
  const type = sc.settingTypes.find((x) => x.code === st.settingType);
  const byWeight = st.caratsPerStone != null && (st.sizeLabel ?? '').includes('ct');
  const steps: ChartCalcStep[] = [
    { label: 'Stone', value: [st.commodity, st.shape, st.lotCode && `lot ${st.lotCode}`].filter(Boolean).join(' · ') },
    { label: 'Chart commodity', value: [commodity?.name ?? st.chartCommodity, group && `${group.name} (${group.section === 'CENTER' ? 'center stone' : 'side stone'} chart)`].filter(Boolean).join(' — ') },
  ];
  if (st.pricedAsShape) steps.push({ label: 'Priced as', value: `${st.pricedAsShape} — ${st.shape} is priced on the ${st.pricedAsShape} column` });
  steps.push(
    byWeight
      ? { label: 'Weight per stone', value: `${n(st.carats, 3, 3)} ct ÷ ${pcs(st.pieces)} = ${n(st.caratsPerStone, 4, 4)} ct/stone` }
      : { label: 'MM size', value: st.mmSize ?? '—' },
    { label: 'Chart size row', value: st.sizeLabel ?? '—' },
    { label: 'Setting type', value: `${type?.name ?? st.settingType}${st.settingTypeSource ? ` — ${SOURCE_TEXT[st.settingTypeSource]}` : ''}` },
    { label: 'Chart rate', value: `${n(st.chartRate)} per stone` },
  );
  return {
    title: [st.commodity, st.shape, st.lotCode].filter(Boolean).join(' '),
    steps,
    formula: `${n(st.chartRate)} × ${pcs(st.pieces)}`,
    amount: st.chartAmount,
  };
}

// A combined labour row ("CPF+ Setting + Rhodium"): the chart amounts of its
// parts on the line — each metal charge, and every stone's setting.
export function combinedCalc(x: CombinedComparison, c: LineComparison, line: Pick<LineInput, 'qty' | 'productType'>, chart: PriceChart): ChartCalc | null {
  if (x.chartAmount == null) return null;
  const stones = x.settingChart != null ? c.setting.stones.map((st) => stonePart(st, chart)) : [];
  return chartCalc(`Chart amount — ${x.process}`, [...x.charges.map((ch) => chargePart(ch, c, line)), ...stones], x.chartAmount, x.note ?? undefined);
}

// A calc from its parts; null when there is nothing to explain.
export function chartCalc(title: string, parts: (ChartCalcPart | null | undefined)[], total?: number | null, note?: string): ChartCalc | null {
  const kept = parts.filter((p): p is ChartCalcPart => p != null);
  if (kept.length === 0) return null;
  return { title, parts: kept, total: total ?? r4(kept.reduce((s, p) => s + p.amount, 0)), ...(note ? { note } : {}) };
}

// A total of other calcs, each kept as one summary part ("CPF 44.52") or —
// with flatten — as all of its own parts.
export function sumCalcs(title: string, calcs: (ChartCalc | null | undefined)[], total?: number | null, flatten = true): ChartCalc | null {
  const parts = calcs
    .filter((c): c is ChartCalc => c != null)
    .flatMap((c) => (flatten ? c.parts : [{ title: c.title, steps: [], formula: null, amount: c.total }]));
  return chartCalc(title, parts, total);
}

export interface LineCalcs {
  total: ChartCalc | null;
  metal: ChartCalc | null;
  setting: ChartCalc | null;
  charges: Record<string, ChartCalc>; // by charge code
  stones: Record<number, ChartCalc>; // by component id
  combined: Record<string, ChartCalc>; // by process name
}

// Every chart amount of one invoice line (the Lines tab and its drill-down).
// The line totals count only labour that was invoiced and priced, like the comparison.
export function lineCalcs(c: LineComparison, line: Pick<LineInput, 'qty' | 'productType'>, chart: PriceChart): LineCalcs {
  const charges: Record<string, ChartCalc> = {};
  for (const ch of c.metal.charges) {
    const calc = chartCalc(`Chart amount — ${ch.name}`, [chargePart(ch, c, line)], ch.chartAmount);
    if (calc) charges[ch.code] = calc;
  }
  const stones: Record<number, ChartCalc> = {};
  for (const st of c.setting.stones) {
    const calc = chartCalc(`Chart setting amount — ${[st.commodity, st.shape].filter(Boolean).join(' ')}`, [stonePart(st, chart)], st.chartAmount);
    if (calc) stones[st.componentId] = calc;
  }
  const comparedCharges = c.metal.charges.filter(isComparedCharge);
  const metal = sumCalcs('Chart metal labour', comparedCharges.map((ch) => charges[ch.code]));
  const settingCompared = isComparedSetting(c.setting);
  const setting = settingCompared
    ? sumCalcs('Chart setting labour', c.setting.stones.map((s) => stones[s.componentId]), c.setting.chartAmount)
    : null;
  const notCounted = [
    c.metal.charges.some((ch) => ch.chartAmount != null && !isComparedCharge(ch)) ? 'metal charges with nothing invoiced' : null,
    !settingCompared && c.setting.chartAmount > 0 ? `setting ${n(c.setting.chartAmount)} (no setting invoiced, or the chart could not price it)` : null,
  ].filter(Boolean);
  const combined: Record<string, ChartCalc> = {};
  for (const x of c.combined) {
    const calc = combinedCalc(x, c, line, chart);
    if (calc) combined[x.process] = calc;
  }
  const total = sumCalcs(
    'Chart labour of the line',
    [metal, setting, ...c.combined.filter((x) => x.chartAmount != null && x.chartAmount > 0).map((x) => combined[x.process])],
    c.chartTotal,
  );
  if (total && notCounted.length) total.note = `Not counted: ${notCounted.join('; ')} — only labour the factory invoiced is compared.`;
  return { total, metal, setting, charges, stones, combined };
}
