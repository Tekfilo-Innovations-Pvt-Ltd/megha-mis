import { NextResponse } from 'next/server';
import { getPriceChartMasters } from '@/lib/priceChartMasters';

export const dynamic = 'force-dynamic';

// GET /api/price-charts/masters — the ERP's product types, commodities, shapes
// and setting types (shared by every company), to show which ERP masters each
// chart row covers.
export async function GET() {
  return NextResponse.json(await getPriceChartMasters());
}
