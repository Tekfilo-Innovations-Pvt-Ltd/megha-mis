import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import type { ComparisonOptions } from '@/lib/labourComparison';
import { loadComparisonLines, type LineFilter } from '@/lib/labourComparisonData';
import { buildLabourReport, buildLotReport } from '@/lib/labourReport';
import { jobWorkBlock, stoneSetting } from '@/lib/jobWorkBlocks';
import type { PriceChart } from '@/lib/priceChart';
import { findMissingStones, groupMissingStones } from '@/lib/settingNotInChart';

// Read-only tools "Ask MIS" gives Claude. Every tool is bound to the asker's
// company (from their session, never from the model) and calls the same
// report code as the screens, so answers match what users see. Results are
// compact JSON with row limits so one question can't flood the context.

const MAX_RESULT_CHARS = 60_000;

const filterShape = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Invoice date from, yyyy-mm-dd'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Invoice date to, yyyy-mm-dd'),
  productType: z.string().optional().describe('ERP product type, e.g. RING, PENDANT, BANGLE'),
  jobCategory: z.string().optional().describe('Job category: Normal, Repair or QC Repair. Omit for all.'),
  sku: z.string().optional().describe('Part of a SKU number'),
  invNo: z.string().optional().describe('Part of a factory invoice number as shown, e.g. JW-800409'),
  jewNo: z.string().optional().describe('Part of a jewellery (job) number, e.g. J801958'),
  bagNo: z.string().optional().describe('Part of a manufacturing bag number, e.g. B803443 (only newer lines have one)'),
};
const FilterSchema = z.object(filterShape);
type Filters = z.infer<typeof FilterSchema>;

const json = (value: unknown) => {
  const text = JSON.stringify(value);
  return text.length <= MAX_RESULT_CHARS ? text : `${text.slice(0, MAX_RESULT_CHARS)}… [truncated — narrow the filters or lower the limit]`;
};

const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

