'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Variance, VariancePct, variancePct } from '@/components/labour/LineComparisonDetail';
import type { FactoryInvoiceListResponse, FactoryInvoiceTotals } from '@/lib/factoryInvoice';
import { fmtDate, fmtNum } from '@/lib/format';

const PAGE_SIZE = 25;

type Chart = { chart: { code: string; name: string; currency: string } };
type Filters = { search: string; invNo: string; jewNo: string };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Request failed');
  return res.json();
}

// A text filter that waits for typing to stop, so every keystroke doesn't hit the ERP.
function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function FactoryInvoicesPage() {
  const [searchInput, setSearchInput] = useState('');
  const [invNoInput, setInvNoInput] = useState('');
  const [jewNoInput, setJewNoInput] = useState('');
  const filters: Filters = { search: useDebounced(searchInput), invNo: useDebounced(invNoInput), jewNo: useDebounced(jewNoInput) };
  const [page, setPage] = useState(0);
  const companyId = useSession().data?.user?.companyId ?? null;

  // A different company or filter has a different number of pages.
  useEffect(() => setPage(0), [companyId, filters.search, filters.invNo, filters.jewNo]);

  const filterQuery = new URLSearchParams(filters).toString();
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['factory-invoices', companyId, filterQuery, page],
    queryFn: () => getJson<FactoryInvoiceListResponse & Chart>(`/api/factory-invoices?${filterQuery}&page=${page}&size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
    enabled: companyId != null,
  });
  // Totals cover every matching invoice, so they load separately from the page.
  const totals = useQuery({
    queryKey: ['factory-invoices-totals', companyId, filterQuery],
    queryFn: () => getJson<FactoryInvoiceTotals & Chart>(`/api/factory-invoices/totals?${filterQuery}`),
    placeholderData: keepPreviousData,
    enabled: companyId != null,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.totalElements / PAGE_SIZE)) : 1;
  const chartCurrency = data?.chart.currency ?? totals.data?.chart.currency ?? '';
  const hasFilters = !!(searchInput || invNoInput || jewNoInput);
  const t = totals.data;

  const inputClass = 'px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Factory Invoices</h1>
        <p className="text-sm text-slate-500">tbl_factory_invoice_main and its lines, components, labour and charges</p>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Invoice No</span>
          <input value={invNoInput} onChange={(e) => setInvNoInput(e.target.value)} placeholder="Any invoice" title="Any invoice number containing this text" className={`${inputClass} w-40`} />
        </label>
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Jewellery No</span>
          <input value={jewNoInput} onChange={(e) => setJewNoInput(e.target.value)} placeholder="Any jewellery" title="Invoices with a line whose jewellery number contains this text" className={`${inputClass} w-40`} />
        </label>
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Search</span>
          <span className="relative block">
            <MagnifyingGlassIcon className="h-4 w-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Reference or factory" className={`${inputClass} w-56 pl-8`} />
          </span>
        </label>
        {hasFilters && (
          <button onClick={() => { setSearchInput(''); setInvNoInput(''); setJewNoInput(''); }} className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
            Clear filters
          </button>
        )}
        {data && <span className="ml-auto text-xs text-slate-500 self-center">Chart labour: {data.chart.name}</span>}
      </section>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Invoice</th>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Factory</th>
              <th className="px-4 py-3 font-semibold">Reference</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Lines</th>
              <th className="px-4 py-3 font-semibold text-right">Qty</th>
              <th className="px-4 py-3 font-semibold text-right" title="Total labour on the invoice">Invoice labour</th>
              <th className="px-4 py-3 font-semibold text-right" title="Chart labour of the invoice's comparable lines; below it, the invoiced labour it is compared with">Chart labour</th>
              <th className="px-4 py-3 font-semibold text-right whitespace-nowrap" title="Compared invoice labour − chart labour">Diff Amount</th>
              <th className="px-4 py-3 font-semibold text-right whitespace-nowrap">Diff %</th>
              <th className="px-4 py-3 font-semibold text-right">Amount</th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-slate-100 ${isFetching ? 'opacity-60' : ''}`}>
            {isLoading && (
              <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            )}
            {isError && (
              <tr><td colSpan={12} className="px-4 py-8 text-center text-red-600">Could not load invoices from the ERP.</td></tr>
            )}
            {data?.content.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-500">No factory invoices found.</td></tr>
            )}
            {data?.content.map((inv) => (
              <tr key={inv.invId} className="hover:bg-amber-50/50">
                <td className="px-4 py-2.5">
                  <Link href={`/dashboard/factory-invoices/${inv.invId}`} className="font-medium text-amber-700 hover:underline">
                    {inv.displayNo}
                  </Link>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(inv.invDt)}</td>
                <td className="px-4 py-2.5">{inv.factoryName}</td>
                <td className="px-4 py-2.5 text-slate-500">{inv.referenceNo || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className="text-xs">{inv.status || '—'}</span>
                  {inv.paymentStatus && <span className="ml-1 text-xs text-slate-500">/ {inv.paymentStatus}</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{inv.lineCount}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(inv.totalQty, 0)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(inv.totalLabourAmount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {inv.chartLabour == null ? '—' : (
                    <>
                      {fmtNum(inv.chartLabour)}
                      <span className="block text-xs text-slate-500" title={`${inv.comparableLines} of ${inv.lineCount} lines comparable`}>vs {fmtNum(inv.invoicedCompared)} inv.</span>
                    </>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">{inv.chartLabour == null ? '—' : <Variance value={inv.invoicedCompared! - inv.chartLabour} />}</td>
                <td className="px-4 py-2.5 text-right">{inv.chartLabour == null ? '—' : <VariancePct pct={variancePct(inv.invoicedCompared!, inv.chartLabour)} />}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {fmtNum(inv.totalAmount)} <span className="text-xs text-slate-400">{inv.currency}</span>
                </td>
              </tr>
            ))}
          </tbody>
          {data && data.content.length > 0 && (
            <tfoot className={`bg-slate-50 border-t-2 border-slate-200 font-semibold ${totals.isFetching ? 'opacity-60' : ''}`}>
              <tr>
                <td colSpan={7} className="px-4 py-3">
                  Total of {data.totalElements.toLocaleString()} matching invoices
                  {totals.isLoading && <span className="ml-2 text-xs font-normal text-slate-500">calculating…</span>}
                  {totals.isError && <span className="ml-2 text-xs font-normal text-red-600">{(totals.error as Error).message}</span>}
                  {t && <span className="block text-xs font-normal text-slate-500">Chart compared on {t.comparableLines.toLocaleString()} of {t.lines.toLocaleString()} lines · {chartCurrency}</span>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{t ? fmtNum(t.labour) : ''}</td>
                <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                  {t && (
                    <>
                      {fmtNum(t.chartLabour)}
                      <span className="block text-xs font-normal text-slate-500">vs {fmtNum(t.invoicedCompared)} inv.</span>
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-right">{t && <Variance value={t.variance} />}</td>
                <td className="px-4 py-3 text-right">{t && <VariancePct pct={variancePct(t.invoicedCompared, t.chartLabour)} />}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {data && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{data.totalElements.toLocaleString()} invoices</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Previous
            </button>
            <span>Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page + 1 >= totalPages}
              className="px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
