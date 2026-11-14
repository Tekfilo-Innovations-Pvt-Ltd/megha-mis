'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LabourDashboard } from '@/lib/labourDashboard';
import { fmtDate, fmtNum } from '@/lib/format';

// Factory Invoice & Labour vs Chart dashboard (BRD 2026-11-14). Every figure is
// the Labour vs Chart report's for the same filters; every section links into
// that report (or the invoice) with the filters carried over.

type Response = LabourDashboard & { chart: { code: string; name: string; currency: string } };
type Row = { invoiced: number; chart: number; difference: number; differencePct: number | null };

// Two series, from the validated reference palette (dataviz): invoiced vs chart.
const INVOICED = '#eb6834';
const CHART = '#2a78d6';
const DEFAULT_JOB_CATEGORY = 'Normal';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Request failed');
  return res.json();
}

// Last 12 months: the first of the month a year ago → today.
function defaultFrom() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

const signed = (v: number | null, digits = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmtNum(v, digits)}%`);
const diffClass = (v: number | null) => (v == null ? 'text-slate-400' : v > 0 ? 'text-red-700' : v < 0 ? 'text-sky-700' : 'text-slate-700');

function Tile({ label, children, sub, href }: { label: string; children: React.ReactNode; sub?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{children}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </>
  );
  const cls = 'block bg-white rounded-xl border border-slate-200 px-4 py-3';
  return href ? <Link href={href} className={`${cls} hover:border-amber-400`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Section({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 min-w-0">
      <header className="px-4 py-2.5 border-b border-slate-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900 text-sm">{title}</h2>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// Difference % per item as a bar from zero (right = over chart, left = under),
// with invoiced vs chart beside it. One hue: the sign and the number carry the meaning.
function DiffBars<T extends Row>({ rows, label, href, currency }: { rows: T[]; label: (r: T) => string; href: (r: T) => string; currency: string }) {
  const max = Math.max(10, ...rows.map((r) => Math.abs(r.differencePct ?? 0)));
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing compared for these filters.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-slate-500">
        <tr>
          <th className="text-left font-medium pb-1.5" />
          <th className="text-left font-medium pb-1.5 w-[38%]">Difference % (left = under, right = over chart)</th>
          <th className="text-right font-medium pb-1.5">Invoiced</th>
          <th className="text-right font-medium pb-1.5">Chart</th>
          <th className="text-right font-medium pb-1.5">Difference</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => {
          const v = r.differencePct ?? 0;
          const w = (Math.abs(v) / max) * 50;
          return (
            <tr key={label(r)} className="hover:bg-slate-50">
              <td className="py-1.5 pr-3">
                <Link href={href(r)} className="text-amber-700 hover:underline">{label(r)}</Link>
              </td>
              <td className="py-1.5 pr-3">
                <div className="relative h-5" title={`${label(r)}: ${signed(r.differencePct)} (${fmtNum(r.invoiced)} vs ${fmtNum(r.chart)} ${currency})`}>
                  <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
                  <div
                    className="absolute top-0.5 bottom-0.5 rounded-sm"
                    style={{ background: CHART, width: `${Math.max(w, 0.5)}%`, left: v >= 0 ? '50%' : `${50 - w}%` }}
                  />
                  <span className={`absolute top-0 text-xs font-medium tabular-nums ${diffClass(r.differencePct)}`} style={v >= 0 ? { left: `calc(${50 + w}% + 4px)` } : { right: `calc(${50 + w}% + 4px)` }}>
                    {signed(r.differencePct)}
                  </span>
                </div>
              </td>
              <td className="py-1.5 text-right tabular-nums">{fmtNum(r.invoiced, 0)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtNum(r.chart, 0)}</td>
              <td className={`py-1.5 text-right tabular-nums ${diffClass(r.difference)}`}>{fmtNum(r.difference, 0)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const Amounts = ({ list }: { list: { currency: string; amount: number }[] }) =>
  list.length === 0 ? <>—</> : <>{list.map((a) => <span key={a.currency} className="block">{fmtNum(a.amount, 0)} <span className="text-sm font-normal text-slate-500">{a.currency}</span></span>)}</>;

export default function DashboardPage() {
  const companyId = useSession().data?.user?.companyId ?? null;
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState('');
  const [factory, setFactory] = useState('');
  const [productType, setProductType] = useState('');
  const [jobCategory, setJobCategory] = useState(DEFAULT_JOB_CATEGORY);

  const filters = useMemo(
    () => Object.fromEntries(Object.entries({ from, to, factory, productType, jobCategory }).filter(([, v]) => v !== '')),
    [from, to, factory, productType, jobCategory],
  );
  const query = new URLSearchParams(filters).toString();
  const q = useQuery({
    queryKey: ['dashboard-labour', companyId, query],
    queryFn: () => getJson<Response>(`/api/dashboard/labour?${query}`),
    enabled: companyId != null,
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const cur = d?.chart.currency ?? '';

  // A link into the Labour vs Chart report with these filters (+ more).
  const report = (extra: Record<string, string> = {}) => {
    // jobCategory '' = all categories (the report would otherwise start on Normal).
    const p = new URLSearchParams({ jobCategory: '', ...filters, ...extra });
    return `/dashboard/reports/labour-vs-chart?${p}`;
  };
  const reset = () => {
    setFrom(defaultFrom());
    setTo('');
    setFactory('');
    setProductType('');
    setJobCategory(DEFAULT_JOB_CATEGORY);
  };
  const inputClass = 'px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500';

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Factory invoices and invoice labour vs {d ? d.chart.name : 'the price chart'} — figures match the Labour vs Chart report for the same filters.
          </p>
        </div>
        <button onClick={() => q.refetch()} className="text-xs text-slate-500 hover:text-amber-700">
          {q.isFetching ? 'Updating…' : `As of ${q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString() : '—'} · refresh`}
        </button>
      </div>

      {/* Filters — apply to every section */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">From date</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">To date</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </label>
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Factory</span>
          <select value={factory} onChange={(e) => setFactory(e.target.value)} className={`${inputClass} max-w-[14rem]`}>
            <option value="">All factories</option>
            {d?.filterOptions.factories.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Product type</span>
          <select value={productType} onChange={(e) => setProductType(e.target.value)} className={`${inputClass} max-w-[14rem]`}>
            <option value="">All product types</option>
            {d?.filterOptions.productTypes.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Job category</span>
          <select value={jobCategory} onChange={(e) => setJobCategory(e.target.value)} className={`${inputClass} max-w-[12rem]`}>
            <option value="">All job categories</option>
            {d?.filterOptions.jobCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button onClick={reset} className="text-sm text-slate-500 hover:text-amber-700 pb-1.5">Reset</button>
      </div>

      {q.isError && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}
      {q.isLoading && <p className="text-sm text-slate-500">Comparing invoice lines with the chart…</p>}

      {d && (
        <div className={`space-y-4 ${q.isFetching ? 'opacity-60' : ''}`}>
          {/* 1. Headline */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile label="Total invoice labour" sub={`${d.status.lines.toLocaleString()} lines`} href={report()}>{fmtNum(d.headline.totalLabour, 0)} <span className="text-sm font-normal text-slate-500">{cur}</span></Tile>
            <Tile label="Compared labour" sub={`Coverage ${d.headline.coveragePct ?? '—'}% of all labour`} href={report()}>{fmtNum(d.headline.invoiced, 0)}</Tile>
            <Tile label="Chart labour" sub="For the compared labour" href={report()}>{fmtNum(d.headline.chart, 0)}</Tile>
            <Tile label="Difference" sub={<span className={diffClass(d.headline.differencePct)}>{signed(d.headline.differencePct)} of chart</span>} href={report()}>
              <span className={diffClass(d.headline.difference)}>{fmtNum(d.headline.difference, 0)}</span>
            </Tile>
            <Tile label="Lines over chart" sub={`${d.status.under.toLocaleString()} under · ${d.status.inLine.toLocaleString()} within ±5% · ${d.status.notComparable.toLocaleString()} not comparable`} href={report({ status: 'OVER', tab: 'lines' })}>
              {d.status.over.toLocaleString()} <span className="text-sm font-normal text-slate-500">of {d.status.comparable.toLocaleString()}</span>
            </Tile>
          </div>

          {/* 2. Factory invoices */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Factory invoices" sub={`${d.factoryInvoices.thisMonth} this month · whole invoices in the period`} href="/dashboard/factory-invoices">{d.factoryInvoices.count.toLocaleString()}</Tile>
            <Tile label="Invoiced amount"><Amounts list={d.factoryInvoices.amount} /></Tile>
            <Tile label="Paid"><Amounts list={d.factoryInvoices.paid} /></Tile>
            <Tile label="Outstanding" sub={`${d.factoryInvoices.openCount.toLocaleString()} unpaid or part-paid invoices`}><Amounts list={d.factoryInvoices.outstanding} /></Tile>
          </div>

          {/* 3. By factory */}
          <Section title="Difference by factory" sub={`Compared labour vs chart, ${cur} · the chart's own factory (Wilson) should sit near 0%`}>
            <DiffBars rows={d.byFactory} label={(r) => r.name} href={(r) => report({ factory: String(r.factoryId) })} currency={cur} />
          </Section>

          {/* 6. Trend */}
          <Section title="Trend by month" sub={`Compared labour and chart labour per invoice month, ${cur}`}>
            {d.byMonth.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing compared for these filters.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.byMonth} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => fmtNum(v, 0)} />
                    <Tooltip formatter={(v) => `${fmtNum(Number(v), 0)} ${cur}`} labelFormatter={(m) => `Invoice month ${m}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="invoiced" name="Invoiced (compared)" stroke={INVOICED} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="chart" name="Chart" stroke={CHART} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* 4. Labour type */}
            <Section title="Difference by labour type" sub={`What the factories charge more or less for, ${cur}`}>
              <DiffBars rows={d.byLabourType} label={(r) => r.labourType} href={() => report({ tab: 'jobwork' })} currency={cur} />
            </Section>
            {/* 5. Product type */}
            <Section title="Difference by product type" sub={`Compared labour vs chart, ${cur}`}>
              <DiffBars rows={d.byProductType} label={(r) => r.productType} href={(r) => report({ productType: r.productType })} currency={cur} />
            </Section>
          </div>

          {/* 7. Top over-charged */}
          <Section title="Top over-charged jewellery" sub={`The 10 lines furthest above the chart, ${cur}`} action={<Link href={report({ status: 'OVER', tab: 'lines' })} className="text-xs text-amber-700 hover:underline">All lines over chart →</Link>}>
            {d.topLines.length === 0 ? (
              <p className="text-sm text-slate-500">No line is over the chart.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 text-left">
                    <tr>
                      {['Invoice', 'Date', 'Jewellery', 'Bag', 'SKU', 'Factory'].map((h) => <th key={h} className="font-medium pb-1.5 pr-3">{h}</th>)}
                      {['Invoiced', 'Chart', 'Difference', 'Diff %'].map((h) => <th key={h} className="font-medium pb-1.5 pl-3 text-right">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.topLines.map((r) => (
                      <tr key={r.invDetId} className="hover:bg-slate-50">
                        <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={`/dashboard/factory-invoices/${r.invId}`} className="text-amber-700 hover:underline">{r.invNo}</Link></td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(r.invDt)}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={report({ jewNo: r.jewNo, tab: 'jobwork' })} className="text-amber-700 hover:underline">{r.jewNo}</Link></td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{r.bagNo ?? '—'}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{r.skuNo ?? '—'}</td>
                        <td className="py-1.5 pr-3">{r.factory}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">{fmtNum(r.invoiced)}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums">{fmtNum(r.chart)}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums text-red-700">{fmtNum(r.difference)}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums text-red-700">{signed(r.differencePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <div className="grid lg:grid-cols-3 gap-4">
            {/* 8. Outstanding over chart */}
            <div className="lg:col-span-2">
              <Section title="Unpaid invoices over chart" sub="Unpaid or part-paid invoices, largest chart difference first — check before releasing payment">
                {d.outstandingOverChart.length === 0 ? (
                  <p className="text-sm text-slate-500">No unpaid invoice is over the chart.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500 text-left">
                      <tr>
                        {['Invoice', 'Date', 'Factory', 'Status'].map((h) => <th key={h} className="font-medium pb-1.5 pr-3">{h}</th>)}
                        {['Outstanding', 'Compared', 'Chart', 'Difference'].map((h) => <th key={h} className="font-medium pb-1.5 pl-3 text-right">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {d.outstandingOverChart.map((r) => (
                        <tr key={r.invId} className="hover:bg-slate-50">
                          <td className="py-1.5 pr-3 whitespace-nowrap"><Link href={`/dashboard/factory-invoices/${r.invId}`} className="text-amber-700 hover:underline">{r.invNo}</Link></td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(r.invDt)}</td>
                          <td className="py-1.5 pr-3">{r.factory}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{r.paymentStatus === 'PARTPAID' ? 'Part paid' : 'Unpaid'}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums">{fmtNum(r.outstanding)} <span className="text-xs text-slate-500">{r.currency}</span></td>
                          <td className="py-1.5 pl-3 text-right tabular-nums">{fmtNum(r.comparedInvoiced)}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums">{fmtNum(r.chart)}</td>
                          <td className="py-1.5 pl-3 text-right tabular-nums text-red-700">{fmtNum(r.difference)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>
            </div>
            {/* 9. CAD */}
            <Section title="CAD vs model making" sub="Against the chart's model-making range per style — not in the totals">
              {d.cad.rows === 0 ? (
                <p className="text-sm text-slate-500">No CAD charged in this period.</p>
              ) : (
                <dl className="text-sm space-y-1.5">
                  <div className="flex justify-between"><dt>CAD rows</dt><dd className="tabular-nums">{d.cad.rows.toLocaleString()} · {fmtNum(d.cad.invoiced, 0)} {cur}</dd></div>
                  <div className="flex justify-between"><dt>Above range</dt><dd className="tabular-nums font-medium text-red-700">{d.cad.above.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt>Within range</dt><dd className="tabular-nums">{d.cad.within.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt>Below range</dt><dd className="tabular-nums">{d.cad.below.toLocaleString()}</dd></div>
                  <div className="pt-1"><Link href={report({ tab: 'jobwork' })} className="text-xs text-amber-700 hover:underline">See CAD rows in Job Work →</Link></div>
                </dl>
              )}
            </Section>
          </div>

          {/* 10. Data quality */}
          <Section title="Data quality — what isn't compared" sub={`${fmtNum(d.dataQuality.uncompared, 0)} ${cur} of invoice labour has no chart counterpart for these filters`}>
            <div className="grid md:grid-cols-3 gap-6 text-sm">
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Labour with no chart row</h3>
                {d.dataQuality.notInChart.length === 0 ? <p className="text-slate-500">None</p> : (
                  <ul className="space-y-1">{d.dataQuality.notInChart.map((x) => <li key={x.process} className="flex justify-between gap-3"><span>{x.process}</span><span className="tabular-nums">{fmtNum(x.amount, 0)}</span></li>)}</ul>
                )}
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Metal labour the chart can&apos;t price</h3>
                {d.dataQuality.metalNotPriced.length === 0 ? <p className="text-slate-500">None</p> : (
                  <ul className="space-y-1">{d.dataQuality.metalNotPriced.map((x) => <li key={x.reason} className="flex justify-between gap-3"><span>{x.reason} <span className="text-slate-500">({x.lines.toLocaleString()} lines)</span></span><span className="tabular-nums">{fmtNum(x.invoiced, 0)}</span></li>)}</ul>
                )}
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Stones the chart can&apos;t price</h3>
                {d.dataQuality.stoneIssues.length === 0 ? <p className="text-slate-500">None</p> : (
                  <ul className="space-y-1">{d.dataQuality.stoneIssues.map((x) => <li key={x.reason} className="flex justify-between gap-3"><span>{x.reason}</span><span className="tabular-nums">{x.lots.toLocaleString()} lots</span></li>)}</ul>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  Customer stone corrections:{' '}
                  {d.dataQuality.stoneCorrections ? `${d.dataQuality.stoneCorrections.fileName} (${fmtDate(d.dataQuality.stoneCorrections.uploadedAt)})` : <span className="text-amber-700">none uploaded for this company</span>}
                  {' · '}<Link href="/dashboard/reports/labour-vs-chart" className="text-amber-700 hover:underline">upload in Labour vs Chart</Link>
                </p>
              </div>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
