import erp from '@/lib/erp';
import { listFactoryInvoices } from '@/lib/factoryInvoice';

const num = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v));

// Payment statuses the ERP uses on tbl_factory_invoice_main, in display order.
const PAYMENT_STATUSES = ['UNPAID', 'PARTPAID', 'PAID'] as const;

// Dashboard figures for one company — every number here is filtered by
// company_id, same as the Factory Invoices screens. Amounts are kept per
// currency (a company can invoice in USD and RMB) rather than added together.
export async function getCompanySummary(companyId: number) {
  const where = { company_id: companyId, is_deleted: 0 };
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [company, total, thisMonth, latest, groups, recent] = await Promise.all([
    erp.tbl_company.findUnique({ where: { company_id: companyId }, select: { company_name: true, default_currency: true } }),
    erp.tbl_factory_invoice_main.count({ where }),
    erp.tbl_factory_invoice_main.count({ where: { ...where, inv_dt: { gte: monthStart } } }),
    erp.tbl_factory_invoice_main.findFirst({ where, orderBy: { inv_dt: 'desc' }, select: { inv_dt: true } }),
    erp.tbl_factory_invoice_main.groupBy({
      by: ['payment_status', 'currency'],
      where,
      _count: { _all: true },
      _sum: { total_amount: true, total_paid_amount: true },
    }),
    listFactoryInvoices({ companyId, page: 0, size: 5 }),
  ]);

  const currencies = Array.from(new Set(groups.map((g) => g.currency))).sort();
  const byCurrency = (rows: typeof groups, pick: (g: (typeof groups)[number]) => number) =>
    currencies
      .map((currency) => ({ currency, amount: rows.filter((g) => g.currency === currency).reduce((s, g) => s + pick(g), 0) }))
      .filter((c) => c.amount !== 0);

  const statusKey = (s: string | null) => s ?? 'UNKNOWN';
  const statuses = Array.from(new Set([...PAYMENT_STATUSES, ...groups.map((g) => statusKey(g.payment_status))]));
  const open = groups.filter((g) => g.payment_status !== 'PAID');

  return {
    company: { id: companyId, name: company?.company_name ?? `Company ${companyId}`, defaultCurrency: company?.default_currency ?? null },
    factoryInvoices: {
      total,
      thisMonth,
      latestDate: latest ? latest.inv_dt.toISOString().slice(0, 10) : null,
      amount: byCurrency(groups, (g) => num(g._sum.total_amount)),
      paid: byCurrency(groups, (g) => num(g._sum.total_paid_amount)),
      // Outstanding = invoiced − paid on invoices not fully paid.
      outstanding: byCurrency(open, (g) => num(g._sum.total_amount) - num(g._sum.total_paid_amount)),
      openCount: open.reduce((s, g) => s + g._count._all, 0),
      byPaymentStatus: statuses
        .map((status) => {
          const rows = groups.filter((g) => statusKey(g.payment_status) === status);
          return {
            status,
            count: rows.reduce((s, g) => s + g._count._all, 0),
            amount: byCurrency(rows, (g) => num(g._sum.total_amount)),
            outstanding: byCurrency(rows, (g) => num(g._sum.total_amount) - num(g._sum.total_paid_amount)),
          };
        })
        .filter((s) => s.count > 0),
      recent: recent.content,
    },
  };
}

export type CompanySummary = Awaited<ReturnType<typeof getCompanySummary>>;
