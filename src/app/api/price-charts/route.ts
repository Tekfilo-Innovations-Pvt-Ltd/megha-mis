import { NextResponse } from 'next/server';
import { getSessionCompanyId } from '@/lib/company';
import { defaultChartFor, listPriceCharts } from '@/lib/priceChartStore';

export const dynamic = 'force-dynamic';

// GET /api/price-charts — every factory price chart (not company data), the
// selected company's default chart first (see defaultChartFor).
export async function GET() {
  const charts = await listPriceCharts();
  const first = defaultChartFor(charts, await getSessionCompanyId());
  return NextResponse.json(first ? [first, ...charts.filter((c) => c !== first)] : charts);
}
