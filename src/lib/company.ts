import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import erp from '@/lib/erp';

export interface CompanyOption {
  id: number;
  name: string;
}

// Companies a user may work in: their tbl_user_company_map rows, or every
// company for an ERP superadmin (who may have no map rows at all). The
// is_default mapping comes first so it becomes the starting company.
export async function getUserCompanies(userId: number, isSuperadmin: boolean): Promise<CompanyOption[]> {
  if (isSuperadmin) {
    const companies = await erp.tbl_company.findMany({
      where: { is_deleted: 0 },
      orderBy: { company_id: 'asc' },
      select: { company_id: true, company_name: true },
    });
    return companies.map((c) => ({ id: c.company_id, name: c.company_name }));
  }

  const maps = await erp.tbl_user_company_map.findMany({
    where: { user_id: userId, is_deleted: 0, is_active: 1 },
    orderBy: [{ is_default: 'desc' }, { company_id: 'asc' }],
    select: { company_id: true },
  });
  const ids = maps.map((m) => m.company_id);
  const companies = await erp.tbl_company.findMany({
    where: { company_id: { in: ids }, is_deleted: 0 },
    select: { company_id: true, company_name: true },
  });
  const names = new Map(companies.map((c) => [c.company_id, c.company_name]));
  return ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! }));
}

// Companies that have factory invoices — what the shared MIS viewer login
// (src/lib/sharedLogin.ts) may switch between. Most invoices first.
export async function getCompaniesWithInvoices(): Promise<CompanyOption[]> {
  const rows = await erp.$queryRaw<{ id: number; name: string }[]>`
    SELECT c.company_id AS id, c.company_name AS name
      FROM tbl_company c
      JOIN tbl_factory_invoice_main m ON m.company_id = c.company_id AND m.is_deleted = 0
     WHERE c.is_deleted = 0
     GROUP BY 1, 2
     ORDER BY count(*) DESC`;
  return rows;
}

// The company the signed-in user is currently working in (switched via the
// sidebar). Every company-scoped query must filter by this.
export async function getSessionCompanyId(): Promise<number | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.companyId ?? null;
}
