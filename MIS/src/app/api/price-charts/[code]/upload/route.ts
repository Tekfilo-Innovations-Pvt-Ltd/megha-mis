import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { CHART_CODE, getPriceChart, priceChartSchema, replacePriceChart } from '@/lib/priceChartStore';
import { WorkbookError, workbookToChart } from '@/lib/priceChartWorkbook';
import type { PriceChart } from '@/lib/priceChart';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024;

// POST /api/price-charts/<code>/upload (multipart, field "file") — deletes the
// chart's data and replaces it with the uploaded workbook. The whole file is
// checked first; on any problem nothing changes. The previous chart is kept as
// a backup. Charts are shared by every company, so only ADMIN may upload.
export async function POST(request: Request, { params }: { params: { code: string } }) {
  const denied = await requirePermission('manage_price_charts');
  if (denied) return denied;

  if (!CHART_CODE.test(params.code)) {
    return NextResponse.json({ message: 'Invalid chart code' }, { status: 400 });
  }
  if (!(await getPriceChart(params.code))) {
    return NextResponse.json({ message: 'Price chart not found' }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ message: 'Choose an .xlsx file to upload' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ message: 'Upload the .xlsx workbook downloaded from MIS' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ message: 'The file is larger than 5 MB' }, { status: 400 });
  }

  let chart: PriceChart;
  try {
    chart = await workbookToChart(await file.arrayBuffer(), params.code, file.name);
  } catch (e) {
    if (e instanceof WorkbookError) {
      return NextResponse.json({ message: e.message, problems: e.problems }, { status: 422 });
    }
    throw e;
  }

  const checked = priceChartSchema.safeParse(chart);
  if (!checked.success) {
    const problems = checked.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
    return NextResponse.json({ message: `The workbook has ${problems.length} problem${problems.length === 1 ? '' : 's'}`, problems }, { status: 422 });
  }

  const { backup } = await replacePriceChart(chart);
  return NextResponse.json({
    message: 'Chart replaced',
    backup,
    counts: {
      metalRates: chart.metalChart.rates.length,
      settingRates: chart.settingChart.rates.length,
      commodities: chart.settingChart.commodities.length,
    },
  });
}
