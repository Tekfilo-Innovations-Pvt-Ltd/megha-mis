import { describe, expect, it } from 'vitest';
import chart from '../../data/price-charts/w8-gold-2018-12-01.json';
import { findRange, matchCommodity, metalRateIndex, settingRateIndex, type PriceChart } from './priceChart';

const c = chart as PriceChart;
const metalRate = metalRateIndex(c.metalChart);
const settingRate = settingRateIndex(c.settingChart);
const ringRanges = c.metalChart.weightRanges.filter((r) => r.productType === 'RING');
const commodities = c.settingChart.commodities;
const matchName = (name: string, group: string) => matchCommodity(commodities, name, group)?.code ?? null;

// Spot checks against cells of the source Excel (Labor sheet).
describe('imported W8 gold labor chart', () => {
  it('keys metal rows on ERP product types with Wt from / to', () => {
    expect(c.metalChart.productTypes.map((p) => p.code)).toEqual(['RING', 'EARRINGS', 'STUD', 'PENDANT', 'PENDANT WITH CHAIN', 'BRACELET']);
    const range = ringRanges.find((r) => r.wtFrom === 3 && r.wtTo === 7)!; // row 9 "3-7g"
    expect(metalRate(range.id, 'BASIC_UNDER_5')?.rate).toBe(4.8405); // C9
    expect(metalRate(range.id, 'BASIC_5_UP')?.rate).toBe(4.61); // D9
    expect(c.metalChart.weightRanges.find((r) => r.productType === 'BRACELET' && r.wtFrom === 15)?.wtTo).toBeNull(); // "15g up"
    expect(c.metalChart.weightRanges.filter((r) => r.productType === 'STUD').map((r) => r.variant)).toEqual(['Butterfly back', 'Lever back']);
  });

  it('keeps per-link units (F29: bracelet J-back "0.35 per link")', () => {
    const range = c.metalChart.weightRanges.find((r) => r.productType === 'BRACELET' && r.wtFrom === 0)!;
    expect(metalRate(range.id, 'J_BACK')).toMatchObject({ rate: 0.35, unit: 'per link' });
  });

  it('turns carat sizes into Wt from / to and keeps mm sizes as sizes', () => {
    const round = c.settingChart.sizeRanges.filter((r) => r.rateGroup === 'DIAMOND_ROUND');
    expect(round[3]).toMatchObject({ wtFrom: 0.1, wtTo: 0.149, sizeMm: '3.01-3.5' }); // B39
    expect(settingRate(round[3].id, 'MICRO_PAVE')).toBe(0.45); // D39
    const semi = c.settingChart.sizeRanges.filter((r) => r.rateGroup === 'SEMI_PRECIOUS');
    expect(semi[0]).toMatchObject({ wtFrom: null, wtTo: null, sizeMm: 'below 4*3mm //3mm' }); // B56
    expect(semi[6]).toMatchObject({ wtFrom: 8, wtTo: 9.9 }); // B62 "8-9.9ct"
    expect(settingRate(semi[5].id, 'CHANNEL')).toBe(2.6); // E61
  });

  it('finds ranges, a boundary weight going to the lower range', () => {
    expect(findRange(ringRanges, 2.5)?.wtTo).toBe(3);
    expect(findRange(ringRanges, 3)?.wtTo).toBe(3);
    expect(findRange(ringRanges, 3.01)?.wtTo).toBe(7);
    expect(findRange(ringRanges, 30)).toBeUndefined();
  });

  it('maps ERP commodities to chart commodities', () => {
    expect(matchName('DIAMOND', 'DIAMOND')).toBe('DIAMOND');
    expect(matchName('AQUAMARINE', 'SEMI PRECIOUS STONE')).toBe('AQUAMARINE');
    expect(matchName('LONDON BLUE TOPAZ', 'SEMI PRECIOUS STONE')).toBe('TOPAZ');
    expect(matchName('GREEN GARNET', 'SEMI PRECIOUS STONE')).toBe('GREEN_GARNET'); // Emerald/Tanzanite rates, per the Chinese text
    expect(matchName('RED GARNET', 'SEMI PRECIOUS STONE')).toBe('GARNET');
    expect(matchName('PERIDOT', 'SEMI PRECIOUS STONE')).toBe('PERIDOT');
    expect(matchName('PINK SAPPHIRE', 'SAPPHIRE')).toBe('FANCY_SAPPHIRE');
    expect(matchName('BLUE SAPPHIRE', 'PRECIOUS STONE')).toBe('SAPPHIRE');
    expect(matchName('TANZANITE CUBIC ZIRCON', 'ZIRCON')).toBeNull();
    expect(matchName('AMETHYST', 'SEMI PRECIOUS STONE')).toBe('OTHER_SEMI_PRECIOUS');
    expect(matchName('GOLD', 'METAL')).toBeNull();
    const peridot = commodities.find((x) => x.code === 'PERIDOT')!;
    expect(peridot.rateGroups).toEqual(['EMERALD_TANZANITE']);
  });
});
