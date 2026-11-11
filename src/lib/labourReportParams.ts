import { NextResponse } from 'next/server';
import { getPriceChart, listPriceCharts } from '@/lib/priceChartStore';
import type { ComparisonOptions } from '@/lib/labourComparison';
import type { PriceChart } from '@/lib/priceChart';

// Shared query parameters of the labour-vs-chart endpoints:
//   chart        price chart code (default: newest chart)
//   settingType  chart setting type used for stones the ERP records none for (default PRONG_PAVE)
//   tolerance    ± % treated as "in line" (default 5)
export async function resolveComparison(params: URLSearchParams): Promise<{ chart: PriceChart; options: ComparisonOptions } | NextResponse> {
  const code = params.get('chart') || (await listPriceCharts())[0]?.code;
  const chart = code ? await getPriceChart(code) : null;
  if (!chart) {
    return NextResponse.json({ message: 'No factory price chart found' }, { status: 404 });
  }

  const settingType = params.get('settingType') || 'PRONG_PAVE';
  if (!chart.settingChart.settingTypes.some((t) => t.code === settingType)) {
    return NextResponse.json({ message: `Unknown setting type "${settingType}"` }, { status: 400 });
  }
  const tolerance = Number(params.get('tolerance') ?? 5);
  return {
    chart,
    options: { defaultSettingType: settingType, tolerancePct: Number.isFinite(tolerance) && tolerance >= 0 ? Math.min(tolerance, 100) : 5 },
  };
}

export const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
