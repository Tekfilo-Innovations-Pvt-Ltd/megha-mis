import { NextResponse } from 'next/server';
import { getCompanySummary } from '@/lib/dashboard';
import { getSessionCompanyId } from '@/lib/company';

export const dynamic = 'force-dynamic';

// GET /api/dashboard/summary — figures for the selected company.
export async function GET() {
  const companyId = await getSessionCompanyId();
  if (companyId == null) {
    return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  }
  return NextResponse.json(await getCompanySummary(companyId));
}
