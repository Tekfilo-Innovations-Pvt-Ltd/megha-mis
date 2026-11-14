import { NextRequest, NextResponse } from 'next/server';
import { getSessionCompanyId } from '@/lib/company';
import { buildLabourDashboard } from '@/lib/labourDashboard';
import { isDate, resolveComparison } from '@/lib/labourReportParams';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/dashboard/labour?from=&to=&jobCategory=&factory=&productType=
// (optional: chart=&settingType=&tolerance= — default: the company's chart / Prong/Pave / 5%)
// The dashboard figures for the selected company: Labour vs Chart totals by
// factory, labour type, product type and month, top over-charged lines,
// factory invoices in the period, CAD and data quality.
export async function GET(request: NextRequest) {
  const companyId = await getSessionCompanyId();
  if (companyId == null) {
    return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  }
  const p = request.nextUrl.searchParams;
  const resolved = await resolveComparison(p);
  if (resolved instanceof NextResponse) return resolved;

  const from = p.get('from');
  const to = p.get('to');
  if ((from && !isDate(from)) || (to && !isDate(to))) {
    return NextResponse.json({ message: 'Dates must be yyyy-mm-dd' }, { status: 400 });
  }

  const dashboard = await buildLabourDashboard(
    {
      companyId,
      from: from ?? undefined,
      to: to ?? undefined,
      jobCategory: p.get('jobCategory')?.trim() || undefined,
      productType: p.get('productType')?.trim() || undefined,
      factoryId: Number(p.get('factory')) || undefined,
    },
    resolved.chart,
    resolved.options,
  );
  return NextResponse.json({
    chart: { code: resolved.chart.code, name: resolved.chart.name, currency: resolved.chart.currency },
    ...dashboard,
  });
}
