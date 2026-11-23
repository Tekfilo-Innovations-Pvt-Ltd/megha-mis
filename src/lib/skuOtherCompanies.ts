import { compareLine, type ComparisonOptions } from '@/lib/labourComparison';
import { loadComparisonLines } from '@/lib/labourComparisonData';
import type { PriceChart } from '@/lib/priceChart';
import type { CompanyOption } from '@/lib/company';
import erp from '@/lib/erp';
import { buildLabourBreakup } from '@/lib/labourLotReport';
import { labourTypeOf } from '@/lib/labourTypes';
import { skuKey, skuVariants } from '@/lib/skuBase';

export { baseSku, skuVariants } from '@/lib/skuBase';

// What other companies' factories invoiced for the same SKU — e.g. an AAA line's
// SKU at RTPHK — per piece, so the chart labour pop-up can set them side by
// side. Only companies the user may open. Labour is the line's whole invoice
// labour (labour rows + setting billed on stones); the setting part is split
// out the same way the report counts it, and the chart labour is from the
// chart the report uses, for a like-for-like check.

export interface SkuLine {
  invId: number;
  invNo: string;
  invDt: string;
  factory: string;
  jewNo: string;
  skuNo: string | null; // the SKU or its -A clone
  jobCategory: string | null;
  currency: string;
  qty: number;
  gramsPerPiece: number | null;
  labourPerPc: number | null;
  settingPerPc: number | null;
  otherPerPc: number | null; // metal labour and the rest
  chartPerPc: number | null; // chart labour of the compared part, per piece
  breakup: SkuBreakupRow[]; // the line's labour breakup, as in Job Work
}

// One row of an invoice line's labour breakup (the factory's labour table, plus
// setting recorded on the stones), with its chart amount.
export interface SkuBreakupRow {
  process: string;
  labourType: string; // to set factories that name processes differently side by side
  qty: number | null;
  rate: number | null;
  amount: number;
  perPc: number | null;
  inputCurrency: string | null;
  inputRate: number | null;
  inputAmount: number | null;
  chartAmount: number | null;
}

export interface SkuCompany {
  companyId: number;
  company: string;
  lines: SkuLine[]; // newest first, at most `limit`
  totalLines: number;
  // Per piece over every line with that SKU (weighted by quantity), per currency.
  averages: { currency: string; qty: number; labourPerPc: number; settingPerPc: number; otherPerPc: number }[];
  // Labour per piece by labour type over every line, in the company's main currency.
  byType: { currency: string; types: { labourType: string; perPc: number }[] } | null;
}


