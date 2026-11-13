import {
  compareLine,
  isComparedCharge,
  isComparedSetting,
  type ComparisonOptions,
  type LineComparison,
  type LineInput,
  type LineStatus,
} from '@/lib/labourComparison';
import { listLineJobCategories, listLineProductTypes, loadComparisonLines, type LineFilter, type LineInfo } from '@/lib/labourComparisonData';
import { buildLotGroup } from '@/lib/labourLotReport';
import type { PriceChart } from '@/lib/priceChart';

// "Labour vs Chart" report: every invoice line in the filter compared with the
// price chart, summarised, plus one page of line rows.

export type ReportStatusFilter = LineStatus | 'ALL' | 'PARTIAL' | 'DOUBLE_SETTING';
export type ReportSort = 'variance' | 'variancePct' | 'date';

export interface ReportRow extends LineInfo {
  productType: string | null;
  qty: number;
  gramsPerPiece: number | null;
  metalInvoiced: number;
  metalChart: number;
  settingInvoiced: number;
  settingChart: number;
  combinedInvoiced: number; // combined rows ("CPF+ Setting + Rhodium") the chart could price
  combinedChart: number;
  cad: { rows: number; invoiced: number; below: number; within: number; above: number }; // CAD vs the model-making range
  invoicedLabour: number; // all labour on the line (labour rows + setting on stones), compared or not
  invoicedCompared: number;
  chartTotal: number;
  variance: number;
  variancePct: number | null;
  status: LineStatus;
  partial: boolean;
  possibleDoubleSetting: boolean;
  issue: string | null; // why the metal side could not be priced
  unpricedStones: number;
}

