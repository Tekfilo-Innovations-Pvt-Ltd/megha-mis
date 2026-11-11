import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import type { PriceChart } from '@/lib/priceChart';

// Price charts live as JSON files on the server — MIS has no database of its
// own and never writes to the ERP. One file per chart; every replace keeps the
// previous file under backups/ first.
//   PRICE_CHART_DIR (default ./data/price-charts)
//     <code>.json
//     backups/<code>.<yyyymmdd-hhmmss>.json

const CHART_DIR = process.env.PRICE_CHART_DIR || path.join(process.cwd(), 'data', 'price-charts');
const BACKUP_DIR = path.join(CHART_DIR, 'backups');

export const CHART_CODE = /^[a-z0-9][a-z0-9-]{0,60}$/;

// ---------- validation ----------

const nameZh = z.string().nullable();
const section = z.enum(['SIDE', 'CENTER']);
const weight = z.number().nonnegative();

export const priceChartSchema = z
  .object({
    code: z.string().regex(CHART_CODE),
    name: z.string().min(1),
    factoryLabel: z.string(),
    metal: z.string().min(1),
    currency: z.string().min(1),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.object({ file: z.string(), sheet: z.string(), importedAt: z.string() }),
    metalChart: z.object({
      goldLoss: z.array(z.object({ style: z.string().min(1), styleZh: nameZh, karats: z.string(), pct: z.number().nullable() })),
      productTypes: z.array(z.object({ code: z.string().min(1), name: z.string().min(1), nameZh })),
      chargeTypes: z.array(z.object({ code: z.string().min(1), name: z.string().min(1), nameZh, group: z.enum(['Basic charge', 'Add-on']) })),
      weightRanges: z.array(
        z.object({
          id: z.string().min(1),
          productType: z.string().min(1),
          variant: z.string().nullable(),
          wtFrom: weight,
          wtTo: weight.nullable(),
          note: z.string().nullable(),
        }),
      ),
      rates: z.array(z.object({ rangeId: z.string(), chargeType: z.string(), rate: z.number().nonnegative(), unit: z.string().min(1) })),
      alloy: z.array(z.object({ metal: z.string().min(1), pricePerGm: z.number().nonnegative() })),
      stamping: z.array(z.object({ stamp: z.string().min(1), pricePerPc: z.number().nonnegative() })),
      alloyNotes: z.array(z.string()),
      modelMaking: z.object({
        byStyle: z.array(z.object({ style: z.string().min(1), min: z.number(), max: z.number(), remark: z.string().nullable() })),
        byWeight: z.object({
          weightBands: z.array(z.string()),
          rows: z.array(z.object({ style: z.string().min(1), styleZh: nameZh, rates: z.array(z.number().nullable()), remark: z.string().nullable() })),
        }),
      }),
    }),
    settingChart: z.object({
      settingTypes: z.array(
        z.object({ code: z.string().min(1), name: z.string().min(1), nameZh, sections: z.array(section).min(1), erpNames: z.array(z.string()) }),
      ),
      rateGroups: z.array(
        z.object({ code: z.string().min(1), name: z.string().min(1), nameZh, section, shapes: z.array(z.string()), note: z.string().nullable() }),
      ),
      commodities: z.array(
        z.object({
          code: z.string().min(1),
          name: z.string().min(1),
          nameZh,
          rateGroups: z.array(z.string()).min(1),
          match: z.object({
            names: z.array(z.string()).optional(),
            contains: z.array(z.string()).optional(),
            groups: z.array(z.string()).optional(),
            exclude: z.array(z.string()).optional(),
          }),
        }),
      ),
      sizeRanges: z.array(
        z.object({
          id: z.string().min(1),
          rateGroup: z.string().min(1),
          wtFrom: weight.nullable(),
          wtTo: weight.nullable(),
          sizeMm: z.string().nullable(),
          mmMax: z.number().positive().nullable(),
          mmMaxRound: z.number().positive().nullable(),
          note: z.string().nullable(),
        }),
      ),
      rates: z.array(z.object({ rangeId: z.string(), settingType: z.string(), rate: z.number().nonnegative() })),
    }),
  })
  .superRefine((c, ctx) => {
    // Cross-references the schema alone can't check.
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const dupes = (label: string, codes: string[]) => {
      const seen = new Set<string>();
      for (const code of codes) {
        if (seen.has(code)) issue(`${label} "${code}" appears more than once`);
        seen.add(code);
      }
      return seen;
    };
    const m = c.metalChart;
    const s = c.settingChart;
    const productTypes = dupes('Product type', m.productTypes.map((p) => p.code));
    const chargeTypes = dupes('Charge type', m.chargeTypes.map((t) => t.code));
    const weightRanges = dupes('Weight range id', m.weightRanges.map((r) => r.id));
    const settingTypes = dupes('Setting type', s.settingTypes.map((t) => t.code));
    const rateGroups = dupes('Rate group', s.rateGroups.map((g) => g.code));
    dupes('Commodity', s.commodities.map((x) => x.code));
    const sizeRanges = dupes('Size range id', s.sizeRanges.map((r) => r.id));

    for (const r of m.weightRanges) {
      if (!productTypes.has(r.productType)) issue(`Weight range ${r.id}: unknown product type "${r.productType}"`);
      if (r.wtTo != null && r.wtTo <= r.wtFrom) issue(`Weight range ${r.id}: Wt To (${r.wtTo}) must be above Wt From (${r.wtFrom})`);
    }
    for (const r of m.rates) {
      if (!weightRanges.has(r.rangeId)) issue(`Metal rate: unknown weight range "${r.rangeId}"`);
      if (!chargeTypes.has(r.chargeType)) issue(`Metal rate: unknown charge type "${r.chargeType}"`);
    }
    for (const g of s.rateGroups) {
      if (g.shapes.length === 0) issue(`Rate group ${g.code}: list at least one shape`);
    }
    for (const x of s.commodities) {
      for (const g of x.rateGroups) if (!rateGroups.has(g)) issue(`Commodity ${x.code}: unknown rate group "${g}"`);
      const { names, contains, groups } = x.match;
      if (!names?.length && !contains?.length && !groups?.length) issue(`Commodity ${x.code}: give at least one ERP name, word or group to match`);
    }
    for (const r of s.sizeRanges) {
      if (!rateGroups.has(r.rateGroup)) issue(`Size range ${r.id}: unknown rate group "${r.rateGroup}"`);
      if (r.wtFrom == null && !r.sizeMm) issue(`Size range ${r.id}: needs Wt From or a mm size`);
      if (r.wtFrom == null && r.mmMax == null) issue(`Size range ${r.id}: a mm-size row needs Max mm`);
      if (r.wtFrom != null && r.wtTo != null && r.wtTo <= r.wtFrom) issue(`Size range ${r.id}: Wt To (${r.wtTo}) must be above Wt From (${r.wtFrom})`);
    }
    for (const r of s.rates) {
      if (!sizeRanges.has(r.rangeId)) issue(`Setting rate: unknown size range "${r.rangeId}"`);
      if (!settingTypes.has(r.settingType)) issue(`Setting rate: unknown setting type "${r.settingType}"`);
    }
    if (m.rates.length === 0 && s.rates.length === 0) issue('The chart has no rates');
  });

