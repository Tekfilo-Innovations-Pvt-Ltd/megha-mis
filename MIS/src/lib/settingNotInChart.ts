import { compareLine, STONE_ISSUE_TEXT, type ComparisonOptions, type LineInput } from '@/lib/labourComparison';
import type { LineInfo } from '@/lib/labourComparisonData';
import type { PriceChart } from '@/lib/priceChart';

// "Setting not in chart": every stone of the invoice lines whose setting labour
// finds no rate in the setting chart (commodity, shape, size, setting type or
// rate missing), and the same stones grouped into combinations by commodity,
// shape, setting type and ct-per-stone range — the list of rows the chart is
// missing. Pure — no database access.

// Ct-per-stone bands: the chart's diamond-round size rows, extended above 1 ct.
// Each band runs from its start up to the next band's start.
const BANDS = [0, 0.016, 0.07, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 2, 5, 10];
export const NO_CT = 'No ct wt';

const fmt = (n: number) => (n >= 1 ? n.toFixed(2) : n.toFixed(3));

function bandIndex(ct: number) {
  let i = BANDS.length - 1;
  while (i > 0 && ct < BANDS[i]) i--;
  return i;
}

export function ctRange(ct: number | null): string {
  if (ct == null) return NO_CT;
  const i = bandIndex(ct);
  const next = BANDS[i + 1];
  return next == null ? `${fmt(BANDS[i])}+ ct` : `${fmt(BANDS[i])}–${fmt(next - (BANDS[i] >= 1 ? 0.01 : 0.001))} ct`;
}

export interface MissingStone {
  issue: string;
  commodity: string; // ERP
  commodityGroup: string; // ERP
  chartCommodity: string | null;
  shape: string | null;
  rateGroup: string | null; // chart rate group name
  erpSettingType: string | null;
  settingTypeSource: string | null;
  chartSettingType: string | null;
  ctRange: string;
  ctPerStone: number | null;
  mmSize: string | null;
  pcs: number;
  carats: number | null;
  invoicedSetting: number;
  invNo: string;
  invDt: string;
  factory: string;
  jewNo: string;
  sku: string | null;
  productType: string | null;
  lotCode: string | null;
  currency: string;
}

export interface MissingCombination {
  issue: string;
  commodity: string;
  commodityGroup: string;
  chartCommodity: string | null;
  shape: string | null;
  rateGroup: string | null;
  erpSettingType: string | null;
  chartSettingType: string | null;
  ctRange: string;
  mmSize: string | null; // only for stones without a ct weight
  minCtPerStone: number | null;
  maxCtPerStone: number | null;
  stoneRows: number;
  invoices: number;
  jewellery: number;
  pcs: number;
  carats: number;
  invoicedSetting: number;
  firstDate: string;
  lastDate: string;
  sampleInvoices: string;
  sampleJewellery: string;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function findMissingStones(
  info: Map<number, LineInfo>,
  lines: LineInput[],
  chart: PriceChart,
  options: ComparisonOptions,
): { stones: number; missing: MissingStone[] } {
  const name = <T extends { code: string; name: string }>(list: T[], code: string | null) =>
    code ? (list.find((x) => x.code === code)?.name ?? code) : null;
  const sc = chart.settingChart;
  let stones = 0;
  const missing: MissingStone[] = [];
  for (const l of lines) {
    const li = info.get(l.invDetId)!;
    const inputs = new Map(l.stones.map((s) => [s.componentId, s]));
    for (const st of compareLine(l, chart, options).setting.stones) {
      stones++;
      if (!st.issue) continue;
      const s = inputs.get(st.componentId)!;
      missing.push({
        issue: STONE_ISSUE_TEXT[st.issue],
        commodity: st.commodity,
        commodityGroup: s.commodityGroup,
        chartCommodity: name(sc.commodities, st.chartCommodity),
        shape: st.shape,
        rateGroup: name(sc.rateGroups, st.rateGroup),
        erpSettingType: s.settingType,
        settingTypeSource: st.settingTypeSource,
        chartSettingType: name(sc.settingTypes, st.settingType),
        ctRange: ctRange(st.caratsPerStone),
        ctPerStone: st.caratsPerStone,
        mmSize: st.mmSize,
        pcs: st.pieces,
        carats: st.carats,
        invoicedSetting: st.invoiced,
        invNo: li.invNo,
        invDt: li.invDt,
        factory: li.factoryName,
        jewNo: li.jewNo,
        sku: li.skuNo,
        productType: l.productType,
        lotCode: st.lotCode,
        currency: l.currency,
      });
    }
  }
  return { stones, missing };
}

const KEY: (keyof MissingStone)[] = [
  'issue', 'commodity', 'commodityGroup', 'chartCommodity', 'shape', 'rateGroup', 'erpSettingType', 'chartSettingType', 'ctRange', 'mmSize',
];

// Groups by ct range; MM size only splits stones that have no ct weight.
// Sorted by reason, commodity, shape, then ct range small to large.
export function groupMissingStones(missing: MissingStone[]): MissingCombination[] {
  const groups = new Map<string, MissingStone[]>();
  for (const m of missing) {
    const g = { ...m, mmSize: m.ctRange === NO_CT ? m.mmSize : null };
    const k = KEY.map((c) => g[c] ?? '').join('|');
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const order = (m: MissingStone) => (m.ctPerStone == null ? BANDS.length : bandIndex(m.ctPerStone));
  return Array.from(groups.values())
    .map((rows) => {
      const first = rows[0];
      const cts = rows.map((r) => r.ctPerStone).filter((x): x is number => x != null);
      const dates = rows.map((r) => r.invDt).sort();
      const distinct = (xs: string[]) => Array.from(new Set(xs));
      return {
        sortKey: order(first),
        issue: first.issue,
        commodity: first.commodity,
        commodityGroup: first.commodityGroup,
        chartCommodity: first.chartCommodity,
        shape: first.shape,
        rateGroup: first.rateGroup,
        erpSettingType: first.erpSettingType,
        chartSettingType: first.chartSettingType,
        ctRange: first.ctRange,
        mmSize: first.mmSize,
        minCtPerStone: cts.length ? Math.min(...cts) : null,
        maxCtPerStone: cts.length ? Math.max(...cts) : null,
        stoneRows: rows.length,
        invoices: distinct(rows.map((r) => r.invNo)).length,
        jewellery: distinct(rows.map((r) => r.jewNo)).length,
        pcs: r4(sum(rows.map((r) => r.pcs))),
        carats: r4(sum(rows.map((r) => r.carats ?? 0))),
        invoicedSetting: r4(sum(rows.map((r) => r.invoicedSetting))),
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        sampleInvoices: distinct(rows.map((r) => r.invNo)).slice(0, 5).join(', '),
        sampleJewellery: distinct(rows.map((r) => r.jewNo)).slice(0, 5).join(', '),
      };
    })
    .sort(
      (a, b) =>
        a.issue.localeCompare(b.issue) ||
        a.commodity.localeCompare(b.commodity) ||
        (a.shape ?? '').localeCompare(b.shape ?? '') ||
        a.sortKey - b.sortKey,
    )
    .map(({ sortKey: _, ...c }) => c);
}
