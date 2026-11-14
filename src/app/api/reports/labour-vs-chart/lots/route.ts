import { NextRequest, NextResponse } from 'next/server';
import { getSessionCompanyId } from '@/lib/company';
import { buildLotReport, type ReportSort, type ReportStatusFilter } from '@/lib/labourReport';
import { isDate, resolveComparison } from '@/lib/labourReportParams';
import { lotReportToWorkbook } from '@/lib/labourLotWorkbook';

export const dynamic = 'force-dynamic';
// Comparing every line of the company takes several seconds — above Vercel's 10 s default.
export const maxDuration = 60;

const STATUSES: ReportStatusFilter[] = ['ALL', 'IN_LINE', 'OVER', 'UNDER', 'NOT_COMPARABLE', 'PARTIAL', 'DOUBLE_SETTING'];
const SORTS: ReportSort[] = ['variance', 'variancePct', 'date'];

// GET /api/reports/labour-vs-chart/lots?from=&to=&productType=&jobCategory=&sku=&invNo=&jewNo=&bagNo=&status=&sort=&page=&size=
//     &format=xlsx   → every matching line as an Excel download (page/size ignored)
// Lot detail of the labour-vs-chart report: per invoice line, one row per
// metal charge / stone lot with invoice and chart labour rate and amount.
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
  const status = (p.get('status') ?? 'ALL') as ReportStatusFilter;
  const sort = (p.get('sort') ?? 'variance') as ReportSort;
  const xlsx = p.get('format') === 'xlsx';

  const report = await buildLotReport(
    {
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
    },
    resolved.chart,
    resolved.options,
    {
      status: STATUSES.includes(status) ? status : 'ALL',
      sort: SORTS.includes(sort) ? sort : 'variance',
      page: xlsx ? 0 : Math.max(0, Number(p.get('page')) || 0),
      size: xlsx ? null : Math.min(200, Math.max(1, Number(p.get('size')) || 50)),
    },
  );

  const chart = { code: resolved.chart.code, name: resolved.chart.name, currency: resolved.chart.currency };
  if (!xlsx) return NextResponse.json({ chart, ...report });

  const body = await lotReportToWorkbook(report.groups, { chartName: chart.name, currency: chart.currency });
  return new NextResponse(new Uint8Array(body as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="labour-vs-chart-lots-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
