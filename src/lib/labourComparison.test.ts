import { describe, expect, it } from 'vitest';
import seed from '../../data/price-charts/w8-gold-2018-12-01.json';
import type { PriceChart } from './priceChart';
import { classifyProcess, compareLine, settingTypesIn, type LineInput, type StoneInput } from './labourComparison';

const chart = seed as PriceChart;
const options = { defaultSettingType: 'PRONG_PAVE', tolerancePct: 5 };

const stone = (s: Partial<StoneInput>): StoneInput => ({
  componentId: 1,
  commodity: 'DIAMOND',
  commodityGroup: 'DIAMOND',
  shape: 'ROUND',
  mmSize: null,
  carats: 1,
  pieces: 1,
  settingType: null,
  settingAmount: 0,
  ...s,
});

// Modelled on RT PRODUCTION line 65320/65327: 5 rings, 12.0836 g gold, labour
// rows Basic 胚底 29.25 / Setting 50.53 / Alloy 3.17, diamonds + amethyst centres.
const ringLine: LineInput = {
  invDetId: 65320,
  qty: 5,
  productType: 'RING',
  currency: 'USD',
  metal: [{ commodity: 'GOLD', grams: 12.0836 }],
  labour: [
    { process: 'Basic 胚底', amount: 29.25 },
    { process: 'Setting', amount: 50.53 },
    { process: 'Alloy', amount: 3.17 },
  ],
  stones: [
    stone({ componentId: 11, carats: 1.056, pieces: 182, mmSize: '1.1' }),
    stone({ componentId: 12, commodity: 'AMETHYST', commodityGroup: 'SEMI PRECIOUS STONE', shape: 'OVAL', carats: 16.24, pieces: 7, mmSize: '10*8' }),
  ],
};

describe('classifyProcess', () => {
  it('maps the ERP process spellings onto chart charges', () => {
    expect(classifyProcess('Basic 胚底')).toBe('BASIC');
    expect(classifyProcess('Basic胚底')).toBe('BASIC');
    expect(classifyProcess('总胚底Total Basic')).toBeNull();
    expect(classifyProcess('Basic +CAD new pic')).toBeNull();
    expect(classifyProcess('Cover Back 网底')).toBe('COVER_BACK');
    expect(classifyProcess('coverback影底')).toBe('COVER_BACK');
    expect(classifyProcess('solder 嵌件')).toBe('SOLDERING');
    expect(classifyProcess('Two-tone 分色')).toBe('TWO_TONE');
    expect(classifyProcess('rhodium black 電黑金')).toBe('RHODIUM');
    expect(classifyProcess('Center Stone Setting')).toBe('SETTING');
    expect(classifyProcess('Plating 电金')).toBe('PLATING');
    expect(classifyProcess('Laser stampping镭射字印')).toBe('LASER_STAMPING');
    expect(classifyProcess('Laser stamping')).toBe('LASER_STAMPING');
    expect(classifyProcess('CPF')).toBe('BASIC');
    expect(classifyProcess('CPF+ Setting + Rhodium ')).toBeNull();
    expect(classifyProcess('Wire & Solder')).toBe('SOLDERING');
  });
});

