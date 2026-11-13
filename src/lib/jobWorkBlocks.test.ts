import { describe, expect, it } from 'vitest';
import seed from '../../data/price-charts/w8-gold-2018-12-01.json';
import { compareLine, type LineInput, type StoneInput } from './labourComparison';
import { buildLabourBreakup, type LotGroup, type LotRow } from './labourLotReport';
import type { PriceChart } from './priceChart';
import { jobWorkBlock, jobWorkTotals, missingSide, stoneSetting } from './jobWorkBlocks';

const chart = seed as PriceChart;
const options = { defaultSettingType: 'PRONG_PAVE', tolerancePct: 5 };

const row = (r: Partial<LotRow>): LotRow => ({
  kind: 'SETTING',
  lotCode: null,
  masterLotCode: null,
  stone: 'DIAMOND',
  commodity: null,
  item: 'ROUND',
  settingType: null,
  settingTypeSource: null,
  size: null,
  mmSize: null,
  wt: null,
  wtUom: null,
  pcs: null,
  perStoneWt: null,
  settingOnStone: 0,
  components: 1,
  invoiceRate: null,
  invoiceAmount: null,
  chartRate: null,
  chartAmount: null,
  variance: null,
  variancePct: null,
  notes: [],
  ...r,
});

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

// An AAA-style older invoice line: setting is not on the stones but in
// "Side Stone Setting" / "Center Stone Setting" labour rows.
const aaaLine: LineInput = {
  invDetId: 1,
  qty: 3,
  productType: 'RING',
  currency: 'USD',
  metal: [{ commodity: 'GOLD', grams: 9.6, lotCode: '14KW' }],
  labour: [
    { process: 'CPF', amount: 22.8 },
    { process: 'rhodium', amount: 6 },
    { process: 'Side Stone Setting', amount: 30 },
    { process: 'Side Stone Setting', amount: 12.78 }, // a second row of the same process
    { process: 'Center Stone Setting', amount: 14.85 },
    { process: 'Findings', amount: 5 },
    { process: 'ORDER OPENING', amount: 0 },
  ],
  stones: [
    stone({ componentId: 1, carats: 0.697, pieces: 138 }), // diamonds → side
    stone({ componentId: 2, commodity: 'SAPPHIRE', commodityGroup: 'PRECIOUS STONE', shape: 'OVAL', mmSize: '6*4', carats: 1.89, pieces: 33 }), // → center
  ],
};

