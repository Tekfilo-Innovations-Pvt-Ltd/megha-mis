'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Variance, VariancePct, variancePct } from '@/components/labour/LineComparisonDetail';
import type { FactoryInvoiceListResponse, FactoryInvoiceTotals } from '@/lib/factoryInvoice';
import { fmtDate, fmtNum } from '@/lib/format';
import { METAL_TYPES, metalTypeLabel } from '@/lib/metalType';
import { SIDE, SideLegend } from '@/components/labour/sides';

const PAGE_SIZE = 25;

type Chart = { chart: { code: string; name: string; currency: string } };
type Filters = { search: string; invNo: string; jewNo: string; metalType: string };

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
  const [metalType, setMetalType] = useState(''); // '' = all metal types
  const filters: Filters = { search: useDebounced(searchInput), invNo: useDebounced(invNoInput), jewNo: useDebounced(jewNoInput), metalType };
  const [page, setPage] = useState(0);
  const companyId = useSession().data?.user?.companyId ?? null;

  // A different company or filter has a different number of pages.
  useEffect(() => setPage(0), [companyId, filters.search, filters.invNo, filters.jewNo, filters.metalType]);

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
  const hasFilters = !!(searchInput || invNoInput || jewNoInput || metalType);
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
          <button onClick={() => { setSearchInput(''); setInvNoInput(''); setJewNoInput(''); setMetalType(''); }} className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
            Clear filters
          </button>
        )}
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Metal type</span>
          <select value={metalType} onChange={(e) => setMetalType(e.target.value)} className={`${inputClass} max-w-[12rem]`} title="Invoices with at least one item of this metal type">
            <option value="">All metal types</option>
            {METAL_TYPES.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </label>
        <span className="ml-auto self-center flex flex-col items-end gap-1">
          <SideLegend />
          {data && <span className="text-xs text-slate-500">Chart: {data.chart.name}</span>}
        </span>
      </section>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th rowSpan={2} className="px-4 py-2 font-semibold">Invoice</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold">Date</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold">Factory</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold whitespace-nowrap">Metal type</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold">Reference</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold">Status</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold text-right">Lines</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold text-right">Qty</th>
              <th colSpan={2} className={`px-4 py-1.5 font-semibold text-center border-l-2 border-white ${SIDE.invoice.head}`}>Invoice labour</th>
              <th className={`px-4 py-1.5 font-semibold text-center border-l-2 border-white ${SIDE.chart.head}`}>Chart labour</th>
              <th colSpan={2} className={`px-4 py-1.5 font-semibold text-center border-l-2 border-white ${SIDE.diff.head}`}>Difference</th>
              <th rowSpan={2} className="px-4 py-2 font-semibold text-right">Amount</th>
            </tr>
            <tr>
              <th className={`px-4 py-1.5 font-medium text-right border-l-2 border-white ${SIDE.invoice.head}`} title="Total labour on the invoice">Total</th>
              <th className={`px-4 py-1.5 font-medium text-right ${SIDE.invoice.head}`} title="The part of the invoice labour the chart could price — what the chart labour is set against">Compared</th>
              <th className={`px-4 py-1.5 font-medium text-right border-l-2 border-white ${SIDE.chart.head}`} title="Chart labour of the invoice's comparable lines">Chart</th>
              <th className={`px-4 py-1.5 font-medium text-right border-l-2 border-white ${SIDE.diff.head}`} title="Compared invoice labour − chart labour">Amount</th>
              <th className={`px-4 py-1.5 font-medium text-right ${SIDE.diff.head}`}>%</th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-slate-100 ${isFetching ? 'opacity-60' : ''}`}>
            {isLoading && (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            )}
            {isError && (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-red-600">Could not load invoices from the ERP.</td></tr>
            )}
            {data?.content.length === 0 && (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-slate-500">No factory invoices found.</td></tr>
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
                <td className="px-4 py-2.5">{inv.metalTypes.length ? inv.metalTypes.map(metalTypeLabel).join(', ') : '—'}</td>
                <td className="px-4 py-2.5 text-slate-500">{inv.referenceNo || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className="text-xs">{inv.status || '—'}</span>
                  {inv.paymentStatus && <span className="ml-1 text-xs text-slate-500">/ {inv.paymentStatus}</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{inv.lineCount}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(inv.totalQty, 0)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums border-l-2 border-white font-medium ${SIDE.invoice.cell}`}>{fmtNum(inv.totalLabourAmount)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${SIDE.invoice.cell}`} title={`${inv.comparableLines} of ${inv.lineCount} lines comparable`}>
                  {inv.chartLabour == null ? '—' : fmtNum(inv.invoicedCompared)}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums border-l-2 border-white font-medium ${SIDE.chart.cell}`}>{inv.chartLabour == null ? '—' : fmtNum(inv.chartLabour)}</td>
                <td className={`px-4 py-2.5 text-right border-l-2 border-white ${SIDE.diff.cell}`}>{inv.chartLabour == null ? '—' : <Variance value={inv.invoicedCompared! - inv.chartLabour} />}</td>
                <td className={`px-4 py-2.5 text-right ${SIDE.diff.cell}`}>{inv.chartLabour == null ? '—' : <VariancePct pct={variancePct(inv.invoicedCompared!, inv.chartLabour)} />}</td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {fmtNum(inv.totalAmount)} <span className="text-xs text-slate-400">{inv.currency}</span>
                </td>
              </tr>
            ))}
          </tbody>
          {data && data.content.length > 0 && (
            <tfoot className={`bg-slate-50 border-t-2 border-slate-200 font-semibold ${totals.isFetching ? 'opacity-60' : ''}`}>
              <tr>
                <td colSpan={8} className="px-4 py-3">
                  Total of {data.totalElements.toLocaleString()} matching invoices
                  {totals.isLoading && <span className="ml-2 text-xs font-normal text-slate-500">calculating…</span>}
                  {totals.isError && <span className="ml-2 text-xs font-normal text-red-600">{(totals.error as Error).message}</span>}
                  {t && <span className="block text-xs font-normal text-slate-500">Chart compared on {t.comparableLines.toLocaleString()} of {t.lines.toLocaleString()} lines · {chartCurrency}</span>}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums border-l-2 border-white ${SIDE.invoice.head}`}>{t ? fmtNum(t.labour) : ''}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${SIDE.invoice.head}`}>{t ? fmtNum(t.invoicedCompared) : ''}</td>
                <td className={`px-4 py-3 text-right tabular-nums border-l-2 border-white ${SIDE.chart.head}`}>{t ? fmtNum(t.chartLabour) : ''}</td>
                <td className={`px-4 py-3 text-right border-l-2 border-white ${SIDE.diff.head}`}>{t && <Variance value={t.variance} />}</td>
                <td className={`px-4 py-3 text-right ${SIDE.diff.head}`}>{t && <VariancePct pct={variancePct(t.invoicedCompared, t.chartLabour)} />}</td>
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
