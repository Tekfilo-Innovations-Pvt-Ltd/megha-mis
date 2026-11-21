import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { resolveComparison } from '@/lib/labourReportParams';
import { skuInOtherCompanies } from '@/lib/skuOtherCompanies';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/reports/labour-vs-chart/sku-other-companies?sku=&chart=
// The same SKU's invoice lines in the user's other companies (e.g. an AAA SKU at
// RTPHK): labour per piece, newest first, with averages. Only companies the
// signed-in user may open; the selected company is left out.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const companyId = session?.user?.companyId ?? null;
  if (companyId == null) return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  const p = request.nextUrl.searchParams;
  const sku = p.get('sku')?.trim();
  if (!sku) return NextResponse.json({ message: 'sku is required' }, { status: 400 });
  const resolved = await resolveComparison(p);
  if (resolved instanceof NextResponse) return resolved;

  const others = (session?.user?.companies ?? []).filter((c) => c.id !== companyId);
  const companies = await skuInOtherCompanies(sku, others, resolved.chart, resolved.options);
  return NextResponse.json({ sku, chart: { code: resolved.chart.code, name: resolved.chart.name, currency: resolved.chart.currency }, companies });
}
