import { describe, expect, it } from 'vitest';
import { defaultChartFor } from './priceChartStore';

// Newest first, as listPriceCharts returns them.
const charts = [
  { code: 'aaa-2026', defaultFor: [10] },
  { code: 'w8-2018', defaultFor: [] },
];

describe('defaultChartFor', () => {
  it("uses the chart that lists the company, else the newest one that lists none", () => {
    expect(defaultChartFor(charts, 10)?.code).toBe('aaa-2026');
    expect(defaultChartFor(charts, 5)?.code).toBe('w8-2018');
    expect(defaultChartFor(charts, null)?.code).toBe('w8-2018');
  });

  it('falls back to the newest chart when every chart is company-specific', () => {
    expect(defaultChartFor([{ code: 'aaa-2026', defaultFor: [10] }], 5)?.code).toBe('aaa-2026');
    expect(defaultChartFor([], 5)).toBeUndefined();
  });
});
