import { describe, expect, it } from 'vitest';
import seed from '../../data/price-charts/w8-gold-2018-12-01.json';
import type { LineInfo } from './labourComparisonData';
import type { LineInput, StoneInput } from './labourComparison';
import type { PriceChart } from './priceChart';
import { ctRange, findMissingStones, groupMissingStones, NO_CT } from './settingNotInChart';

const chart = seed as PriceChart;
const options = { defaultSettingType: 'PRONG_PAVE', tolerancePct: 5 };

describe('ctRange', () => {
  it('bands ct per stone on the chart diamond rows, extended above 1 ct', () => {
    expect(ctRange(0.01)).toBe('0.000–0.015 ct');
    expect(ctRange(0.0158)).toBe('0.000–0.015 ct');
    expect(ctRange(0.016)).toBe('0.016–0.069 ct');
    expect(ctRange(0.1)).toBe('0.100–0.149 ct');
    expect(ctRange(0.8)).toBe('0.750–0.999 ct');
    expect(ctRange(1)).toBe('1.00–1.99 ct');
    expect(ctRange(3.2)).toBe('2.00–4.99 ct');
    expect(ctRange(12)).toBe('10.00+ ct');
    expect(ctRange(null)).toBe(NO_CT);
  });
});

const stone = (s: Partial<StoneInput>): StoneInput => ({
  componentId: 1,
  commodity: 'DIAMOND',
  commodityGroup: 'DIAMOND',
  shape: 'ROUND',
  mmSize: null,
  carats: 0.1,
  pieces: 1,
  settingType: null,
  settingAmount: 0,
  ...s,
});

const line = (invDetId: number, stones: StoneInput[]): LineInput => ({
  invDetId,
  qty: 1,
  productType: 'RING',
  currency: 'USD',
  metal: [{ commodity: 'GOLD', grams: 3 }],
  labour: [],
  stones,
});

const info = (invDetId: number, invNo: string, invDt: string): [number, LineInfo] => [
  invDetId,
  { invDetId, invId: invDetId, invNo, invDt, factoryId: 1, factoryName: 'F', jewNo: `J${invDetId}`, skuNo: null, soNo: null, bagNo: null, size: null, jobCategory: null, grossWt: null, componentSettingNotCounted: 0 },
];

describe('findMissingStones / groupMissingStones', () => {
  const lines = [
    line(1, [
      stone({ componentId: 1 }), // priced — not listed
      stone({ componentId: 2, commodity: 'UNOBTAINIUM', commodityGroup: 'X', carats: 0.2, pieces: 2 }),
      stone({ componentId: 3, commodity: 'UNOBTAINIUM', commodityGroup: 'X', carats: 0.24, pieces: 2 }),
    ]),
    line(2, [stone({ componentId: 4, commodity: 'UNOBTAINIUM', commodityGroup: 'X', carats: 3, pieces: 1 })]),
  ];
  const infos = new Map([info(1, 'FI-1', '2026-01-05'), info(2, 'FI-2', '2026-02-01')]);

  it('lists only stones without a chart value', () => {
    const { stones, missing } = findMissingStones(infos, lines, chart, options);
    expect(stones).toBe(4);
    expect(missing).toHaveLength(3);
    expect(missing.every((m) => m.issue === 'Commodity not in the chart')).toBe(true);
  });

  it('groups by ct range, smallest range first', () => {
    const { missing } = findMissingStones(infos, lines, chart, options);
    const combos = groupMissingStones(missing);
    expect(combos.map((c) => [c.ctRange, c.stoneRows, c.pcs])).toEqual([
      ['0.100–0.149 ct', 2, 4],
      ['2.00–4.99 ct', 1, 1],
    ]);
    expect(combos[0]).toMatchObject({ minCtPerStone: 0.1, maxCtPerStone: 0.12, invoices: 1, firstDate: '2026-01-05' });
  });
});