interface Bucket {
  key: string;
  lines: number;
  invoiced: number;
  chart: number;
  variance: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function toRow(info: LineInfo, c: LineComparison, l: LineInput): ReportRow {
  const priced = c.metal.charges.filter(isComparedCharge);
  const settingPriced = isComparedSetting(c.setting);
  return {
    ...info,
    productType: l.productType,
    qty: l.qty,
    gramsPerPiece: c.metal.gramsPerPiece,
    metalInvoiced: r2(priced.reduce((s, x) => s + x.invoiced, 0)),
    metalChart: r2(priced.reduce((s, x) => s + x.chartAmount!, 0)),
    settingInvoiced: settingPriced ? c.setting.invoiced : 0,
    settingChart: settingPriced ? c.setting.chartAmount : 0,
    combinedInvoiced: r2(c.combined.reduce((s, x) => s + (x.chartAmount ? x.invoiced : 0), 0)),
    combinedChart: r2(c.combined.reduce((s, x) => s + (x.chartAmount ?? 0), 0)),
    cad: {
      rows: c.modelMaking.length,
      invoiced: r2(c.modelMaking.reduce((s, x) => s + x.invoiced, 0)),
      below: c.modelMaking.filter((x) => x.status === 'BELOW').length,
      within: c.modelMaking.filter((x) => x.status === 'WITHIN').length,
      above: c.modelMaking.filter((x) => x.status === 'ABOVE').length,
    },
    // Labour rows plus setting billed on the stones themselves — the invoice line's whole labour.
    invoicedLabour: r2(l.labour.reduce((s, x) => s + x.amount, 0) + l.stones.reduce((s, x) => s + x.settingAmount, 0)),
    invoicedCompared: c.invoicedCompared,
    chartTotal: c.chartTotal,
    variance: c.variance,
    variancePct: c.variancePct,
    status: c.status,
    partial: c.partial,
    possibleDoubleSetting: c.setting.possibleDoubleCharge,
    issue: c.metal.issue,
    unpricedStones: c.setting.unpricedStones,
  };
}

function bucket(rows: ReportRow[], key: (r: ReportRow) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    if (r.status === 'NOT_COMPARABLE') continue;
    const k = key(r);
    const b = map.get(k) ?? { key: k, lines: 0, invoiced: 0, chart: 0, variance: 0 };
    b.lines += 1;
    b.invoiced += r.invoicedCompared;
    b.chart += r.chartTotal;
    b.variance += r.variance;
    map.set(k, b);
  }
  return Array.from(map.values())
    .map((b) => ({ ...b, invoiced: r2(b.invoiced), chart: r2(b.chart), variance: r2(b.variance) }))
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

// The lines of one SKU added up. Amounts are over its comparable lines only,
// like the summary; the counts are over every line in the view.
export interface SkuRow {
  skuNo: string | null;
  productTypes: string[];
  jewelleries: number;
  invoices: number;
  lines: number;
  comparableLines: number;
  qty: number; // pieces on the comparable lines
  metalInvoiced: number;
  metalChart: number;
  settingInvoiced: number;
  settingChart: number;
  invoiced: number;
  chart: number;
  variance: number;
  variancePct: number | null;
  invoicedPerPc: number | null;
  chartPerPc: number | null;
  over: number;
  under: number;
  inLine: number;
  notComparable: number;
  lastInvDt: string;
}

export type ReportGroup = 'line' | 'sku';

function groupBySku(rows: ReportRow[], sort: ReportSort): SkuRow[] {
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = r.skuNo ?? '';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const skus = Array.from(groups.values()).map((g): SkuRow => {
    const comparable = g.filter((r) => r.status !== 'NOT_COMPARABLE');
    const sum = (pick: (r: ReportRow) => number) => r2(comparable.reduce((s, r) => s + pick(r), 0));
    const invoiced = sum((r) => r.invoicedCompared);
    const chart = sum((r) => r.chartTotal);
    const qty = comparable.reduce((s, r) => s + r.qty, 0);
    const count = (s: LineStatus) => g.filter((r) => r.status === s).length;
    return {
      skuNo: g[0].skuNo,
      productTypes: Array.from(new Set(g.map((r) => r.productType).filter((p): p is string => !!p))),
      jewelleries: new Set(g.map((r) => r.jewNo)).size,
      invoices: new Set(g.map((r) => r.invId)).size,
      lines: g.length,
      comparableLines: comparable.length,
      qty,
      metalInvoiced: sum((r) => r.metalInvoiced),
      metalChart: sum((r) => r.metalChart),
      settingInvoiced: sum((r) => r.settingInvoiced),
      settingChart: sum((r) => r.settingChart),
      invoiced,
      chart,
      variance: r2(invoiced - chart),
      variancePct: chart > 0 ? Math.round(((invoiced - chart) / chart) * 1000) / 10 : null,
      invoicedPerPc: qty > 0 ? r2(invoiced / qty) : null,
      chartPerPc: qty > 0 ? r2(chart / qty) : null,
      over: count('OVER'),
      under: count('UNDER'),
      inLine: count('IN_LINE'),
      notComparable: count('NOT_COMPARABLE'),
      lastInvDt: g.reduce((d, r) => (r.invDt > d ? r.invDt : d), g[0].invDt),
    };
  });
  return skus.sort((a, b) =>
    sort === 'date'
      ? b.lastInvDt.localeCompare(a.lastInvDt)
      : sort === 'variancePct'
        ? Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0)
        : Math.abs(b.variance) - Math.abs(a.variance),
  );
}

type View = { status: ReportStatusFilter; sort: ReportSort; page: number; size: number; group?: ReportGroup };

function applyView<T extends ReportRow>(rows: T[], view: Omit<View, 'page' | 'size'>): T[] {
  const filtered = rows.filter((r) =>
    view.status === 'ALL'
      ? true
      : view.status === 'PARTIAL'
        ? r.partial
        : view.status === 'DOUBLE_SETTING'
          ? r.possibleDoubleSetting
          : r.status === view.status,
  );
  return view.sort === 'date'
    ? filtered // already newest first
    : [...filtered].sort((a, b) =>
        view.sort === 'variancePct'
          ? Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0)
          : Math.abs(b.variance) - Math.abs(a.variance),
      );
}