describe('compareLine', () => {
  it('prices metal labour from product type, weight per piece and quantity', () => {
    const r = compareLine(ringLine, chart, options);
    expect(r.metal.issue).toBeNull();
    expect(r.metal.gramsPerPiece).toBeCloseTo(2.4167, 4);
    expect(r.metal).toMatchObject({ wtFrom: 0, wtTo: 3 });
    expect(r.metal.charges).toEqual([
      { code: 'BASIC_5_UP', labourClass: 'BASIC', name: 'Basic — 5 pcs up per style', invoiced: 29.25, chartRate: 3.71, chartAmount: 18.55, note: null },
    ]);
    expect(r.notInChart).toEqual([{ process: 'Alloy', amount: 3.17 }]);
  });

  it('prices cover back on the J-back column where the range has no Cover back rate', () => {
    const r = compareLine({ ...ringLine, labour: [...ringLine.labour, { process: 'Cover Back 网底', amount: 6 }] }, chart, options);
    expect(r.metal.charges.find((c) => c.labourClass === 'COVER_BACK')).toMatchObject({ code: 'J_BACK', chartRate: 1.13, chartAmount: 5.65 });
  });

  it('leaves plating and laser stamping "not in chart" where the range has no rate for them', () => {
    const labour = [...ringLine.labour, { process: 'Plating 电金', amount: 4 }, { process: 'Laser stampping镭射字印', amount: 2.5 }];
    const r = compareLine({ ...ringLine, labour }, chart, options);
    expect(r.metal.charges.map((c) => c.labourClass)).toEqual(['BASIC']);
    expect(r.notInChart).toEqual([{ process: 'Alloy', amount: 3.17 }, { process: 'Plating 电金', amount: 4 }, { process: 'Laser stampping镭射字印', amount: 2.5 }]);
    expect(r.partial).toBe(false);
  });

  it("applies the weight range's margin to every charge", () => {
    const withMargin: PriceChart = {
      ...chart,
      metalChart: {
        ...chart.metalChart,
        chargeTypes: [...chart.metalChart.chargeTypes, { code: 'PLATING', name: 'Plating', nameZh: null, group: 'Add-on' }],
        weightRanges: [{ id: 'BANGLE-1', productType: 'BANGLE', variant: null, wtFrom: 0, wtTo: 15, margin: 0.95, note: null }],
        productTypes: [{ code: 'BANGLE', name: 'BANGLE', nameZh: null }],
        rates: [
          { rangeId: 'BANGLE-1', chargeType: 'BASIC_5_UP', rate: 14.375, unit: 'per pc' },
          { rangeId: 'BANGLE-1', chargeType: 'PLATING', rate: 3.402, unit: 'per pc' },
        ],
      },
    };
    const bangle: LineInput = {
      ...ringLine,
      qty: 6,
      productType: 'BANGLE',
      metal: [{ commodity: 'GOLD', grams: 53.483 }],
      labour: [{ process: 'Basic 胚底', amount: 81.94 }, { process: 'Plating 电金', amount: 19.39 }],
      stones: [],
    };
    const r = compareLine(bangle, withMargin, options);
    expect(r.metal.charges).toMatchObject([
      { code: 'BASIC_5_UP', baseRate: 14.375, margin: 0.95, chartRate: 13.6563, chartAmount: 81.9378 },
      { code: 'PLATING', labourClass: 'PLATING', baseRate: 3.402, margin: 0.95, chartRate: 3.2319, chartAmount: 19.3914 },
    ]);
  });

  it('prices faceted colour-stone shapes without a chart column as oval, and lab-grown diamond as diamond', () => {
    const line = (st: Partial<StoneInput>) => compareLine({ ...ringLine, labour: [], stones: [stone({ componentId: 1, ...st })] }, chart, options).setting.stones[0];
    expect(line({ commodity: 'TANZANITE', commodityGroup: 'TANZANITE', shape: 'EM CUT', carats: 1, pieces: 1, mmSize: '7*5' })).toMatchObject({ pricedAsShape: 'OVAL', rateGroup: 'EMERALD_TANZANITE', issue: null });
    expect(line({ commodity: 'RUBY', commodityGroup: 'RUBY', shape: 'BAGUETTE', carats: 0.1, pieces: 1, mmSize: '4*2' })).toMatchObject({ pricedAsShape: 'OVAL', issue: null });
    expect(line({ commodity: 'OPAL', commodityGroup: 'OPAL', shape: 'CAB', carats: 1, pieces: 1, mmSize: '7*5' }).issue).toBe('NO_SHAPE');
    expect(line({ commodity: 'LAB GROWN DIAMOND', commodityGroup: 'LAB GROWN', carats: 0.01, pieces: 1 })).toMatchObject({ chartCommodity: 'DIAMOND', rateGroup: 'DIAMOND_ROUND', issue: null });
  });

  it('uses the under-5 price below 5 pieces', () => {
    const r = compareLine({ ...ringLine, qty: 4, metal: [{ commodity: 'GOLD', grams: 9.3386 }] }, chart, options);
    expect(r.metal.charges[0]).toMatchObject({ code: 'BASIC_UNDER_5', chartRate: 3.8955, chartAmount: 15.582 });
  });

  it('prices each stone: carats per stone, else mm size; default setting type when none is recorded', () => {
    const [dia, amethyst] = compareLine(ringLine, chart, options).setting.stones;
    // 1.056 ct / 182 = 0.0058 ct → round diamond "below 0.0155ct", Prong/Pave 0.21
    expect(dia).toMatchObject({ chartCommodity: 'DIAMOND', rateGroup: 'DIAMOND_ROUND', rangeId: 'DIAMOND_ROUND-1', settingType: 'PRONG_PAVE', settingTypeAssumed: true, chartRate: 0.21, chartAmount: 38.22 });
    // 2.32 ct each is below the 8 ct rows → mm size 10*8 → "9*7,10*8mm/10mm", Prong/Pave 1.3
    expect(amethyst).toMatchObject({ chartCommodity: 'OTHER_SEMI_PRECIOUS', rangeId: 'SEMI_PRECIOUS-5', chartRate: 1.3, chartAmount: 9.1, issue: null });
  });

  it('totals the line and flags variance', () => {
    const r = compareLine(ringLine, chart, options);
    expect(r.setting).toMatchObject({ invoicedLabour: 50.53, invoicedOnStones: 0, invoiced: 50.53, chartAmount: 47.32, unpricedStones: 0 });
    expect(r.invoicedCompared).toBe(79.78); // 29.25 + 50.53 (Alloy is not in the chart)
    expect(r.chartTotal).toBe(65.87); // 18.55 + 47.32
    expect(r.variance).toBe(13.91);
    expect(r.variancePct).toBe(21.1);
    expect(r.status).toBe('OVER');
    expect(r.partial).toBe(false);
  });

  it('uses the stone’s own setting type and reports what the chart cannot price', () => {
    const r = compareLine(
      {
        ...ringLine,
        labour: [],
        stones: [
          stone({ componentId: 1, carats: 0.12, pieces: 1, settingType: 'BAZEL', settingAmount: 0.7 }), // Bezel 0.65
          stone({ componentId: 2, carats: 0.5, pieces: 1, settingType: 'CHANNEL' }), // no Channel rate above 0.199 ct
          stone({ componentId: 3, shape: 'PRINCESS' }),
          stone({ componentId: 4, commodity: 'CUBIC ZIRCONIA', commodityGroup: 'ZIRCON' }),
          stone({ componentId: 5, settingType: 'BAR SETTING' }),
        ],
      },
      chart,
      options,
    );
    expect(r.setting.stones.map((s) => s.issue)).toEqual([null, 'NO_RATE', 'NO_SHAPE', 'NO_COMMODITY', 'NO_SETTING_TYPE']);
    expect(r.setting.stones[0]).toMatchObject({ settingType: 'BEZEL', settingTypeAssumed: false, chartAmount: 0.65, invoiced: 0.7 });
    expect(r.setting.unpricedStones).toBe(4);
    expect(r.partial).toBe(true);
  });

  it('only counts labour the factory invoiced', () => {
    const r = compareLine({ ...ringLine, labour: [{ process: 'Basic', amount: 20 }] }, chart, options);
    expect(r.setting.invoiced).toBe(0);
    expect(r.setting.chartAmount).toBe(47.32); // still shown
    expect(r.invoicedCompared).toBe(20);
    expect(r.chartTotal).toBe(18.55); // Basic only — the uncharged setting is left out
    expect(r.status).toBe('OVER');
  });

  it('flags a setting charged both as a labour row and on the stones', () => {
    const r = compareLine({ ...ringLine, labour: [{ process: 'Setting', amount: 2 }], stones: [stone({ settingAmount: 2 })] }, chart, options);
    expect(r.setting.possibleDoubleCharge).toBe(true);
    expect(r.setting.invoiced).toBe(4);
  });

  it('does not price other metals, other currencies or unknown product types', () => {
    expect(compareLine({ ...ringLine, metal: [{ commodity: 'SILVER', grams: 10 }] }, chart, options).metal.issue).toBe('OTHER_METAL');
    expect(compareLine({ ...ringLine, productType: 'NECKLACE' }, chart, options).metal.issue).toBe('NO_PRODUCT_TYPE');
    const rmb = compareLine({ ...ringLine, currency: 'RMB' }, chart, options);
    expect(rmb.metal.issue).toBe('CURRENCY');
    expect(rmb.status).toBe('NOT_COMPARABLE');
  });
});