describe('buildLabourBreakup', () => {
  const c = compareLine(aaaLine, chart, options);
  const rows = buildLabourBreakup(aaaLine, c, chart);
  const chartOf = (componentId: number) => c.setting.stones.find((s) => s.componentId === componentId)!.chartAmount;
  const charge = (prefix: string) => c.metal.charges.find((x) => x.code.startsWith(prefix))!.chartAmount;

  it('lists the invoice labour rows by process name, same process added up, zero rows left out', () => {
    expect(rows.map((r) => [r.process, r.invoiceAmount])).toEqual([
      ['CPF', 22.8],
      ['rhodium', 6],
      ['Side Stone Setting', 42.78],
      ['Center Stone Setting', 14.85],
      ['Findings', 5],
    ]);
  });

  it('puts the side stones’ chart on Side Stone Setting and the center stones’ on Center Stone Setting', () => {
    expect(chartOf(1)).not.toBeNull();
    expect(chartOf(2)).not.toBeNull();
    expect(rows.find((r) => r.process === 'Side Stone Setting')!.chartAmount).toBe(chartOf(1));
    expect(rows.find((r) => r.process === 'Center Stone Setting')!.chartAmount).toBe(chartOf(2));
  });

  it('gives metal processes their chart charge and leaves labour the chart has no rate for empty', () => {
    expect(rows.find((r) => r.process === 'CPF')!.chartAmount).toBe(charge('BASIC'));
    expect(rows.find((r) => r.process === 'rhodium')!.chartAmount).toBe(charge('RHODIUM'));
    expect(rows.find((r) => r.process === 'Findings')!.chartAmount).toBeNull();
  });

  it('leaves setting recorded on the stone itself out of the labour rows', () => {
    const onStone = { ...aaaLine, stones: [stone({ componentId: 1, carats: 0.697, pieces: 138, settingAmount: 42.78 }), aaaLine.stones[1]] };
    const c2 = compareLine(onStone, chart, options);
    const r = buildLabourBreakup(onStone, c2, chart);
    expect(r.find((x) => x.process === 'Side Stone Setting')!.chartAmount).toBeNull(); // the diamonds stay in the stone section
    expect(r.find((x) => x.process === 'Center Stone Setting')!.chartAmount).toBe(chartOf(2));
  });

  it('falls back to a plain Setting row, and shows chart setting with no invoice row on its own row', () => {
    const plain = buildLabourBreakup({ ...aaaLine, labour: [{ process: 'Setting', amount: 50 }] }, c, chart);
    expect(plain.find((r) => r.process === 'Setting')!.chartAmount).toBeCloseTo(chartOf(1)! + chartOf(2)!, 4);
    const none = buildLabourBreakup({ ...aaaLine, labour: [{ process: 'CPF', amount: 22.8 }] }, c, chart);
    expect(none.find((r) => r.process === 'Stone setting')).toMatchObject({ invoiceAmount: null });
    expect(none.find((r) => r.process === 'Stone setting')!.chartAmount).toBeCloseTo(chartOf(1)! + chartOf(2)!, 4);
  });

  it('puts basic, rhodium and setting chart on a combined row only — nothing counted twice', () => {
    const line = { ...aaaLine, labour: [{ process: 'CPF+ Setting + Rhodium ', amount: 90 }, { process: 'cad', amount: 33 }] };
    const cc = compareLine(line, chart, { defaultSettingType: 'PRONG_PAVE', tolerancePct: 5 });
    const rows = buildLabourBreakup(line, cc, chart);
    expect(rows.map((r) => r.process)).toEqual(['CPF+ Setting + Rhodium', 'cad']);
    expect(rows[0].chartAmount).toBe(cc.combined[0].chartAmount);
    expect(rows[0].chartAmount).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ chartAmount: null, chartRange: { status: cc.modelMaking[0].status } });
  });
});

const group = (labour: LotGroup['labour'], rows: LotRow[], stoneSettingInvoiced = 0): LotGroup => ({
  line: {
    invDetId: 1, invId: 1, invNo: 'JW-1', invDt: '2026-01-01', factoryName: 'F', jewNo: 'J800600', skuNo: 'S', soNo: 'SO-1', bagNo: 'B1', componentSettingNotCounted: 0, size: 'US7',
    jobCategory: 'Normal', productType: 'RING', qty: 12, grossWt: 5.594, grossWtCalculated: false, netWt: 3.16, diamondWt: 2.392, colorStoneWt: 9.78,
    metals: [{ commodity: 'GOLD', lotCode: '14KW', grams: 3.16 }],
  },
  rows,
  labour,
  stoneSettingInvoiced,
});

