import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSessionCompanyId } from '@/lib/company';
import { requirePermission } from '@/lib/rbac';
import { CorrectionWorkbookError, parseCorrectionWorkbook } from '@/lib/stoneCorrections';
import { getStoneCorrections, removeStoneCorrections, replaceStoneCorrections } from '@/lib/stoneCorrectionsStore';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 20 * 1024 * 1024;

// Customer stone corrections (shape / MM size) of the selected company, used by
// Labour vs Chart in place of the ERP values.
//   GET     what is uploaded (counts, file, when)
//   POST    multipart "file" — replaces the corrections (previous kept as a backup)
//   DELETE  removes them — the report goes back to the ERP values
async function company() {
  const companyId = await getSessionCompanyId();
  return companyId == null ? NextResponse.json({ message: 'No company selected' }, { status: 401 }) : companyId;
}

export async function GET() {
  const companyId = await company();
  if (companyId instanceof NextResponse) return companyId;
  const c = await getStoneCorrections(companyId);
  return NextResponse.json(
    c ? { fileName: c.fileName, uploadedAt: c.uploadedAt, uploadedBy: c.uploadedBy, stoneRows: c.stoneRows.length, lots: c.lots.length } : null,
  );
}

export async function POST(request: Request) {
  const denied = await requirePermission('manage_price_charts');
  if (denied) return denied;
  const companyId = await company();
  if (companyId instanceof NextResponse) return companyId;

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ message: 'Choose an .xlsx file to upload' }, { status: 400 });
  if (!file.name.toLowerCase().endsWith('.xlsx')) return NextResponse.json({ message: 'Upload an .xlsx workbook' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ message: 'The file is larger than 20 MB' }, { status: 400 });

  let parsed;
  try {
    parsed = await parseCorrectionWorkbook(await file.arrayBuffer());
  } catch (e) {
    if (e instanceof CorrectionWorkbookError) return NextResponse.json({ message: e.message }, { status: 422 });
    throw e;
  }
  const session = await getServerSession(authOptions);
  const { backup } = await replaceStoneCorrections(companyId, {
    fileName: file.name,
    uploadedAt: new Date().toISOString(),
    uploadedBy: session?.user?.name ?? null,
    ...parsed,
  });
  return NextResponse.json({ message: 'Stone corrections replaced', backup, stoneRows: parsed.stoneRows.length, lots: parsed.lots.length });
}

export async function DELETE() {
  const denied = await requirePermission('manage_price_charts');
  if (denied) return denied;
  const companyId = await company();
  if (companyId instanceof NextResponse) return companyId;
  const { backup } = await removeStoneCorrections(companyId);
  return NextResponse.json({ message: backup ? 'Stone corrections removed' : 'No stone corrections to remove', backup });
}
