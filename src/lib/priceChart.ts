// Factory price chart — MIS's own normalised structure, first built from a
// factory's Excel labour chart by scripts/import-labor-chart.mjs, then
// maintained by download/upload of the chart workbook
// (src/lib/priceChartWorkbook.ts). Stored as JSON files on the server
// (src/lib/priceChartStore.ts). Not tied to a company; never written to the ERP.
//
// Rows are keyed on ERP master *names* (product type, commodity, commodity
// group, shape) because those masters are per company in the ERP — the same
// name has a different id in each company. src/lib/priceChartMasters.ts
// resolves the names against the selected company's masters.

export interface Named {
  code: string;
  name: string;
  nameZh: string | null;
}

// ---------- Metal chart ----------

// code = ERP product type name (tbl_product_type.product_type_name), upper case.
export type ProductTypeRef = Named;

export interface WeightRange {
  id: string;
  productType: string; // ProductTypeRef.code
  variant: string | null; // e.g. STUD "Butterfly back" / "Lever back"
  wtFrom: number; // net gold weight in grams
  wtTo: number | null; // null = no upper limit
  note: string | null;
}

export interface ChargeType extends Named {
  group: 'Basic charge' | 'Add-on';
}

export interface MetalRate {
  rangeId: string;
  chargeType: string;
  rate: number;
  unit: string; // "per pc" unless the chart says otherwise (e.g. "per link")
}

export interface GoldLoss {
  style: string;
  styleZh: string | null;
  karats: string;
  pct: number | null; // null = left blank in the chart
}

export interface AlloyRate {
  metal: string;
  pricePerGm: number;
}

export interface StampRate {
  stamp: string;
  pricePerPc: number;
}

export interface ModelMakingByStyle {
  style: string;
  min: number;
  max: number;
  remark: string | null;
}

export interface ModelMakingByWeight {
  style: string;
  styleZh: string | null;
  rates: (number | null)[]; // one per weightBands entry
  remark: string | null;
}

export interface MetalChart {
  goldLoss: GoldLoss[];
  productTypes: ProductTypeRef[];
  chargeTypes: ChargeType[];
  weightRanges: WeightRange[];
  rates: MetalRate[];
  alloy: AlloyRate[];
  stamping: StampRate[];
  alloyNotes: string[];
  modelMaking: {
    byStyle: ModelMakingByStyle[];
    byWeight: { weightBands: string[]; rows: ModelMakingByWeight[] };
  };
}

// ---------- Setting chart ----------

export type StoneSection = 'SIDE' | 'CENTER'; // B) diamond setting / C) center stone setting

// A pricing row block of the Excel (e.g. "Diamond - Round", "Ruby, Sapphire,
// Fancy Sapphire"): its rates apply to the shapes listed.
export interface RateGroup extends Named {
  section: StoneSection;
  shapes: string[]; // ERP shape names (tbl_shape.shape_name), upper case
  note: string | null;
}

// Which ERP commodities a chart commodity covers. A commodity matches an entry
// by exact name, by a word it contains, or (as a fallback) by its commodity group.
export interface CommodityMatch {
  names?: string[];
  contains?: string[];
  groups?: string[];
  exclude?: string[];
}

export interface ChartCommodity extends Named {
  rateGroups: string[]; // RateGroup codes — Diamond has one per shape set
  match: CommodityMatch;
}

export interface SizeRange {
  id: string;
  rateGroup: string;
  wtFrom: number | null; // stone weight in carats; null on mm-size rows
  wtTo: number | null; // null = no upper limit (or mm-size row)
  sizeMm: string | null; // mm size as written, e.g. "1.51-2.6" or "7*5 //6mm(Rd,Tri,Cu)"
  // mm-size rows only: the largest stone dimension the row covers (e.g. 10 for
  // "9*7,10*8mm/10mm"), and the round-stone diameter after "//" (10).
  mmMax: number | null;
  mmMaxRound: number | null;
  note: string | null;
}

export interface SettingRate {
  rangeId: string;
  settingType: string; // SettingType.code
  rate: number;
}

// Prong/Pave, Micro Pave, Channel, Bezel, … are ERP setting types
// (tbl_setting_type). erpNames lists the ERP master names a column covers —
// the ERP spells some differently (e.g. "Bazel", "Micro Pave set").
export interface SettingType extends Named {
  sections: StoneSection[];
  erpNames: string[]; // upper case
}

export interface SettingChart {
  settingTypes: SettingType[];
  rateGroups: RateGroup[];
  commodities: ChartCommodity[];
  sizeRanges: SizeRange[];
  rates: SettingRate[];
}

// ---------- Chart ----------

export interface PriceChart {
  code: string;
  name: string;
  factoryLabel: string; // factory/chart reference as written, e.g. "W8 & W8-1"
  metal: string;
  currency: string;
  effectiveDate: string; // yyyy-mm-dd
  source: { file: string; sheet: string; importedAt: string };
  metalChart: MetalChart;
  settingChart: SettingChart;
}

// ---------- lookup helpers ----------

export function metalRateIndex(chart: MetalChart) {
  const map = new Map<string, MetalRate>();
  for (const r of chart.rates) map.set(`${r.rangeId}|${r.chargeType}`, r);
  return (rangeId: string, chargeType: string) => map.get(`${rangeId}|${chargeType}`);
}

export function settingRateIndex(chart: SettingChart) {
  const map = new Map<string, number>();
  for (const r of chart.rates) map.set(`${r.rangeId}|${r.settingType}`, r.rate);
  return (rangeId: string, settingType: string) => map.get(`${rangeId}|${settingType}`);
}

// Range containing a weight. Ranges are listed low → high; a value exactly on a
// shared boundary (e.g. 3g in 0–3 and 3–7) goes to the lower range.
export function findRange<T extends { wtFrom: number | null; wtTo: number | null }>(ranges: T[], value: number): T | undefined {
  return ranges.find((r) => r.wtFrom != null && value >= r.wtFrom && (r.wtTo == null || value <= r.wtTo));
}

const norm = (s: string) => s.trim().toUpperCase();

// The chart commodity an ERP commodity falls under: an exact name or "contains"
// match wins over a commodity-group fallback; null when nothing matches.
export function matchCommodity(commodities: ChartCommodity[], erpName: string, erpGroup: string): ChartCommodity | null {
  const name = norm(erpName);
  const group = norm(erpGroup);
  const excluded = (c: ChartCommodity) => (c.match.exclude ?? []).some((x) => name === x || name.includes(x));
  const byName = commodities.find(
    (c) => !excluded(c) && ((c.match.names ?? []).includes(name) || (c.match.contains ?? []).some((w) => name.includes(w))),
  );
  if (byName) return byName;
  return commodities.find((c) => !excluded(c) && (c.match.groups ?? []).includes(group)) ?? null;
}
