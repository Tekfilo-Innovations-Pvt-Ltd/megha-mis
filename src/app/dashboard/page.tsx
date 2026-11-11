'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { CheckCircleIcon, ClockIcon, ExclamationCircleIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import type { CompanySummary } from '@/lib/dashboard';
import { fmtDate, fmtNum } from '@/lib/format';

interface ErpHealth {
  connected: boolean;
  database?: string;
  tableCount?: number;
  message?: string;
}

async function fetchErpHealth(): Promise<ErpHealth> {
  const res = await fetch('/api/erp/health');
  return res.json();
}

async function fetchSummary(): Promise<CompanySummary> {
  const res = await fetch('/api/dashboard/summary');
  if (!res.ok) throw new Error('Failed to load dashboard');
  return res.json();
}

type Amounts = { currency: string; amount: number }[];

function AmountList({ amounts }: { amounts: Amounts }) {
  if (amounts.length === 0) return <span>—</span>;
  return (
    <>
      {amounts.map((a) => (
        <span key={a.currency} className="block">
          {fmtNum(a.amount)} <span className="text-sm font-normal text-slate-500">{a.currency}</span>
        </span>
      ))}
    </>
  );
}

function StatTile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{children}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// Status is carried by icon + label, never colour alone.
const STATUS_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  PAID: { label: 'Paid', icon: CheckCircleIcon },
  PARTPAID: { label: 'Part paid', icon: ClockIcon },
  UNPAID: { label: 'Unpaid', icon: ExclamationCircleIcon },
};

function StatusLabel({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, icon: QuestionMarkCircleIcon };
  return (
    <span className="inline-flex items-center gap-1.5 text-slate-700">
      <meta.icon className="h-4 w-4 text-slate-400" />
      {meta.label}
    </span>
  );
}

export default function DashboardPage() {
  const companyId = useSession().data?.user?.companyId ?? null;
  const health = useQuery({ queryKey: ['erp-health'], queryFn: fetchErpHealth, retry: false });
  const summary = useQuery({
    queryKey: ['dashboard-summary', companyId],
    queryFn: fetchSummary,
    enabled: companyId != null,
  });

  const data = summary.data;
  const fi = data?.factoryInvoices;

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">
          {data ? data.company.name : companyId == null ? 'Sign out and in again to load your companies' : 'Loading company…'}
        </p>
      </div>

      {summary.isError && <p className="text-red-600 text-sm">Could not load the dashboard for this company.</p>}

      {fi && (
        <>
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${summary.isFetching ? 'opacity-60' : ''}`}>
            <StatTile label="Factory invoices" sub={`${fi.thisMonth} this month · last on ${fmtDate(fi.latestDate)}`}>
              {fi.total.toLocaleString()}
            </StatTile>
            <StatTile label="Invoiced amount">
              <AmountList amounts={fi.amount} />
            </StatTile>
            <StatTile label="Paid">
              <AmountList amounts={fi.paid} />
            </StatTile>
            <StatTile label="Outstanding" sub={`${fi.openCount.toLocaleString()} unpaid or part-paid invoices`}>
              <AmountList amounts={fi.outstanding} />
            </StatTile>
          </div>

          <div className="grid lg:grid-cols-5 gap-4">
            <section className="lg:col-span-2 bg-white rounded-xl border border-slate-200">
              <header className="px-4 py-2.5 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900 text-sm">Factory invoices by payment status</h2>
              </header>
              {fi.byPaymentStatus.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No factory invoices in this company.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500 bg-slate-50">
                    <tr>
                      <th className="px-4 py-1.5 font-medium">Status</th>
                      <th className="px-4 py-1.5 font-medium text-right">Invoices</th>
                      <th className="px-4 py-1.5 font-medium text-right">Amount</th>
                      <th className="px-4 py-1.5 font-medium text-right">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {fi.byPaymentStatus.map((s) => (
                      <tr key={s.status}>
                        <td className="px-4 py-2"><StatusLabel status={s.status} /></td>
                        <td className="px-4 py-2 text-right">{s.count.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">
                          {s.amount.map((a) => <span key={a.currency} className="block">{fmtNum(a.amount)} {a.currency}</span>)}
                          {s.amount.length === 0 && '—'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {s.outstanding.map((a) => <span key={a.currency} className="block">{fmtNum(a.amount)} {a.currency}</span>)}
                          {s.outstanding.length === 0 && '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="lg:col-span-3 bg-white rounded-xl border border-slate-200">
              <header className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900 text-sm">Latest factory invoices</h2>
                <Link href="/dashboard/factory-invoices" className="text-xs text-amber-700 hover:underline">View all</Link>
              </header>
              {fi.recent.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No factory invoices in this company.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-slate-500 bg-slate-50">
                      <tr>
                        <th className="px-4 py-1.5 font-medium">Invoice</th>
                        <th className="px-4 py-1.5 font-medium">Date</th>
                        <th className="px-4 py-1.5 font-medium">Factory</th>
                        <th className="px-4 py-1.5 font-medium">Payment</th>
                        <th className="px-4 py-1.5 font-medium text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fi.recent.map((inv) => (
                        <tr key={inv.invId}>
                          <td className="px-4 py-2">
                            <Link href={`/dashboard/factory-invoices/${inv.invId}`} className="font-medium text-amber-700 hover:underline">
                              {inv.displayNo}
                            </Link>
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">{fmtDate(inv.invDt)}</td>
                          <td className="px-4 py-2">{inv.factoryName}</td>
                          <td className="px-4 py-2">{inv.paymentStatus ? <StatusLabel status={inv.paymentStatus} /> : '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                            {fmtNum(inv.totalAmount)} <span className="text-xs text-slate-500">{inv.currency}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      <p className="text-xs text-slate-500">
        ERP connection:{' '}
        {health.isLoading
          ? 'checking…'
          : health.data?.connected
            ? `connected to ${health.data.database} (${health.data.tableCount} tables)`
            : `not connected — ${health.data?.message ?? 'unknown error'}`}
      </p>
    </div>
  );
}
