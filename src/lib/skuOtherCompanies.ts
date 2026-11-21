import { compareLine, type ComparisonOptions } from '@/lib/labourComparison';
import { loadComparisonLines } from '@/lib/labourComparisonData';
import type { PriceChart } from '@/lib/priceChart';
import type { CompanyOption } from '@/lib/company';

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
}

export interface SkuCompany {
  companyId: number;
  company: string;
  lines: SkuLine[]; // newest first, at most `limit`
  totalLines: number;
  // Per piece over every line with that SKU (weighted by quantity), per currency.
  averages: { currency: string; qty: number; labourPerPc: number; settingPerPc: number; otherPerPc: number }[];
}

// AAA clones some RTPHK SKUs with "-A" added (NR132911RP75 → NR132911RP75-A);
// both count as the same SKU.
export const baseSku = (sku: string) => sku.trim().replace(/-A$/i, '');
export const skuVariants = (sku: string) => [baseSku(sku), `${baseSku(sku)}-A`];

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
    out.push({
      companyId: co.id,
      company: co.name,
      lines: rows.slice(0, limit).map(({ labour: _l, setting: _s, ...r }) => r), // already newest first
      totalLines: rows.length,
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