export function askMisTools(companyId: number, chart: PriceChart, options: ComparisonOptions) {
  const filter = (f: Filters): LineFilter => ({ companyId, ...f });

  const labourReport = betaZodTool({
    name: 'labour_vs_chart_report',
    description:
      'Labour vs Chart report: factory-invoice labour compared with the factory price chart, for the current company. ' +
      'Returns the summary (lines, invoiced vs chart totals, variance, by product type and factory, not-comparable reasons) ' +
      'and the top invoice lines for the chosen status and sort. Amounts are in the chart currency. ' +
      'Status: IN_LINE within tolerance, OVER/UNDER the chart, NOT_COMPARABLE (chart could not price it), ' +
      'PARTIAL (only part of the line priced), DOUBLE_SETTING (possible double setting charge).',
    inputSchema: z.object({
      ...filterShape,
      status: z.enum(['ALL', 'IN_LINE', 'OVER', 'UNDER', 'NOT_COMPARABLE', 'PARTIAL', 'DOUBLE_SETTING']).optional(),
      sort: z.enum(['variance', 'variancePct', 'date']).optional().describe('variance (largest absolute) is the default'),
      limit: z.number().int().min(0).max(100).optional().describe('Lines to return, default 20'),
    }),
    run: async ({ status, sort, limit, ...f }) => {
      const r = await buildLabourReport(filter(f), chart, options, {
        status: status ?? 'ALL',
        sort: sort ?? 'variance',
        page: 0,
        size: limit ?? 20,
      });
      return json({
        chart: { name: chart.name, currency: chart.currency },
        summary: r.summary,
        matchingLines: r.totalRows,
        lines: r.rows.map((x) => ({
          invoice: x.invNo,
          date: x.invDt,
          factory: x.factoryName,
          jewellery: x.jewNo,
          sku: x.skuNo,
          productType: x.productType,
          qty: x.qty,
          invoicedLabour: x.invoicedLabour,
          invoicedCompared: x.invoicedCompared,
          chart: x.chartTotal,
          variance: x.variance,
          variancePct: x.variancePct,
          status: x.status,
          partial: x.partial || undefined,
          possibleDoubleSetting: x.possibleDoubleSetting || undefined,
          notComparableReason: x.issue ?? undefined,
        })),
      });
    },
  });

  const bySku = betaZodTool({
    name: 'labour_vs_chart_by_sku',
    description: 'The Labour vs Chart report grouped by SKU for the current company: invoiced vs chart labour per SKU, per piece, and line counts by status.',
    inputSchema: z.object({
      ...filterShape,
      status: z.enum(['ALL', 'IN_LINE', 'OVER', 'UNDER', 'NOT_COMPARABLE', 'PARTIAL', 'DOUBLE_SETTING']).optional(),
      sort: z.enum(['variance', 'variancePct', 'date']).optional(),
      limit: z.number().int().min(1).max(100).optional().describe('SKUs to return, default 20'),
    }),
    run: async ({ status, sort, limit, ...f }) => {
      const r = await buildLabourReport(filter(f), chart, options, {
        status: status ?? 'ALL',
        sort: sort ?? 'variance',
        page: 0,
        size: limit ?? 20,
        group: 'sku',
      });
      return json({ chart: { name: chart.name, currency: chart.currency }, matchingSkus: r.totalRows, skus: r.skus });
    },
  });

  const jobWork = betaZodTool({
    name: 'jewellery_job_work_details',
    description:
      'Job Work details of specific jewellery: per jewellery its SO, SKU, size, qty, gross wt, metal lots, colour stone and diamond lots ' +
      '(pcs, wt, invoice vs chart setting rate and amount) and labour rows (invoice vs chart amount), with invoice and chart totals. ' +
      'Give a jewellery number or an invoice number (or both) — this is for looking at a few pieces in detail, not for totals.',
    inputSchema: z.object({
      ...filterShape,
      limit: z.number().int().min(1).max(30).optional().describe('Jewellery lines to return, default 10'),
    }),
    run: async ({ limit, ...f }) => {
      if (!f.jewNo && !f.invNo && !f.sku && !f.bagNo) return 'Give a jewellery number, invoice number, bag number or SKU to look up.';
      const r = await buildLotReport(filter(f), chart, options, { status: 'ALL', sort: 'date', page: 0, size: limit ?? 10 });
      return json({
        matchingLines: r.totalLines,
        jewellery: r.groups.map((g) => {
          const b = jobWorkBlock(g);
          const l = g.line;
          const stone = (s: (typeof b.colour)[number]) => ({
            lot: s.lotCode,
            masterLot: s.masterLotCode,
            commodity: s.commodity,
            shape: s.item,
            mmSize: s.mmSize,
            pcs: s.pcs,
            wt: s.wt,
            // Empty when the setting was invoiced in a labour row — it's in "labour" then.
            setting: stoneSetting(s),
          });
          return {
            invoice: l.invNo,
            date: l.invDt,
            factory: l.factoryName,
            jewellery: l.jewNo,
            bag: l.bagNo,
            so: l.soNo,
            sku: l.skuNo,
            category: l.productType,
            size: l.size,
            qty: l.qty,
            grossWt: l.grossWt,
            metals: l.metals,
            colourStones: b.colour.map(stone),
            diamonds: b.diamonds.map(stone),
            labour: b.labour.map((x) => ({ process: x.process, invoice: x.invoiceAmount, chart: x.chartAmount })),
            totalInvoice: b.invoiceTotal,
            totalChart: b.chartTotal,
            difference: b.difference,
            differencePct: b.differencePct == null ? null : r2(b.differencePct * 100),
            remarks: b.remarks || undefined,
            status: g.status,
          };
        }),
      });
    },
  });

  const settingNotInChart = betaZodTool({
    name: 'setting_not_in_chart',
    description:
      'Stones on the matching invoice lines whose setting labour has no rate in the setting chart, grouped by reason, commodity, ' +
      'shape, setting type and ct-per-stone range — i.e. the rows the setting chart is missing.',
    inputSchema: z.object({
      ...filterShape,
      limit: z.number().int().min(1).max(100).optional().describe('Combinations to return (most pieces first), default 30'),
    }),
    run: async ({ limit, ...f }) => {
      const { info, lines } = await loadComparisonLines(filter(f));
      const { stones, missing } = findMissingStones(info, lines, chart, options);
      const combos = groupMissingStones(missing).sort((a, b) => b.pcs - a.pcs);
      const byReason = new Map<string, { stoneRows: number; pcs: number }>();
      for (const m of missing) {
        const e = byReason.get(m.issue) ?? { stoneRows: 0, pcs: 0 };
        e.stoneRows++;
        e.pcs = r2(e.pcs + m.pcs)!;
        byReason.set(m.issue, e);
      }
      return json({
        stonesChecked: stones,
        stonesWithoutChartValue: missing.length,
        combinations: combos.length,
        byReason: Object.fromEntries(byReason),
        top: combos.slice(0, limit ?? 30).map(({ sampleInvoices, sampleJewellery, ...c }) => ({ ...c, sampleInvoices, sampleJewellery })),
      });
    },
  });

  return [labourReport, bySku, jobWork, settingNotInChart];
}
