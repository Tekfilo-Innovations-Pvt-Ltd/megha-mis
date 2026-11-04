import { NextResponse } from 'next/server';
import { CHART_CODE, getPriceChart } from '@/lib/priceChartStore';
import { chartToWorkbook } from '@/lib/priceChartWorkbook';

export const dynamic = 'force-dynamic';

// GET /api/price-charts/<code>/download — the chart as an .xlsx workbook that
// can be edited and uploaded back.
export async function GET(_request: Request, { params }: { params: { code: string } }) {
  if (!CHART_CODE.test(params.code)) {
    return NextResponse.json({ message: 'Invalid chart code' }, { status: 400 });
  }
  const chart = await getPriceChart(params.code);
  if (!chart) {
    return NextResponse.json({ message: 'Price chart not found' }, { status: 404 });
  }

  const body = await chartToWorkbook(chart);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="price-chart-${chart.code}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
