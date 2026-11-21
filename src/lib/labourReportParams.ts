import { NextResponse } from 'next/server';
import { getSessionCompanyId } from '@/lib/company';
import { defaultChartFor, getPriceChart, listPriceCharts } from '@/lib/priceChartStore';
import type { ComparisonOptions } from '@/lib/labourComparison';
import type { PriceChart } from '@/lib/priceChart';
import { FALLBACK_SETTING_TYPE } from '@/lib/settingChoices';
import { getSettingChoices } from '@/lib/settingChoicesStore';

// Shared query parameters of the labour-vs-chart endpoints:
//   chart        price chart code (default: the session company's default chart — see defaultChartFor)
//   settingType  chart setting type used for stones the ERP records none for (default: the
//                company's chosen default for this chart under Setting types, else PRONG_PAVE)
//   tolerance    ± % treated as "in line" (default 5)
// The company's setting type choices per stone (src/lib/settingChoices.ts) always apply.
export async function resolveComparison(params: URLSearchParams): Promise<{ chart: PriceChart; options: ComparisonOptions } | NextResponse> {
  const companyId = await getSessionCompanyId();
  const code = params.get('chart') || defaultChartFor(await listPriceCharts(), companyId)?.code;
  const chart = code ? await getPriceChart(code) : null;
  if (!chart) {
    return NextResponse.json({ message: 'No factory price chart found' }, { status: 404 });
  }

  const saved = companyId != null ? await getSettingChoices(companyId, chart.code) : null;
  const known = (t: string | null | undefined): t is string => !!t && chart.settingChart.settingTypes.some((x) => x.code === t);
  const requested = params.get('settingType');
  if (requested && !known(requested)) {
    return NextResponse.json({ message: `Unknown setting type "${requested}"` }, { status: 400 });
  }
  const settingType = requested || (known(saved?.defaultSettingType) ? saved!.defaultSettingType! : FALLBACK_SETTING_TYPE);
  const tolerance = Number(params.get('tolerance') ?? 5);
  return {
    chart,
    options: {
      defaultSettingType: settingType,
      tolerancePct: Number.isFinite(tolerance) && tolerance >= 0 ? Math.min(tolerance, 100) : 5,
      settingTypeChoices: saved?.choices,
    },
  };
}

export const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
