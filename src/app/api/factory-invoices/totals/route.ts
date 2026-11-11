import { NextRequest, NextResponse } from 'next/server';
import { factoryInvoiceTotals } from '@/lib/factoryInvoice';
import { getSessionCompanyId } from '@/lib/company';
import { resolveComparison } from '@/lib/labourReportParams';

export const dynamic = 'force-dynamic';

// GET /api/factory-invoices/totals?search=&invNo=&jewNo= — invoice and chart labour of
// every matching invoice (optional: chart=&settingType=&tolerance=).
export async function GET(request: NextRequest) {
  const companyId = await getSessionCompanyId();
  if (companyId == null) {
    return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const resolved = await resolveComparison(params);
  if (resolved instanceof NextResponse) return resolved;

  const totals = await factoryInvoiceTotals(
    {
      companyId,
      search: params.get('search') ?? undefined,
      invNo: params.get('invNo') ?? undefined,
      jewNo: params.get('jewNo') ?? undefined,
    },
    resolved.chart,
    resolved.options,
  );
  return NextResponse.json({ ...totals, chart: { code: resolved.chart.code, name: resolved.chart.name, currency: resolved.chart.currency } });
}