describe('setting labour per stone lot', () => {
  const dia = stone({ componentId: 11, lotCode: 'RD02500', carats: 1.056, pieces: 182, mmSize: '1.1' });
  const amethyst = stone({ componentId: 12, lotCode: 'O700487', commodity: 'AMETHYST', commodityGroup: 'SEMI PRECIOUS STONE', shape: 'OVAL', carats: 16.24, pieces: 7, mmSize: '10*8' });

  it('ties a labour row to the lot its description names', () => {
    const r = compareLine(
      { ...ringLine, labour: [{ process: 'Setting', amount: 40, description: 'RD02500' }, { process: 'Setting', amount: 10, description: 'O700487' }], stones: [dia, amethyst] },
      chart,
      options,
    );
    expect(r.setting.stones.map((s) => s.invoicedLabour)).toEqual([40, 10]);
    expect(r.setting.unallocatedLabour).toBe(0);
    expect(r.setting.invoiced).toBe(50);
  });

  it('gives the rows to the only stone lot, or to the lot whose pieces equal the row qty', () => {
    const single = compareLine({ ...ringLine, labour: [{ process: 'Setting', amount: 9, description: 'Prong' }], stones: [amethyst] }, chart, options);
    expect(single.setting.stones[0]).toMatchObject({ invoicedLabour: 9, settingType: 'PRONG_PAVE', settingTypeSource: 'INVOICE' });

    const byQty = compareLine({ ...ringLine, labour: [{ process: 'Setting', amount: 30, qty: 182 }], stones: [dia, amethyst] }, chart, options);
    expect(byQty.setting.stones.map((s) => s.invoicedLabour)).toEqual([30, 0]);
  });

  it('keeps one row for a line of mixed stones unallocated, against the chart of those stones', () => {
    const r = compareLine({ ...ringLine, labour: [{ process: 'Setting', amount: 50.53, description: 'Micro pave' }], stones: [dia, amethyst] }, chart, options);
    expect(r.setting.unallocatedLabour).toBe(50.53);
    expect(r.setting.stones.every((s) => s.settingType === 'MICRO_PAVE' && s.settingTypeSource === 'INVOICE')).toBe(true);
    expect(r.setting.unallocatedChart).toBe(r.setting.chartAmount);
  });

  it('reads the chart setting types named in a description', () => {
    expect(settingTypesIn('Micro paveProng setting', chart).sort()).toEqual(['MICRO_PAVE', 'PRONG_PAVE']);
    expect(settingTypesIn('ProngProng', chart)).toEqual(['PRONG_PAVE']);
    expect(settingTypesIn('Micro Pave', chart)).toEqual(['MICRO_PAVE']);
    expect(settingTypesIn('RD11500', chart)).toEqual([]);
  });
});

