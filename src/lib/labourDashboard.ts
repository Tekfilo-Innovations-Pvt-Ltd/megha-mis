import erp from '@/lib/erp';
import {
  compareLine,
  isComparedCharge,
  isComparedSetting,
  type ComparisonOptions,
  type LabourClass,
  type LineComparison,
  type StoneIssue,
} from '@/lib/labourComparison';
import { listInvoiceFactories, listLineJobCategories, listLineProductTypes, loadComparisonLines, type LineFilter } from '@/lib/labourComparisonData';
import type { PriceChart } from '@/lib/priceChart';
import { getStoneCorrections } from '@/lib/stoneCorrectionsStore';

// The Factory Invoice / Labour vs Chart dashboard (BRD "Factory Invoice &
// Labour vs Chart Dashboard", 2026-11-14). Every figure is a total of the same
// line comparisons the Labour vs Chart report shows, for the same filters, so a
// dashboard number always equals the report's.

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (invoiced: number, chart: number) => (chart > 0 ? Math.round(((invoiced - chart) / chart) * 1000) / 10 : null);

interface Pair {
  invoiced: number;
  chart: number;
}
const add = (p: Pair, invoiced: number, chart: number) => {
  p.invoiced += invoiced;
  p.chart += chart;
};
const done = <T extends Pair>(p: T) => ({ ...p, invoiced: r2(p.invoiced), chart: r2(p.chart), difference: r2(p.invoiced - p.chart), differencePct: pct(p.invoiced, p.chart) });

// Dashboard labour types — the chart's charges grouped as people read them.
const LABOUR_TYPE: Record<LabourClass, string> = {
  BASIC: 'Basic / CPF',
  RHODIUM: 'Plating / rhodium',
  PLATING: 'Plating / rhodium',
  LASER_STAMPING: 'Laser stamping',
  COVER_BACK: 'Cover back / J-back',
  J_BACK: 'Cover back / J-back',
  SOLDERING: 'Soldering',
  TWO_TONE: 'Two tone',
  SETTING: 'Stone setting',
};

const STONE_ISSUE_LABEL: Record<StoneIssue, string> = {
  NO_COMMODITY: 'Commodity not in chart',
  NO_SHAPE: 'Shape not in chart',
  NO_PIECES: 'No pieces',
  NO_SIZE: 'Size outside chart / no MM size',
  NO_SETTING_TYPE: 'Setting type not in chart',
  NO_RATE: 'No chart rate',
  CURRENCY: 'Other currency',
};

const METAL_ISSUE_LABEL: Record<string, string> = {
  OTHER_METAL: 'Silver / platinum / other metal',
  NO_PRODUCT_TYPE: 'Product type not in chart',
  NO_METAL: 'No metal weight',
  NO_WEIGHT_RANGE: 'Weight outside chart',
  NO_QTY: 'No quantity',
  CURRENCY: 'Other currency',
};

