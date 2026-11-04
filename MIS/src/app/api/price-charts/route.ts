import { NextResponse } from 'next/server';
import { listPriceCharts } from '@/lib/priceChartStore';

export const dynamic = 'force-dynamic';

// GET /api/price-charts — every factory price chart (not company data).
export async function GET() {
  return NextResponse.json(await listPriceCharts());
}
