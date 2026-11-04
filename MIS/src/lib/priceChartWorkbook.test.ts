import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import seed from '../../data/price-charts/w8-gold-2018-12-01.json';
import type { PriceChart } from './priceChart';
import { chartToWorkbook, WorkbookError, workbookToChart } from './priceChartWorkbook';

const chart = seed as PriceChart;
const withoutSource = (c: PriceChart) => ({ ...c, source: null });

async function upload(edit?: (wb: ExcelJS.Workbook) => void, code = chart.code) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await chartToWorkbook(chart)) as unknown as ArrayBuffer); // exceljs's typing predates Node's generic Buffer
  edit?.(wb);
  return workbookToChart(await wb.xlsx.writeBuffer(), code, 'edited.xlsx');
}

async function problemsOf(edit: (wb: ExcelJS.Workbook) => void, code?: string) {
  try {
    await upload(edit, code);
  } catch (e) {
    if (e instanceof WorkbookError) return e.problems;
    throw e;
  }
  throw new Error('expected the upload to be rejected');
}

describe('price chart workbook', () => {
  it('download → upload gives back the same chart', async () => {
    const back = await upload();
    expect(withoutSource(back)).toEqual(withoutSource(chart));
    expect(back.source.file).toBe('edited.xlsx');
  });

  it('takes edited rates, including "<n> per <unit>" cells', async () => {
    const back = await upload((wb) => {
      const ws = wb.getWorksheet('Metal Rates')!;
      ws.getRow(2).getCell(5).value = 9.99; // RING 0–3, first charge type
      ws.getRow(2).getCell(6).value = '1.5 per link';
    });
    const first = back.metalChart.weightRanges[0];
    const rates = back.metalChart.rates.filter((r) => r.rangeId === first.id);
    expect(rates[0]).toMatchObject({ rate: 9.99, unit: 'per pc' });
    expect(rates[1]).toMatchObject({ rate: 1.5, unit: 'per link' });
  });

  it('rejects a workbook for another chart', async () => {
    expect(await problemsOf(() => {}, 'other-chart')).toEqual([expect.stringContaining('this workbook is for chart "w8-gold-2018-12-01"')]);
  });

  it('reports bad cells with sheet and row', async () => {
    const problems = await problemsOf((wb) => {
      wb.getWorksheet('Setting Rates')!.getRow(3).getCell(2).value = 'abc';
      wb.getWorksheet('Metal Rates')!.getRow(4).getCell(1).value = null;
    });
    expect(problems).toContain('Setting Rates row 3: Wt from "abc" is not a number');
    expect(problems).toContain('Metal Rates row 4: Product type is required');
  });

  it('rejects rate columns whose setting type is not defined', async () => {
    const problems = await problemsOf((wb) => {
      wb.getWorksheet('Setting Rates')!.getRow(1).getCell(7).value = 'Prong/Pave [PRONG_X]'; // after Rate group … Max mm (round)
    });
    expect(problems).toContain('Setting Rates: column "Prong/Pave [PRONG_X]" — setting type PRONG_X is not on the Setting Types sheet');
  });

  it('reports a missing sheet', async () => {
    const problems = await problemsOf((wb) => {
      wb.removeWorksheet(wb.getWorksheet('Commodities')!.id);
    });
    expect(problems).toContain('Sheet "Commodities" is missing');
  });
});

describe('price chart store', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mis-charts-'));
    vi.stubEnv('PRICE_CHART_DIR', dir);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('validates the seed chart and backs up the previous chart on replace', async () => {
    vi.resetModules();
    const store = await import('./priceChartStore');
    expect(store.priceChartSchema.safeParse(chart).success).toBe(true);

    expect((await store.replacePriceChart(chart)).backup).toBeNull(); // first write — nothing to back up
    const edited = { ...chart, name: 'Edited chart' };
    const { backup } = await store.replacePriceChart(edited);
    expect(backup).toMatch(/^backups[\\/]w8-gold-2018-12-01\.\d{8}-\d{6}\.json$/);

    expect((await store.getPriceChart(chart.code))?.name).toBe('Edited chart');
    expect(JSON.parse(readFileSync(path.join(dir, backup!), 'utf8')).name).toBe(chart.name);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect((await store.listPriceCharts()).map((c) => c.code)).toEqual([chart.code]);
  });

  it('catches broken cross-references', async () => {
    const store = await import('./priceChartStore');
    const broken = structuredClone(chart);
    broken.settingChart.commodities[0].rateGroups = ['NO_SUCH_GROUP'];
    broken.metalChart.weightRanges[0].wtTo = 0;
    const issues = store.priceChartSchema.safeParse(broken).error?.issues.map((i) => i.message) ?? [];
    expect(issues).toContain('Commodity DIAMOND: unknown rate group "NO_SUCH_GROUP"');
    expect(issues).toContain('Weight range RING-1: Wt To (0) must be above Wt From (0)');
  });
});
