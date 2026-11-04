import { NextResponse } from 'next/server';
import { CHART_CODE, getPriceChart } from '@/lib/priceChartStore';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  if (!CHART_CODE.test(params.code)) {
    return NextResponse.json({ message: 'Invalid chart code' }, { status: 400 });
  }
  const chart = await getPriceChart(params.code);
  if (!chart) {
    return NextResponse.json({ message: 'Price chart not found' }, { status: 404 });
  }
  return NextResponse.json(chart);
}