// ---------- files ----------

const chartFile = (code: string) => {
  if (!CHART_CODE.test(code)) throw new Error(`Invalid chart code "${code}"`);
  return path.join(CHART_DIR, `${code}.json`);
};

export interface PriceChartSummary {
  code: string;
  name: string;
  factoryLabel: string;
  effectiveDate: string;
  updatedAt: string;
}

export async function listPriceCharts(): Promise<PriceChartSummary[]> {
  let files: string[];
  try {
    files = (await fs.readdir(CHART_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const charts = await Promise.all(
    files.map(async (f) => {
      const full = path.join(CHART_DIR, f);
      const [chart, stat] = await Promise.all([fs.readFile(full, 'utf8').then((t) => JSON.parse(t) as PriceChart), fs.stat(full)]);
      return { code: chart.code, name: chart.name, factoryLabel: chart.factoryLabel, effectiveDate: chart.effectiveDate, updatedAt: stat.mtime.toISOString() };
    }),
  );
  return charts.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
}

export async function getPriceChart(code: string): Promise<PriceChart | null> {
  try {
    return JSON.parse(await fs.readFile(chartFile(code), 'utf8')) as PriceChart;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

// Deletes the chart's data and replaces it with `chart` (already validated).
// The previous file is copied to backups/ first; the new one is written to a
// temp file and renamed into place so a failed write never leaves half a chart.
export async function replacePriceChart(chart: PriceChart): Promise<{ backup: string | null }> {
  const target = chartFile(chart.code);
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  let backup: string | null = null;
  try {
    await fs.access(target);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    backup = path.join(BACKUP_DIR, `${chart.code}.${stamp}.json`);
    await fs.copyFile(target, backup);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(chart, null, 2) + '\n');
  await fs.rename(tmp, target);
  return { backup: backup ? path.relative(CHART_DIR, backup) : null };
}
