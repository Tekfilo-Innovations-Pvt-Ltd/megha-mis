import { describe, expect, it } from 'vitest';
import seed from '../../data/price-charts/w8-gold-2018-12-01.json';
import { compareLine, type LineInput, type StoneInput } from './labourComparison';
import { buildLabourBreakup } from './labourLotReport';
import type { PriceChart } from './priceChart';
import { lineCalcs } from './chartCalc';

const chart = seed as PriceChart;
const options = { defaultSettingType: 'PRONG_PAVE', tolerancePct: 5 };

const stone = (s: Partial<StoneInput>): StoneInput => ({
  componentId: 1,
  commodity: 'DIAMOND',
  commodityGroup: 'DIAMOND',
  shape: 'ROUND',
  mmSize: null,
  carats: 0.1,
  pieces: 10,
  settingType: null,
  settingAmount: 0,
  ...s,
});

const line: LineInput = {
  invDetId: 1,
  qty: 3,
  productType: 'RING',
  currency: 'USD',
  metal: [{ commodity: 'GOLD', grams: 9.6, lotCode: '14KW' }],
  labour: [
    { process: 'CPF', amount: 22.8 },
    { process: 'rhodium', amount: 6 },
    { process: 'Side Stone Setting', amount: 42.78 },
    { process: 'Center Stone Setting', amount: 14.85 },
  ],
  stones: [
    stone({ componentId: 1, lotCode: 'RD02500', carats: 0.697, pieces: 138 }),
    stone({ componentId: 2, commodity: 'RUBY', commodityGroup: 'RUBY', shape: 'ROUND', mmSize: '6', carats: null, pieces: 33 }),
  ],
};

const c = compareLine(line, chart, options);
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

describe('chart amount working', () => {
  const rows = buildLabourBreakup(line, c, chart);

  it('explains every labour breakup chart amount with parts that add up to it', () => {
    for (const r of rows.filter((x) => x.chartAmount != null)) {
      expect(r.chartCalc?.total).toBe(r.chartAmount);
      expect(sum(r.chartCalc!.parts)).toBeCloseTo(r.chartAmount!, 4);
    }
  });

  it('shows the metal lookup: weight per piece, range, basic charge and rate × qty', () => {
    const cpf = rows.find((r) => r.process === 'CPF')!.chartCalc!;
    const labels = cpf.parts[0].steps.map((s) => s.label);
    expect(labels).toEqual(['Product type', 'Net metal weight', 'Weight per piece', 'Chart weight range', 'Basic charge', 'Chart rate']);
    expect(cpf.parts[0].steps[2].value).toBe('9.600 g ÷ 3 pcs = 3.200 g/pc');
    expect(cpf.parts[0].formula).toMatch(/× 3 pcs$/);
  });

  it('shows the stone lookup: weight per stone, size row, setting type and rate × pieces', () => {
    const side = rows.find((r) => r.process === 'Side Stone Setting')!.chartCalc!;
    const p = side.parts[0];
    expect(p.steps.find((s) => s.label === 'Weight per stone')!.value).toBe('0.697 ct ÷ 138 pcs = 0.0051 ct/stone');
    expect(p.steps.find((s) => s.label === 'Setting type')!.value).toMatch(/default used$/);
    expect(p.formula).toMatch(/× 138 pcs$/);
  });

  it('says when a round Ruby is priced on the oval column, sized by its mm size', () => {
    const center = rows.find((r) => r.process === 'Center Stone Setting')!.chartCalc!;
    expect(center.parts[0].steps.find((s) => s.label === 'Priced as')!.value).toMatch(/^OVAL/);
    expect(center.parts[0].steps.find((s) => s.label === 'MM size')!.value).toBe('6');
  });

  it('builds the line total from the compared metal charges and setting', () => {
    const calcs = lineCalcs(c, line, chart);
    expect(calcs.total!.total).toBe(c.chartTotal);
    expect(sum(calcs.total!.parts)).toBeCloseTo(c.chartTotal, 2);
    expect(Object.keys(calcs.stones)).toHaveLength(2);
  });
});
