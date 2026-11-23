import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { skuIndex } from '@/lib/skuOtherCompanies';

export const dynamic = 'force-dynamic';

// GET /api/reports/labour-vs-chart/sku-index
// SKUs invoiced in the user's other companies (base SKU, "-A" clones folded in)
// with each company's line count — for the "also invoiced elsewhere" hints.
export async function GET() {
  const session = await getServerSession(authOptions);
  const companyId = session?.user?.companyId ?? null;
  if (companyId == null) return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  const others = (session?.user?.companies ?? []).filter((c) => c.id !== companyId);
  return NextResponse.json({ skus: await skuIndex(others) });
}
