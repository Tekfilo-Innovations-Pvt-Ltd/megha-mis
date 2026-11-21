import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSessionCompanyId } from '@/lib/company';
import { isSharedViewer } from '@/lib/settingChoices';
import { isDate, resolveComparison } from '@/lib/labourReportParams';
import { loadSettingChoiceRows } from '@/lib/settingChoiceRows';
import { FALLBACK_SETTING_TYPE } from '@/lib/settingChoices';
import { getSettingChoices, saveSettingChoices } from '@/lib/settingChoicesStore';
import { isMetalType, type MetalType } from '@/lib/metalType';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Setting types for stones the ERP records none for (src/lib/settingChoices.ts),
// for the selected company and chart.
//   GET ?chart=&from=&to=&productType=&factory=&jobCategory=&sku=&skuExact=1&invNo=&jewNo=&bagNo=&metalType=
//       the chart's setting types, the saved default and choices, and the distinct
//       stones without a type in those lines
//   PUT { chart, defaultSettingType, choices: { [key]: typeCode } } — replaces the
//       company's choices for that chart (previous file kept as a backup)
export async function GET(request: NextRequest) {
  const companyId = await getSessionCompanyId();
  if (companyId == null) return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  const p = request.nextUrl.searchParams;
  const resolved = await resolveComparison(p);
  if (resolved instanceof NextResponse) return resolved;
  const from = p.get('from');
  const to = p.get('to');
  if ((from && !isDate(from)) || (to && !isDate(to))) return NextResponse.json({ message: 'Dates must be yyyy-mm-dd' }, { status: 400 });

  const [saved, rows] = await Promise.all([
    getSettingChoices(companyId, resolved.chart.code),
    loadSettingChoiceRows(
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
        metalType: isMetalType(p.get('metalType')) ? (p.get('metalType') as MetalType) : undefined,
      },
      resolved.chart,
      resolved.options,
    ),
  ]);
  return NextResponse.json({
    chart: { code: resolved.chart.code, name: resolved.chart.name },
    settingTypes: resolved.chart.settingChart.settingTypes.map((t) => ({ code: t.code, name: t.name })),
    defaultSettingType: saved?.defaultSettingType ?? FALLBACK_SETTING_TYPE,
    choices: saved?.choices ?? {},
    updatedAt: saved?.updatedAt ?? null,
    updatedBy: saved?.updatedBy ?? null,
    rows,
  });
}

export async function PUT(request: NextRequest) {
  // Any ERP login may choose; the shared MIS viewer login (src/lib/sharedLogin.ts) is view only.
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (isSharedViewer(session.user.id)) {
    return NextResponse.json({ message: 'The shared viewer login is view only — sign in with your ERP login to change setting types' }, { status: 403 });
  }
  const companyId = session.user.companyId ?? null;
  if (companyId == null) return NextResponse.json({ message: 'No company selected' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { chart?: string; defaultSettingType?: string; choices?: Record<string, unknown> } | null;
  const params = new URLSearchParams(body?.chart ? { chart: body.chart } : {});
  const resolved = await resolveComparison(params);
  if (resolved instanceof NextResponse) return resolved;
  const codes = new Set(resolved.chart.settingChart.settingTypes.map((t) => t.code));

  const defaultSettingType = body?.defaultSettingType ?? FALLBACK_SETTING_TYPE;
  if (!codes.has(defaultSettingType)) return NextResponse.json({ message: `Unknown setting type "${defaultSettingType}"` }, { status: 400 });
  const choices: Record<string, string> = {};
  for (const [key, code] of Object.entries(body?.choices ?? {})) {
    if (code == null || code === '') continue;
    if (typeof code !== 'string' || !codes.has(code)) return NextResponse.json({ message: `Unknown setting type "${String(code)}"` }, { status: 400 });
    if (key.length > 300) return NextResponse.json({ message: 'Stone key too long' }, { status: 400 });
    choices[key] = code;
  }

  await saveSettingChoices(companyId, resolved.chart.code, {
    defaultSettingType,
    choices,
    updatedAt: new Date().toISOString(),
    updatedBy: session?.user?.name ?? null,
  });
  return NextResponse.json({ message: `Setting types saved — ${Object.keys(choices).length.toLocaleString()} stone choices`, choices: Object.keys(choices).length });
}
