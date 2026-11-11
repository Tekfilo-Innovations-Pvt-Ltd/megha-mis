import { NextRequest, NextResponse } from 'next/server';
import { getSessionCompanyId } from '@/lib/company';
import { compareLine } from '@/lib/labourComparison';
import { loadComparisonLines } from '@/lib/labourComparisonData';
import { lineCalcs } from '@/lib/chartCalc';
import { resolveComparison } from '@/lib/labourReportParams';

export const dynamic = 'force-dynamic';
// Loading the line from the ERP can be slow — above Vercel's 10 s default.
export const maxDuration = 60;

// GET /api/reports/labour-vs-chart/line/<invDetId>?chart=&settingType=&tolerance=
// Full comparison of one invoice line (metal charges + every stone).
export async function GET(request: NextRequest, { params }: { params: { invDetId: string } }) {
  const companyId = await getSessionCompanyId();
  if (companyId == null) {
    return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  }
  const invDetId = parseInt(params.invDetId, 10);
  if (!invDetId) return NextResponse.json({ message: 'Invalid line id' }, { status: 400 });

  const resolved = await resolveComparison(request.nextUrl.searchParams);
  if (resolved instanceof NextResponse) return resolved;

  const { info, lines } = await loadComparisonLines({ companyId, invDetId });
  const line = lines[0];
  if (!line) return NextResponse.json({ message: 'Invoice line not found in the selected company' }, { status: 404 });

  const comparison = compareLine(line, resolved.chart, resolved.options);
  return NextResponse.json({
    info: info.get(invDetId),
    line: { productType: line.productType, qty: line.qty, currency: line.currency },
    comparison,
    // How each chart amount of the line is worked out — the pop-ups on the Lines tab.
    calcs: lineCalcs(comparison, line, resolved.chart),
  });
}