// Lot detail of the same lines: every line in the view (one page of lines, or
// all of them when size is null — the Excel download), each with its lot rows.
export async function buildLotReport(
  filter: LineFilter,
  chart: PriceChart,
  options: ComparisonOptions,
  view: Omit<View, 'page' | 'size'> & { page: number; size: number | null },
) {
  const { info, lines } = await loadComparisonLines(filter);
  const compared = lines.map((l) => {
    const c = compareLine(l, chart, options);
    return { row: toRow(info.get(l.invDetId)!, c, l), line: l, c };
  });
  const byId = new Map(compared.map((x) => [x.row.invDetId, x]));
  const sorted = applyView(compared.map((x) => x.row), view);
  const pageRows = view.size == null ? sorted : sorted.slice(view.page * view.size, (view.page + 1) * view.size);
  return {
    groups: pageRows.map((r) => {
      const x = byId.get(r.invDetId)!;
      return { ...buildLotGroup(info.get(r.invDetId)!, x.line, x.c, chart), status: r.status };
    }),
    totalLines: sorted.length,
    page: view.page,
    size: view.size,
  };
}

export type LotReport = Awaited<ReturnType<typeof buildLotReport>>;

export async function buildLabourReport(
  filter: LineFilter,
  chart: PriceChart,
  options: ComparisonOptions,
  view: View,
) {
  const [{ info, lines }, productTypes, jobCategories] = await Promise.all([
    loadComparisonLines(filter),
    listLineProductTypes(filter.companyId),
    listLineJobCategories(filter.companyId),
  ]);
  const rows = lines.map((l) => toRow(info.get(l.invDetId)!, compareLine(l, chart, options), l));

  const comparable = rows.filter((r) => r.status !== 'NOT_COMPARABLE');
  const total = (pick: (r: ReportRow) => number) => r2(comparable.reduce((s, r) => s + pick(r), 0));
  const invoiced = total((r) => r.invoicedCompared);
  const chartTotal = total((r) => r.chartTotal);
  const count = (s: LineStatus) => rows.filter((r) => r.status === s).length;

  const summary = {
    lines: rows.length,
    comparable: comparable.length,
    inLine: count('IN_LINE'),
    over: count('OVER'),
    under: count('UNDER'),
    notComparable: count('NOT_COMPARABLE'),
    partial: rows.filter((r) => r.partial).length,
    possibleDoubleSetting: rows.filter((r) => r.possibleDoubleSetting).length,
    metal: { invoiced: total((r) => r.metalInvoiced), chart: total((r) => r.metalChart) },
    setting: { invoiced: total((r) => r.settingInvoiced), chart: total((r) => r.settingChart) },
    combined: { invoiced: total((r) => r.combinedInvoiced), chart: total((r) => r.combinedChart) },
    // CAD on every line (a range check, so not in the totals above)
    cad: (['rows', 'invoiced', 'below', 'within', 'above'] as const).reduce(
      (acc, k) => ({ ...acc, [k]: r2(rows.reduce((s, r) => s + r.cad[k], 0)) }),
      { rows: 0, invoiced: 0, below: 0, within: 0, above: 0 },
    ),
    invoicedLabour: r2(rows.reduce((s, r) => s + r.invoicedLabour, 0)), // all lines, all labour
    invoiced,
    chart: chartTotal,
    variance: r2(invoiced - chartTotal),
    variancePct: chartTotal > 0 ? Math.round(((invoiced - chartTotal) / chartTotal) * 1000) / 10 : null,
    notComparableReasons: Object.entries(
      rows
        .filter((r) => r.status === 'NOT_COMPARABLE')
        .reduce<Record<string, number>>((acc, r) => {
          const k = r.issue ?? 'NO_CHART_LABOUR';
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
    )
      .map(([reason, lines]) => ({ reason, lines }))
      .sort((a, b) => b.lines - a.lines),
    byProductType: bucket(rows, (r) => r.productType ?? '(none)'),
    byFactory: bucket(rows, (r) => r.factoryName),
  };

  const sorted = applyView(rows, view);
  // Grouped by SKU, a page is a page of SKUs (the status filter still picks the lines).
  const skus = view.group === 'sku' ? groupBySku(sorted, view.sort) : null;
  const page = <T>(list: T[]) => list.slice(view.page * view.size, (view.page + 1) * view.size);

  return {
    summary,
    productTypes,
    jobCategories,
    group: view.group ?? 'line',
    rows: skus ? [] : page(sorted),
    skus: skus ? page(skus) : null,
    totalRows: skus ? skus.length : sorted.length,
    page: view.page,
    size: view.size,
  };
}

export type LabourReport = Awaited<ReturnType<typeof buildLabourReport>>;