const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function skuInOtherCompanies(
  skuNo: string,
  companies: CompanyOption[],
  chart: PriceChart,
  options: ComparisonOptions,
  limit = 15,
): Promise<SkuCompany[]> {
  const out: SkuCompany[] = [];
  const variants = skuVariants(skuNo);
  for (const co of companies) {
    // The SKU and its "-A" clone, newest first.
    const loads = await Promise.all(variants.map((sku) => loadComparisonLines({ companyId: co.id, sku, skuExact: true })));
    const info = new Map(loads.flatMap((x) => Array.from(x.info)));
    const seen = new Set<number>();
    const lines = loads
      .flatMap((x) => x.lines)
      .filter((l) => !seen.has(l.invDetId) && !!seen.add(l.invDetId))
      .sort((a, b) => info.get(b.invDetId)!.invDt.localeCompare(info.get(a.invDetId)!.invDt) || b.invDetId - a.invDetId);
    if (lines.length === 0) continue;
    const rows = lines.map((l): SkuLine & { labour: number; setting: number } => {
      const i = info.get(l.invDetId)!;
      const c = compareLine(l, chart, options);
      const labour = l.labour.reduce((s, x) => s + x.amount, 0) + l.stones.reduce((s, x) => s + x.settingAmount, 0);
      const setting = c.setting.invoiced;
      const grams = l.metal.reduce((s, m) => s + m.grams, 0);
      const per = (v: number) => (l.qty > 0 ? r2(v / l.qty) : null);
      const breakup = buildLabourBreakup(l, c, chart)
        .filter((x) => (x.invoiceAmount ?? 0) !== 0)
        .map((x): SkuBreakupRow => {
          const src = x.sources ?? [];
          const oneInput = new Set(src.map((s) => s.inputCurrency)).size === 1 ? src[0]?.inputCurrency ?? null : null;
          return {
            process: x.process,
            labourType: labourTypeOf(x.process),
            qty: src.length ? src.reduce((s, y) => s + (y.qty ?? 0), 0) : null,
            rate: x.invoiceRate ?? null,
            amount: r2(x.invoiceAmount ?? 0),
            perPc: per(x.invoiceAmount ?? 0),
            inputCurrency: oneInput,
            inputRate: src.length === 1 ? src[0].inputRate : null,
            inputAmount: oneInput ? r2(src.reduce((s, y) => s + (y.inputAmount ?? 0), 0)) : null,
            chartAmount: x.chartAmount != null ? r2(x.chartAmount) : null,
          };
        });
      return {
        invId: i.invId,
        invNo: i.invNo,
        invDt: i.invDt,
        factory: i.factoryName.trim(),
        jewNo: i.jewNo,
        skuNo: i.skuNo,
        jobCategory: i.jobCategory,
        currency: l.currency,
        qty: l.qty,
        gramsPerPiece: l.qty > 0 && grams > 0 ? r3(grams / l.qty) : null,
        labourPerPc: per(labour),
        settingPerPc: per(setting),
        otherPerPc: per(labour - setting),
        chartPerPc: c.status === 'NOT_COMPARABLE' ? null : per(c.chartTotal),
        breakup,
        labour,
        setting,
      };
    });
    const byCurrency = new Map<string, { qty: number; labour: number; setting: number }>();
    for (const r of rows) {
      const a = byCurrency.get(r.currency) ?? { qty: 0, labour: 0, setting: 0 };
      a.qty += r.qty;
      a.labour += r.labour;
      a.setting += r.setting;
      byCurrency.set(r.currency, a);
    }
    // By labour type, over every line in the currency with the most pieces.
    const main = Array.from(byCurrency).sort((a, b) => b[1].qty - a[1].qty)[0];
    let byType: SkuCompany['byType'] = null;
    if (main && main[1].qty > 0) {
      const types = new Map<string, number>();
      for (const r of rows) if (r.currency === main[0]) for (const x of r.breakup) types.set(x.labourType, (types.get(x.labourType) ?? 0) + x.amount);
      byType = { currency: main[0], types: Array.from(types, ([labourType, amount]) => ({ labourType, perPc: r2(amount / main[1].qty) })).sort((a, b) => b.perPc - a.perPc) };
    }
    out.push({
      companyId: co.id,
      company: co.name,
      lines: rows.slice(0, limit).map(({ labour: _l, setting: _s, ...r }) => r), // already newest first
      totalLines: rows.length,
      byType,
      averages: Array.from(byCurrency, ([currency, a]) => ({
        currency,
        qty: a.qty,
        labourPerPc: a.qty > 0 ? r2(a.labour / a.qty) : 0,
        settingPerPc: a.qty > 0 ? r2(a.setting / a.qty) : 0,
        otherPerPc: a.qty > 0 ? r2((a.labour - a.setting) / a.qty) : 0,
      })),
    });
  }
  return out;
}

// Every SKU (base, "-A" folded in) invoiced in the given companies, with each
// company's line count — what the SKU hint icons in the report look up.
export async function skuIndex(companies: CompanyOption[]): Promise<Record<string, { companyId: number; company: string; lines: number }[]>> {
  if (companies.length === 0) return {};
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const rows = await erp.$queryRaw<{ company_id: number; sku: string; lines: number }[]>`
    SELECT m.company_id, upper(trim(s.sku_no)) AS sku, count(*)::int AS lines
      FROM tbl_factory_invoice_det d
      JOIN tbl_factory_invoice_main m ON m.inv_id = d.inv_id
      JOIN tbl_jewellery j ON j.jew_id = d.jew_id
      JOIN tbl_sku s ON s.sku_id = j.sku_id
     WHERE m.company_id = ANY(${companies.map((c) => c.id)}::int[]) AND m.is_deleted = 0 AND d.is_deleted = 0
       AND trim(coalesce(s.sku_no, '')) <> ''
     GROUP BY 1, 2`;
  const index: Record<string, { companyId: number; company: string; lines: number }[]> = {};
  for (const r of rows) {
    const list = (index[skuKey(r.sku)] ??= []);
    const hit = list.find((x) => x.companyId === r.company_id);
    if (hit) hit.lines += r.lines;
    else list.push({ companyId: r.company_id, company: names.get(r.company_id) ?? `Company ${r.company_id}`, lines: r.lines });
  }
  return index;
}
