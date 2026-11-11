import { NextRequest, NextResponse } from 'next/server';
import { listFactoryInvoices } from '@/lib/factoryInvoice';
import { getSessionCompanyId } from '@/lib/company';
import { resolveComparison } from '@/lib/labourReportParams';

export const dynamic = 'force-dynamic';

// GET /api/factory-invoices?search=&invNo=&jewNo=&page=0&size=25 — the selected company's invoices,
// each with its labour compared with the price chart (optional: chart=&settingType=&tolerance=).
export async function GET(request: NextRequest) {
  const companyId = await getSessionCompanyId();
  if (companyId == null) {
    return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const resolved = await resolveComparison(params);
  if (resolved instanceof NextResponse) return resolved;
  const page = Math.max(0, parseInt(params.get('page') ?? '0', 10) || 0);
  const size = Math.min(100, Math.max(1, parseInt(params.get('size') ?? '25', 10) || 25));

  const list = await listFactoryInvoices(
    {
      companyId,
      search: params.get('search') ?? undefined,
      invNo: params.get('invNo') ?? undefined,
      jewNo: params.get('jewNo') ?? undefined,
      page,
      size,
    },
    resolved,
  );
  return NextResponse.json({ ...list, chart: { code: resolved.chart.code, name: resolved.chart.name, currency: resolved.chart.currency } });
}
