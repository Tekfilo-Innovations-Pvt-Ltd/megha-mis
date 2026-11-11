import { NextRequest, NextResponse } from 'next/server';
import { getSessionCompanyId } from '@/lib/company';
import { compareLine, type LineComparison } from '@/lib/labourComparison';
import { loadComparisonLines } from '@/lib/labourComparisonData';
import { resolveComparison } from '@/lib/labourReportParams';

export const dynamic = 'force-dynamic';

// GET /api/factory-invoices/<id>/chart-comparison?chart=&settingType=&tolerance=
// Every line of one invoice compared with the price chart, keyed by inv_det_id.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const companyId = await getSessionCompanyId();
  if (companyId == null) {
    return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  }
  const invId = parseInt(params.id, 10);
  if (!invId) return NextResponse.json({ message: 'Invalid invoice id' }, { status: 400 });

  const resolved = await resolveComparison(request.nextUrl.searchParams);
  if (resolved instanceof NextResponse) return resolved;

  const { lines } = await loadComparisonLines({ companyId, invId });
  const comparisons: Record<number, LineComparison> = {};
  for (const line of lines) comparisons[line.invDetId] = compareLine(line, resolved.chart, resolved.options);

  return NextResponse.json({
    chart: { code: resolved.chart.code, name: resolved.chart.name, currency: resolved.chart.currency },
    settingType: resolved.options.defaultSettingType,
    lines: comparisons,
  });
}
