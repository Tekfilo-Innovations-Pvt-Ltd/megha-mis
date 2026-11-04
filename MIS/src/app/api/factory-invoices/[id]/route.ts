import { NextResponse } from 'next/server';
import { getFactoryInvoice } from '@/lib/factoryInvoice';
import { getSessionCompanyId } from '@/lib/company';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const companyId = await getSessionCompanyId();
  if (companyId == null) {
    return NextResponse.json({ message: 'No company selected' }, { status: 401 });
  }

  const invId = parseInt(params.id, 10);
  if (!invId) {
    return NextResponse.json({ message: 'Invalid invoice id' }, { status: 400 });
  }

  const invoice = await getFactoryInvoice(invId, companyId);
  if (!invoice) {
    return NextResponse.json({ message: 'Factory invoice not found in the selected company' }, { status: 404 });
  }
  return NextResponse.json(invoice);
}