export async function buildLabourDashboard(filter: LineFilter, chart: PriceChart, options: ComparisonOptions) {
  const [{ info, lines }, factories, productTypes, jobCategories, corrections] = await Promise.all([
    loadComparisonLines(filter),
    listInvoiceFactories(filter.companyId),
    listLineProductTypes(filter.companyId),
    listLineJobCategories(filter.companyId),
    getStoneCorrections(filter.companyId),
  ]);

  const headline = { totalLabour: 0, invoiced: 0, chart: 0 };
  const status = { lines: lines.length, comparable: 0, inLine: 0, over: 0, under: 0, notComparable: 0, partial: 0 };
  const byFactory = new Map<number, Pair & { factoryId: number; name: string; lines: number }>();
  const byProductType = new Map<string, Pair & { productType: string; lines: number }>();
  const byLabourType = new Map<string, Pair & { labourType: string }>();
  const byMonth = new Map<string, Pair & { month: string }>();
  const byInvoice = new Map<number, Pair>();
  const cad = { rows: 0, invoiced: 0, below: 0, within: 0, above: 0 };
  const notInChart = new Map<string, number>();
  const metalNotPriced = new Map<string, { lines: number; invoiced: number }>();
  const stoneIssues = new Map<string, { lots: number; invoiced: number }>();
  const tops: { c: LineComparison; invDetId: number }[] = [];

  for (const l of lines) {
    const i = info.get(l.invDetId)!;
    const c = compareLine(l, chart, options);
    headline.totalLabour += l.labour.reduce((s, x) => s + x.amount, 0) + l.stones.reduce((s, x) => s + x.settingAmount, 0);
    if (c.partial) status.partial++;
    if (c.status === 'NOT_COMPARABLE') status.notComparable++;
    else {
      status.comparable++;
      if (c.status === 'IN_LINE') status.inLine++;
      else if (c.status === 'OVER') status.over++;
      else status.under++;
      headline.invoiced += c.invoicedCompared;
      headline.chart += c.chartTotal;
      const f = byFactory.get(i.factoryId) ?? { factoryId: i.factoryId, name: i.factoryName.trim(), lines: 0, invoiced: 0, chart: 0 };
      f.lines++;
      add(f, c.invoicedCompared, c.chartTotal);
      byFactory.set(i.factoryId, f);
      const pt = l.productType ?? '(none)';
      const p = byProductType.get(pt) ?? { productType: pt, lines: 0, invoiced: 0, chart: 0 };
      p.lines++;
      add(p, c.invoicedCompared, c.chartTotal);
      byProductType.set(pt, p);
      const month = i.invDt.slice(0, 7);
      const m = byMonth.get(month) ?? { month, invoiced: 0, chart: 0 };
      add(m, c.invoicedCompared, c.chartTotal);
      byMonth.set(month, m);
      const inv = byInvoice.get(i.invId) ?? { invoiced: 0, chart: 0 };
      add(inv, c.invoicedCompared, c.chartTotal);
      byInvoice.set(i.invId, inv);
      tops.push({ c, invDetId: l.invDetId });
    }
    // By labour type: exactly what the line totals count.
    const type = (name: string) => byLabourType.get(name) ?? { labourType: name, invoiced: 0, chart: 0 };
    for (const ch of c.metal.charges.filter(isComparedCharge)) {
      const t = type(LABOUR_TYPE[ch.labourClass]);
      add(t, ch.invoiced, ch.chartAmount!);
      byLabourType.set(t.labourType, t);
    }
    if (isComparedSetting(c.setting)) {
      const t = type(LABOUR_TYPE.SETTING);
      add(t, c.setting.invoiced, c.setting.chartAmount);
      byLabourType.set(t.labourType, t);
    }
    for (const x of c.combined) {
      if (x.chartAmount == null || x.chartAmount <= 0) continue;
      const t = type('Combined rows');
      add(t, x.invoiced, x.chartAmount);
      byLabourType.set(t.labourType, t);
    }
    // CAD against the model-making range (not in the totals).
    for (const m of c.modelMaking) {
      cad.rows++;
      cad.invoiced += m.invoiced;
      cad[m.status === 'BELOW' ? 'below' : m.status === 'ABOVE' ? 'above' : 'within']++;
    }
    // Data quality: what isn't compared, and why.
    for (const n of c.notInChart) notInChart.set(n.process.trim(), (notInChart.get(n.process.trim()) ?? 0) + n.amount);
    const unpricedMetal = c.metal.charges.filter((ch) => ch.chartAmount == null && ch.invoiced !== 0).reduce((s, ch) => s + ch.invoiced, 0);
    if (unpricedMetal && c.metal.issue) {
      const k = METAL_ISSUE_LABEL[c.metal.issue] ?? c.metal.issue;
      const x = metalNotPriced.get(k) ?? { lines: 0, invoiced: 0 };
      x.lines++;
      x.invoiced += unpricedMetal;
      metalNotPriced.set(k, x);
    }
    for (const st of c.setting.stones) {
      if (!st.issue) continue;
      const k = STONE_ISSUE_LABEL[st.issue];
      const x = stoneIssues.get(k) ?? { lots: 0, invoiced: 0 };
      x.lots++;
      x.invoiced += st.invoiced;
      stoneIssues.set(k, x);
    }
  }

  // Top over-charged jewellery lines.
  const topLines = tops
    .filter((t) => t.c.variance > 0)
    .sort((a, b) => b.c.variance - a.c.variance)
    .slice(0, 10)
    .map(({ c, invDetId }) => {
      const i = info.get(invDetId)!;
      return {
        invDetId,
        invId: i.invId,
        invNo: i.invNo,
        invDt: i.invDt,
        jewNo: i.jewNo,
        bagNo: i.bagNo,
        skuNo: i.skuNo,
        factory: i.factoryName.trim(),
        invoiced: r2(c.invoicedCompared),
        chart: r2(c.chartTotal),
        difference: r2(c.variance),
        differencePct: c.variancePct,
      };
    });

  // Factory invoices in the period (whole invoices: product type and job
  // category are line filters, so they don't apply here), and the unpaid ones
  // with their chart difference.
  const invWhere: string[] = ['m.company_id = $1', 'm.is_deleted = 0'];
  const params: unknown[] = [filter.companyId];
  if (filter.from) invWhere.push(`m.inv_dt >= $${params.push(filter.from)}::date`);
  if (filter.to) invWhere.push(`m.inv_dt <= $${params.push(filter.to)}::date`);
  if (filter.factoryId) invWhere.push(`m.factory_id = $${params.push(filter.factoryId)}`);
  const invoices = await erp.$queryRawUnsafe<
    { inv_id: number; inv_no: string; inv_dt: Date; factory: string; currency: string; payment_status: string | null; amount: number; paid: number }[]
  >(
    `SELECT m.inv_id, m.inv_type || '-' || m.inv_no AS inv_no, m.inv_dt, trim(f.factory_name) AS factory, m.currency,
            m.payment_status, coalesce(m.total_amount, 0)::float8 AS amount, coalesce(m.total_paid_amount, 0)::float8 AS paid
       FROM tbl_factory_invoice_main m JOIN tbl_factory f ON f.factory_id = m.factory_id
      WHERE ${invWhere.join(' AND ')}`,
    ...params,
  );
  const currencies = Array.from(new Set(invoices.map((x) => x.currency))).sort();
  const perCurrency = (pick: (x: (typeof invoices)[number]) => number, rows = invoices) =>
    currencies.map((currency) => ({ currency, amount: r2(rows.filter((x) => x.currency === currency).reduce((s, x) => s + pick(x), 0)) })).filter((x) => x.amount !== 0);
  const open = invoices.filter((x) => x.payment_status !== 'PAID');
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const outstandingOverChart = open
    .map((x) => {
      const c = byInvoice.get(x.inv_id);
      return {
        invId: x.inv_id,
        invNo: x.inv_no,
        invDt: x.inv_dt.toISOString().slice(0, 10),
        factory: x.factory,
        currency: x.currency,
        paymentStatus: x.payment_status,
        outstanding: r2(x.amount - x.paid),
        comparedInvoiced: c ? r2(c.invoiced) : null,
        chart: c ? r2(c.chart) : null,
        difference: c ? r2(c.invoiced - c.chart) : null,
      };
    })
    .filter((x) => x.difference != null && x.difference > 0)
    .sort((a, b) => b.difference! - a.difference!)
    .slice(0, 10);

  const sortByDiff = <T extends { difference: number }>(xs: T[]) => xs.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  return {
    filterOptions: { factories, productTypes, jobCategories },
    headline: {
      totalLabour: r2(headline.totalLabour),
      invoiced: r2(headline.invoiced),
      chart: r2(headline.chart),
      difference: r2(headline.invoiced - headline.chart),
      differencePct: pct(headline.invoiced, headline.chart),
      coveragePct: headline.totalLabour > 0 ? Math.round((headline.invoiced / headline.totalLabour) * 1000) / 10 : null,
    },
    status,
    factoryInvoices: {
      count: invoices.length,
      thisMonth: invoices.filter((x) => x.inv_dt >= monthStart).length,
      amount: perCurrency((x) => x.amount),
      paid: perCurrency((x) => x.paid),
      outstanding: perCurrency((x) => x.amount - x.paid, open),
      openCount: open.length,
    },
    byFactory: sortByDiff(Array.from(byFactory.values()).map(done)),
    byLabourType: sortByDiff(Array.from(byLabourType.values()).map(done)),
    byProductType: sortByDiff(Array.from(byProductType.values()).map(done)),
    byMonth: Array.from(byMonth.values()).map(done).sort((a, b) => a.month.localeCompare(b.month)),
    topLines,
    outstandingOverChart,
    cad: { ...cad, invoiced: r2(cad.invoiced) },
    dataQuality: {
      uncompared: r2(headline.totalLabour - headline.invoiced),
      notInChart: Array.from(notInChart, ([process, amount]) => ({ process, amount: r2(amount) })).sort((a, b) => b.amount - a.amount).slice(0, 8),
      metalNotPriced: Array.from(metalNotPriced, ([reason, x]) => ({ reason, lines: x.lines, invoiced: r2(x.invoiced) })).sort((a, b) => b.invoiced - a.invoiced),
      stoneIssues: Array.from(stoneIssues, ([reason, x]) => ({ reason, lots: x.lots, invoiced: r2(x.invoiced) })).sort((a, b) => b.lots - a.lots),
      stoneCorrections: corrections ? { fileName: corrections.fileName, uploadedAt: corrections.uploadedAt } : null,
    },
  };
}

export type LabourDashboard = Awaited<ReturnType<typeof buildLabourDashboard>>;