describe('jobWorkBlock', () => {
  const g = group(
    [
      { process: 'CPF', invoiceAmount: 70.8, chartAmount: 44.52 },
      { process: 'rhodium', invoiceAmount: 24, chartAmount: 13.68 },
      { process: 'Side Stone Setting', invoiceAmount: 3692.4, chartAmount: 80.64 },
      { process: 'Findings', invoiceAmount: 5, chartAmount: null },
    ],
    [
      row({ stone: 'COLOR', commodity: 'TANZANITE', item: 'TRILLION', pcs: 12, wt: 9.78 }), // no chart rate
      row({ commodity: 'DIAMOND', pcs: 384, wt: 2.392, chartRate: 0.21, chartAmount: 80.64 }),
    ],
    10,
  );
  const b = jobWorkBlock(g);

  it('splits stones into colour and diamond and sizes the block by its longest section', () => {
    expect(b.colour.map((s) => s.commodity)).toEqual(['TANZANITE']);
    expect(b.diamonds.map((s) => s.commodity)).toEqual(['DIAMOND']);
    expect(b.height).toBe(4);
  });

  it('totals the labour table plus setting on the stones, and the chart once', () => {
    expect(b.invoiceTotal).toBe(3802.2); // 70.8 + 24 + 3692.4 + 5 + 10 on the stones
    expect(b.chartTotal).toBe(138.84); // 44.52 + 13.68 + 80.64
    expect(b.difference).toBe(3663.36);
    expect(b.differencePct).toBeCloseTo(3663.36 / 138.84);
  });

  it('marks what is missing and says so in the remarks', () => {
    expect(b.incomplete).toBe(true);
    expect(b.remarks).toBe('No chart amount: TANZANITE TRILLION, Findings');
  });

  it('says when setting on the stone components was left out', () => {
    const g2 = group([{ process: 'CPF', invoiceAmount: 70.8, chartAmount: 44.52 }], []);
    g2.line = { ...g2.line, componentSettingNotCounted: 46.4 };
    expect(jobWorkBlock(g2).remarks).toBe('Component setting 46.40 not counted — setting taken from the labour rows');
  });

  it('leaves remarks empty when every row has both sides', () => {
    const ok = jobWorkBlock(group([{ process: 'CPF', invoiceAmount: 70.8, chartAmount: 44.52 }], []));
    expect(ok.incomplete).toBe(false);
    expect(ok.remarks).toBe('');
  });

  it('adds blocks up for the total row', () => {
    expect(jobWorkTotals([b, b])).toMatchObject({ qty: 24, colourPcs: 24, diamondPcs: 768, invoiceTotal: 7604.4, chartTotal: 277.68 });
  });
});

describe('missingSide', () => {
  it('flags only a missing chart amount on a stone, either side on a labour row', () => {
    expect(missingSide(row({ chartAmount: 1.44 }))).toBeNull(); // setting invoiced in a labour row is fine
    expect(missingSide(row({}))).toBe('chart');
    expect(missingSide({ process: 'Findings', invoiceAmount: 200, chartAmount: null })).toBe('chart');
    expect(missingSide({ process: 'Basic — under 5 pcs per style', invoiceAmount: null, chartAmount: 4.6 })).toBe('invoice');
    expect(missingSide({ process: 'CPF', invoiceAmount: 10, chartAmount: 8 })).toBeNull();
  });
});

describe('stone section amounts', () => {
  const inLabourRow = row({ commodity: 'DIAMOND', pcs: 384, chartRate: 0.21, chartAmount: 80.64 });
  const onStone = row({ commodity: 'DIAMOND', pcs: 10, settingOnStone: 5, chartRate: 0.4, chartAmount: 4 });

  it('shows nothing for a stone set in a labour row, its own amounts when set on the stone', () => {
    expect(stoneSetting(inLabourRow)).toEqual({ invoiceRate: null, invoiceAmount: null, chartRate: null, chartAmount: null });
    expect(stoneSetting(onStone)).toEqual({ invoiceRate: 0.5, invoiceAmount: 5, chartRate: 0.4, chartAmount: 4 });
  });

  it('counts a stone set on the stone in the totals once, from the stone section', () => {
    const b = jobWorkBlock(group([{ process: 'CPF', invoiceAmount: 70.8, chartAmount: 44.52 }], [onStone], 5));
    expect(b.invoiceTotal).toBe(75.8);
    expect(b.chartTotal).toBe(48.52);
    expect(missingSide(row({ settingOnStone: 0, chartAmount: null }))).toBe('chart');
    expect(missingSide(row({ settingOnStone: 5, chartAmount: null }))).toBe('chart');
    expect(missingSide(row({ settingOnStone: 0, chartAmount: 3 }))).toBeNull();
  });
});