describe('line-level setting next to setting invoiced on the stones', () => {
  it('compares it with no chart amount — the stones already carry their own', () => {
    const r = compareLine(
      {
        ...ringLine,
        labour: [{ process: 'Center Stone Setting', amount: 900 }],
        stones: [stone({ componentId: 1, lotCode: 'P880474', settingAmount: 900 }), stone({ componentId: 2, lotCode: 'P880475', settingAmount: 800 })],
      },
      chart,
      options,
    );
    expect(r.setting.unallocatedLabour).toBe(900);
    expect(r.setting.unallocatedChart).toBe(0);
  });
});

describe('Ruby and Sapphire priced as oval', () => {
  const line = (s: Partial<StoneInput>): LineInput => ({ ...ringLine, labour: [], stones: [stone({ carats: null, pieces: 1, ...s })] });
  const priced = (s: Partial<StoneInput>) => compareLine(line(s), chart, options).setting.stones[0];

  it('prices round, triangle and cushion Ruby on the Oval column of the Ruby chart', () => {
    // 6 mm: Rd/Tri/Cu column → 6mm row (RUBY_SAPPHIRE-3); Oval column → up to 6.5 (RUBY_SAPPHIRE-2)
    expect(priced({ commodity: 'RUBY', commodityGroup: 'RUBY', shape: 'ROUND', mmSize: '6' })).toMatchObject({ rangeId: 'RUBY_SAPPHIRE-2', pricedAsShape: 'OVAL', issue: null });
    expect(priced({ commodity: 'RUBY', commodityGroup: 'RUBY', shape: 'TRIANGLE', mmSize: '6' })).toMatchObject({ rangeId: 'RUBY_SAPPHIRE-2', pricedAsShape: 'OVAL' });
    // cushion was not priced at all (not a Ruby chart shape); now its largest side 9.23 → the 10*8 oval row
    expect(priced({ commodity: 'RUBY', commodityGroup: 'RUBY', shape: 'CUSHION', mmSize: '9.23*7.84' })).toMatchObject({ rangeId: 'RUBY_SAPPHIRE-5', issue: null });
  });

  it('prices round, triangle and cushion Sapphire and Fancy Sapphire the same way', () => {
    expect(priced({ commodity: 'BLUE SAPPHIRE', commodityGroup: 'PRECIOUS STONE', shape: 'ROUND', mmSize: '6' })).toMatchObject({ rangeId: 'RUBY_SAPPHIRE-2', pricedAsShape: 'OVAL', issue: null });
    expect(priced({ commodity: 'PINK SAPPHIRE', commodityGroup: 'SAPPHIRE', shape: 'ROUND', mmSize: '6' })).toMatchObject({ pricedAsShape: 'OVAL', issue: null });
    expect(priced({ commodity: 'BLUE SAPPHIRE', commodityGroup: 'PRECIOUS STONE', shape: 'CUSHION', mmSize: '9.23*7.84' })).toMatchObject({ rangeId: 'RUBY_SAPPHIRE-5', issue: null });
  });

  it('prices cushion and trillion colour stones as oval, but not diamonds or round colour stones', () => {
    const tz = { commodity: 'TANZANITE', commodityGroup: 'TANZANITE', mmSize: '8x6' };
    const oval = priced({ ...tz, shape: 'OVAL' });
    expect(oval.chartAmount).not.toBeNull();
    expect(priced({ ...tz, shape: 'CUSHION' })).toMatchObject({ rangeId: oval.rangeId, pricedAsShape: 'OVAL', issue: null });
    expect(priced({ ...tz, shape: 'TRILLION' })).toMatchObject({ rangeId: oval.rangeId, pricedAsShape: 'OVAL', issue: null });
    expect(priced({ ...tz, shape: 'ROUND', mmSize: '6' }).pricedAsShape).toBeUndefined();
    expect(priced({ commodity: 'DIAMOND', commodityGroup: 'DIAMOND', shape: 'CUSHION', carats: 0.1 }).pricedAsShape).toBeUndefined();
  });

  it('leaves oval Ruby as it was', () => {
    expect(priced({ commodity: 'RUBY', commodityGroup: 'RUBY', shape: 'OVAL', mmSize: '7x5' })).toMatchObject({ rangeId: 'RUBY_SAPPHIRE-3' });
    expect(priced({ commodity: 'RUBY', commodityGroup: 'RUBY', shape: 'OVAL', mmSize: '7x5' }).pricedAsShape).toBeUndefined();
  });
});
