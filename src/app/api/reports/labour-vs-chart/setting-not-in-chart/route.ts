import { NextRequest, NextResponse } from 'next/server';
import { getSessionCompanyId } from '@/lib/company';
import { loadComparisonLines } from '@/lib/labourComparisonData';
import { isDate, resolveComparison } from '@/lib/labourReportParams';
import { findMissingStones, groupMissingStones } from '@/lib/settingNotInChart';
import { settingNotInChartWorkbook } from '@/lib/settingNotInChartWorkbook';

export const dynamic = 'force-dynamic';
// Comparing every line of the company takes several seconds — above Vercel's 10 s default.
export const maxDuration = 60;

// GET /api/reports/labour-vs-chart/setting-not-in-chart?from=&to=&productType=&jobCategory=&sku=&skuExact=1&invNo=&jewNo=&bagNo=
// Excel of every stone on the matching lines that has no setting chart value,
// grouped into commodity / shape / setting type / ct-range combinations.
// Line status and sort don't apply — this is per stone, not per line.
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

  const { info, lines } = await loadComparisonLines({
    companyId,
    from: from ?? undefined,
    to: to ?? undefined,
    productType: p.get('productType')?.trim() || undefined,
      factoryId: Number(p.get('factory')) || undefined,
    jobCategory: p.get('jobCategory')?.trim() || undefined,
    sku: p.get('sku')?.trim() || undefined,
    skuExact: p.get('skuExact') === '1',
    invNo: p.get('invNo')?.trim() || undefined,
    jewNo: p.get('jewNo')?.trim() || undefined,
    bagNo: p.get('bagNo')?.trim() || undefined,
  });
  const { missing } = findMissingStones(info, lines, resolved.chart, resolved.options);
  const body = await settingNotInChartWorkbook(groupMissingStones(missing), missing, { chartName: resolved.chart.name });
  return new NextResponse(new Uint8Array(body as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="setting-not-in-chart-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
