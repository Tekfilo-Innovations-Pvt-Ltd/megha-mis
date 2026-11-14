'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ArrowDownTrayIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import LineComparisonDetail, { StatusLabel, Variance, VariancePct, variancePct } from '@/components/labour/LineComparisonDetail';
import JobWorkTable from '@/components/labour/JobWorkTable';
import LotDetailTable from '@/components/labour/LotDetailTable';
import SkuTable from '@/components/labour/SkuTable';
import ChartAmount from '@/components/labour/ChartAmount';
import StoneCorrectionsBar from '@/components/labour/StoneCorrectionsBar';
import type { ChartCalc, LineCalcs } from '@/lib/chartCalc';
import type { LabourReport, LotReport, ReportSort, ReportStatusFilter } from '@/lib/labourReport';
import type { LineComparison } from '@/lib/labourComparison';
import { fmtDate, fmtNum } from '@/lib/format';
import { settingNotCountedRemark } from '@/lib/jobWorkBlocks';
import type { PriceChartSummary } from '@/lib/priceChartStore';

type ReportResponse = LabourReport & { chart: { code: string; name: string; currency: string } };
type LotResponse = LotReport & { chart: { code: string; name: string; currency: string } };
type TableView = 'lines' | 'lots' | 'jobwork' | 'skus';

// Lines per page — the API caps a page at 200.
const PAGE_SIZES = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;
const pagerButton = 'px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40 hover:bg-slate-50';

const SUMMARY_KEY = 'labour-vs-chart.summary';

// Job Work is the main view, so it comes first and opens by default.
const TABS = [['jobwork', 'Job Work'], ['lines', 'Lines'], ['lots', 'Lot detail'], ['skus', 'By SKU']] as const;

// Repair jobs aren't priced like new work, so the report starts on normal jobs.
const DEFAULT_JOB_CATEGORY = 'Normal';

const STATUS_FILTERS: { code: ReportStatusFilter; label: string }[] = [
  { code: 'ALL', label: 'All lines' },
  { code: 'OVER', label: 'Over chart' },
  { code: 'UNDER', label: 'Under chart' },
  { code: 'IN_LINE', label: 'In line' },
  { code: 'NOT_COMPARABLE', label: 'Not comparable' },
  { code: 'PARTIAL', label: 'Partly compared' },
  { code: 'DOUBLE_SETTING', label: 'Possible double setting' },
];

const REASON_TEXT: Record<string, string> = {
  NO_PRODUCT_TYPE: 'Product type not in the chart',
  OTHER_METAL: 'Metal not covered by the chart',
  NO_METAL: 'No metal weight',
  NO_WEIGHT_RANGE: 'Weight outside the chart',
  NO_QTY: 'No quantity',
  CURRENCY: 'Currency differs from the chart',
  NO_CHART_LABOUR: 'No invoiced labour the chart can price',
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Request failed');
  return res.json();
}

function Tile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{children}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows, currency }: { title: string; rows: LabourReport['summary']['byProductType']; currency: string }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 min-w-0">
      <header className="px-4 py-2.5 border-b border-slate-100">
        <h2 className="font-semibold text-slate-900 text-sm">{title}</h2>
        <p className="text-xs text-slate-500">Compared labour, {currency} — largest variance first</p>
      </header>
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead className="text-slate-500 bg-slate-50">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium" />
            <th className="px-2 py-1.5 text-right font-medium">Lines</th>
            <th className="px-2 py-1.5 text-right font-medium">Invoiced</th>
            <th className="px-2 py-1.5 text-right font-medium">Chart</th>
            <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">Diff Amount</th>
            <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Diff %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.slice(0, 8).map((b) => (
            <tr key={b.key}>
              <td className="px-3 py-1.5">{b.key}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{b.lines.toLocaleString()}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(b.invoiced)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(b.chart)}</td>
              <td className="px-2 py-1.5 text-right"><Variance value={b.variance} /></td>
              <td className="px-3 py-1.5 text-right"><VariancePct pct={variancePct(b.invoiced, b.chart)} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-3 text-slate-500">Nothing to compare.</td></tr>}
        </tbody>
      </table></div>
    </section>
  );
}

type LineResponse = { comparison: LineComparison; calcs: LineCalcs };
// chart: the code the report was worked out with, so the drill-down matches it.
const lineQuery = (invDetId: number, chart: string) => ({
  queryKey: ['labour-line', invDetId, chart],
  queryFn: () => getJson<LineResponse>(`/api/reports/labour-vs-chart/line/${invDetId}?${new URLSearchParams({ chart })}`),
});

function LineDrilldown({ invDetId, chart, currency }: { invDetId: number; chart: string; currency: string }) {
  const { data, isLoading, error } = useQuery(lineQuery(invDetId, chart));
  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error || !data) return <p className="text-sm text-red-600">{(error as Error)?.message ?? 'Could not load the line'}</p>;
  return <LineComparisonDetail comparison={data.comparison} currency={currency} calcs={data.calcs} />;
}

// A chart amount on a Lines row: its working is the line's, fetched on click
// (and shared with the drill-down).
function LineChartAmount({ invDetId, chart, value, pick, currency }: { invDetId: number; chart: string; value: number; pick: (c: LineCalcs) => ChartCalc | null; currency: string }) {
  const queryClient = useQueryClient();
  return <ChartAmount value={value} currency={currency} getCalc={() => queryClient.fetchQuery(lineQuery(invDetId, chart)).then((d) => pick(d.calcs))} />;
}

export default function LabourVsChartPage() {
  const companyId = useSession().data?.user?.companyId ?? null;

  // Filters — all optional except the job category, which starts on Normal.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [productType, setProductType] = useState('');
  const [factory, setFactory] = useState(''); // factory id, '' = all
  const [jobCategory, setJobCategory] = useState(DEFAULT_JOB_CATEGORY);
  const [skuInput, setSkuInput] = useState('');
  const [sku, setSku] = useState('');
  const [skuExact, setSkuExact] = useState(false); // set when a SKU is opened from the By SKU view
  const [invNoInput, setInvNoInput] = useState('');
  const [invNo, setInvNo] = useState('');
  const [jewNoInput, setJewNoInput] = useState('');
  const [jewNo, setJewNo] = useState('');
  const [bagNoInput, setBagNoInput] = useState('');
  const [bagNo, setBagNo] = useState('');
  const [chartCode, setChartCode] = useState(''); // '' = the company's default chart
  const [status, setStatus] = useState<ReportStatusFilter>('ALL');
  const [sort, setSort] = useState<ReportSort>('variance');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageInput, setPageInput] = useState('1');
  const [open, setOpen] = useState<number | null>(null);
  const [tableView, setTableView] = useState<TableView>('jobwork');
  // The summary is folded away by default so the details come first; the choice is remembered on this browser.
  const [showSummary, setShowSummary] = useState(false);
  useEffect(() => {
    try {
      setShowSummary(localStorage.getItem(SUMMARY_KEY) === 'open');
    } catch {}
  }, []);
  const toggleSummary = () => {
    const next = !showSummary;
    setShowSummary(next);
    try {
      localStorage.setItem(SUMMARY_KEY, next ? 'open' : 'closed');
    } catch {}
  };

  // Wait for typing to stop before querying the ERP.
  useEffect(() => {
    const t = setTimeout(() => setSku(skuInput.trim()), 400);
    return () => clearTimeout(t);
  }, [skuInput]);
  useEffect(() => {
    const t = setTimeout(() => setInvNo(invNoInput.trim()), 400);
    return () => clearTimeout(t);
  }, [invNoInput]);
  useEffect(() => {
    const t = setTimeout(() => setJewNo(jewNoInput.trim()), 400);
    return () => clearTimeout(t);
  }, [jewNoInput]);
  useEffect(() => {
    const t = setTimeout(() => setBagNo(bagNoInput.trim()), 400);
    return () => clearTimeout(t);
  }, [bagNoInput]);

  const filterParams = { ...(chartCode ? { chart: chartCode } : {}), from, to, productType, ...(factory ? { factory } : {}), jobCategory, sku, ...(skuExact && sku ? { skuExact: '1' } : {}), invNo, jewNo, bagNo, status, sort };
  const group = tableView === 'skus' ? 'sku' : 'line';
  const reportQuery = new URLSearchParams({ ...filterParams, group, page: String(page), size: String(pageSize) }).toString();
  const downloadUrl =
    tableView === 'skus'
      ? `/api/reports/labour-vs-chart?${new URLSearchParams({ ...filterParams, group, format: 'xlsx' })}`
      : `/api/reports/labour-vs-chart/lots?${new URLSearchParams({ ...filterParams, format: 'xlsx' })}`;
  // Per stone, so the line status filter and sort don't apply.
  const { status: _status, sort: _sort, ...stoneFilterParams } = filterParams;
  const settingNotInChartUrl = `/api/reports/labour-vs-chart/setting-not-in-chart?${new URLSearchParams(stoneFilterParams)}`;

  // A different company or filter starts again on page 1 with nothing expanded.
  useEffect(() => {
    setPage(0);
    setOpen(null);
  }, [companyId, chartCode, from, to, productType, factory, jobCategory, sku, skuExact, invNo, jewNo, bagNo, status, sort, pageSize, group]);
  useEffect(() => setPageInput(String(page + 1)), [page]);
  // Filters handed over in the address — the dashboard's drill-down links
  // (?from=&to=&jobCategory=&productType=&factory=&jewNo=&tab=). Read once;
  // a company switch afterwards starts from the defaults.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.toString()) return;
    setFrom(q.get('from') ?? '');
    setTo(q.get('to') ?? '');
    setProductType(q.get('productType') ?? '');
    setFactory(q.get('factory') ?? '');
    if (q.has('jobCategory')) setJobCategory(q.get('jobCategory') ?? '');
    if (q.get('chart')) setChartCode(q.get('chart')!);
    if (q.get('jewNo')) setJewNoInput(q.get('jewNo')!);
    if (q.get('invNo')) setInvNoInput(q.get('invNo')!);
    const st = q.get('status');
    if (st && STATUS_FILTERS.some((x) => x.code === st)) setStatus(st as ReportStatusFilter);
    const tab = q.get('tab');
    if (tab === 'lines' || tab === 'lots' || tab === 'jobwork' || tab === 'skus') setTableView(tab);
  }, []);
  const [seenCompany, setSeenCompany] = useState<number | null>(null);
  useEffect(() => {
    if (companyId == null) return;
    if (seenCompany != null && seenCompany !== companyId) {
      setProductType('');
      setFactory('');
      setJobCategory(DEFAULT_JOB_CATEGORY);
      setChartCode(''); // each company starts on its own default chart
    }
    setSeenCompany(companyId);
  }, [companyId, seenCompany]);
  // Charts to compare with — the company's default first.
  const charts = useQuery({
    queryKey: ['price-charts', companyId],
    queryFn: () => getJson<PriceChartSummary[]>('/api/price-charts'),
    enabled: companyId != null,
  });

  const report = useQuery({
    queryKey: ['labour-vs-chart', companyId, reportQuery],
    queryFn: () => getJson<ReportResponse>(`/api/reports/labour-vs-chart?${reportQuery}`),
    enabled: companyId != null,
    placeholderData: keepPreviousData,
  });
  const lots = useQuery({
    queryKey: ['labour-vs-chart-lots', companyId, reportQuery],
    queryFn: () => getJson<LotResponse>(`/api/reports/labour-vs-chart/lots?${reportQuery}`),
    enabled: companyId != null && (tableView === 'lots' || tableView === 'jobwork'), // Job Work lays out the same lot data
    placeholderData: keepPreviousData,
  });

  const data = report.data;

  // A company without normal jobs falls back to all job categories.
  useEffect(() => {
    if (data && jobCategory === DEFAULT_JOB_CATEGORY && !data.jobCategories.includes(DEFAULT_JOB_CATEGORY)) setJobCategory('');
  }, [data, jobCategory]);
  const s = data?.summary;
  const currency = data?.chart.currency ?? '';
  const totalPages = data ? Math.max(1, Math.ceil(data.totalRows / pageSize)) : 1;
  const goToPage = (p: number) => {
    setPage(Math.min(totalPages - 1, Math.max(0, p)));
    setOpen(null);
  };
  const submitPageInput = () => {
    const n = Number(pageInput);
    if (Number.isInteger(n) && n >= 1) goToPage(n - 1);
    else setPageInput(String(page + 1));
  };
  // From the By SKU view: that SKU's lines, matched exactly.
  const openSku = (skuNo: string) => {
    setSkuInput(skuNo);
    setSku(skuNo);
    setSkuExact(true);
    setTableView('lines');
  };
  const rowNoun = tableView === 'skus' ? 'SKUs' : 'lines';
  const hasFilters = !!(from || to || productType || factory || skuInput || invNoInput || jewNoInput || bagNoInput || jobCategory !== DEFAULT_JOB_CATEGORY);
  const clearFilters = () => {
    setFrom('');
    setTo('');
    setProductType('');
    setFactory('');
    setJobCategory(DEFAULT_JOB_CATEGORY);
    setSkuInput('');
    setSkuExact(false);
    setInvNoInput('');
    setJewNoInput('');
    setBagNoInput('');
  };

  const inputClass = 'px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500';

  return (
    // The lot detail and job work views are wide, so they get the full width of the screen.
    <div className={`space-y-4 ${tableView === 'lots' || tableView === 'jobwork' ? '' : 'max-w-7xl'}`}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Labour vs Chart</h1>
          {(charts.data?.length ?? 0) > 1 && (
            <label className="text-sm text-slate-600 flex items-center gap-2">
              Chart
              <select
                value={chartCode}
                onChange={(e) => setChartCode(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              >
                {charts.data!.map((c, i) => (
                  <option key={c.code} value={i === 0 ? '' : c.code}>
                    {c.name}{i === 0 ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="text-sm text-slate-500">
          Factory-invoice labour compared with the factory price chart — metal labour from the Metal Chart, stone setting from the Setting Chart.
        </p>
      </div>

      <StoneCorrectionsBar />

      {report.isError &&<p className="text-sm text-red-600">{(report.error as Error).message}</p>}
      {report.isLoading && <p className="text-sm text-slate-500">Comparing invoice lines with the chart…</p>}

      {/* Summary — folded by default; the same filters apply to it and to every tab */}
      {s && (
        <section className={`bg-white rounded-xl border border-slate-200 ${report.isFetching ? 'opacity-60' : ''}`}>
          <button onClick={toggleSummary} aria-expanded={showSummary} className="w-full px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-left hover:bg-slate-50 rounded-xl">
            <span className="flex items-center gap-1.5 font-semibold text-slate-900 text-sm">
              {showSummary ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
              Summary
            </span>
            <span className="text-xs text-slate-600 tabular-nums">
              {s.lines.toLocaleString()} lines · invoice labour {fmtNum(s.invoicedLabour)} · compared {fmtNum(s.invoiced)} vs chart {fmtNum(s.chart)} {currency}
            </span>
            <span className="text-xs"><Variance value={s.variance} /> (<VariancePct pct={s.variancePct} />)</span>
            <span className="ml-auto text-xs text-slate-500">{showSummary ? 'Hide' : 'Show'} details</span>
          </button>
          {showSummary && (
            <div className="px-4 pb-4 pt-3 space-y-4 border-t border-slate-100">

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <Tile label="Total invoice labour" sub={`All labour on ${s.lines.toLocaleString()} lines, compared or not`}>
                  {fmtNum(s.invoicedLabour)} <span className="text-sm font-normal text-slate-500">{currency}</span>
                </Tile>
                <Tile label="Invoiced labour (compared)" sub={`${s.comparable.toLocaleString()} of ${s.lines.toLocaleString()} lines comparable`}>
                  {fmtNum(s.invoiced)} <span className="text-sm font-normal text-slate-500">{currency}</span>
                </Tile>
                <Tile label="Chart labour" sub={`Chart: ${data.chart.name}`}>
                  {fmtNum(s.chart)} <span className="text-sm font-normal text-slate-500">{currency}</span>
                </Tile>
                <Tile label="Difference amount" sub="Invoiced − chart">
                  <Variance value={s.variance} />
                </Tile>
                <Tile label="Difference %" sub="Of chart labour">
                  <VariancePct pct={s.variancePct} />
                </Tile>
                <Tile label="Lines" sub={`${s.partial.toLocaleString()} partly compared · ${s.possibleDoubleSetting.toLocaleString()} possible double setting`}>
                  <span className="text-base font-normal block space-y-0.5">
                    <span className="block"><StatusLabel status="OVER" /> {s.over.toLocaleString()}</span>
                    <span className="block"><StatusLabel status="UNDER" /> {s.under.toLocaleString()}</span>
                    <span className="block"><StatusLabel status="IN_LINE" /> {s.inLine.toLocaleString()}</span>
                  </span>
                </Tile>
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                <section className="bg-white rounded-xl border border-slate-200">
                  <header className="px-4 py-2.5 border-b border-slate-100"><h2 className="font-semibold text-slate-900 text-sm">Metal vs setting</h2></header>
                  <table className="w-full text-xs">
                    <thead className="text-slate-500 bg-slate-50">
                      <tr><th className="px-4 py-1.5 text-left font-medium" /><th className="px-3 py-1.5 text-right font-medium">Invoiced</th><th className="px-3 py-1.5 text-right font-medium">Chart</th><th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Diff Amount</th><th className="px-4 py-1.5 text-right font-medium whitespace-nowrap">Diff %</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[
                        { k: 'Metal labour', v: s.metal },
                        { k: 'Setting labour', v: s.setting },
                        ...(s.combined.invoiced > 0 ? [{ k: 'Combined rows (e.g. CPF + Setting + Rhodium)', v: s.combined }] : []),
                      ].map(({ k, v }) => (
                        <tr key={k}>
                          <td className="px-4 py-1.5">{k}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(v.invoiced)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(v.chart)}</td>
                          <td className="px-3 py-1.5 text-right"><Variance value={v.invoiced - v.chart} /></td>
                          <td className="px-4 py-1.5 text-right"><VariancePct pct={variancePct(v.invoiced, v.chart)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.cad.rows > 0 && (
                    <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-600">
                      <div className="font-medium text-slate-700 mb-0.5">
                        CAD / model making: {s.cad.rows.toLocaleString()} rows, {fmtNum(s.cad.invoiced)} {currency}
                      </div>
                      Against the chart&apos;s model-making range (not in the totals): {s.cad.within.toLocaleString()} within,{' '}
                      <span className={s.cad.above ? 'text-red-700 font-medium' : ''}>{s.cad.above.toLocaleString()} above</span>, {s.cad.below.toLocaleString()} below
                    </div>
                  )}
                  {s.notComparableReasons.length > 0 && (
                    <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-600">
                      <div className="font-medium text-slate-700 mb-0.5">{s.notComparable.toLocaleString()} lines not comparable</div>
                      {s.notComparableReasons.map((r) => <div key={r.reason}>{REASON_TEXT[r.reason] ?? r.reason}: {r.lines.toLocaleString()}</div>)}
                    </div>
                  )}
                </section>
                <Breakdown title="By product type" rows={s.byProductType} currency={currency} />
                <Breakdown title="By factory" rows={s.byFactory} currency={currency} />
              </div>
            </div>
          )}
        </section>
      )}

      {/* Details: tabs, then the filters right under them, then the table */}
      <section className="bg-white rounded-xl border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 mr-2">
            {TABS.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTableView(v)}
                className={`px-3 py-1 rounded-md text-xs font-medium ${tableView === v ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            {hasFilters ? 'Filtered lines' : `${DEFAULT_JOB_CATEGORY} jobs`} of the selected company{data ? ` · chart: ${data.chart.name}` : ''} — filters apply to every tab and the summary
          </span>
          <a href={downloadUrl} className="ml-auto px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5" title={tableView === 'skus' ? 'Every matching SKU as an Excel file' : 'Job Work Details and lot detail of every matching line as an Excel file'}>
            <ArrowDownTrayIcon className="h-4 w-4" /> Excel
          </a>
          <a href={settingNotInChartUrl} className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5" title="Stones with no setting chart value, grouped by commodity, shape, setting type and ct range, as an Excel file (line status filter not applied)">
            <ArrowDownTrayIcon className="h-4 w-4" /> Setting not in chart
          </a>
        </div>

        {/* Filters — all optional */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-end gap-3">
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">From date</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">To date</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </label>
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Product type</span>
            <select value={productType} onChange={(e) => setProductType(e.target.value)} className={`${inputClass} max-w-[14rem]`}>
              <option value="">All product types</option>
              {data?.productTypes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Factory</span>
            <select value={factory} onChange={(e) => setFactory(e.target.value)} className={`${inputClass} max-w-[14rem]`}>
              <option value="">All factories</option>
              {data?.factories.map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Job category</span>
            <select value={jobCategory} onChange={(e) => setJobCategory(e.target.value)} className={`${inputClass} max-w-[12rem]`}>
              <option value="">All job categories</option>
              {data?.jobCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">SKU</span>
            <input value={skuInput} onChange={(e) => { setSkuInput(e.target.value); setSkuExact(false); }} placeholder="Any SKU" title={skuExact ? 'Exactly this SKU' : 'Any SKU containing this text'} className={`${inputClass} w-44`} />
          </label>
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Invoice No</span>
            <input value={invNoInput} onChange={(e) => setInvNoInput(e.target.value)} placeholder="Any invoice" title="Any invoice number containing this text" className={`${inputClass} w-40`} />
          </label>
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Jewellery No</span>
            <input value={jewNoInput} onChange={(e) => setJewNoInput(e.target.value)} placeholder="Any jewellery" title="Any jewellery number containing this text" className={`${inputClass} w-40`} />
          </label>
          <label className="text-sm"><span className="block text-xs text-slate-500 mb-1">Bag No</span>
            <input value={bagNoInput} onChange={(e) => setBagNoInput(e.target.value)} placeholder="Any bag" title="Any bag number containing this text, e.g. B803443" className={`${inputClass} w-32`} />
          </label>
          {hasFilters && (
            <button onClick={clearFilters} className="px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
              Clear filters
            </button>
          )}
        </div>

        {/* Line status and sort */}
        <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.code}
              onClick={() => setStatus(f.code)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${status === f.code ? 'bg-amber-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`}
            >
              {f.label}
            </button>
          ))}
          <label className="ml-auto text-sm flex items-center gap-2">
            <span className="text-xs text-slate-500">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as ReportSort)} className={inputClass}>
              <option value="variance">Largest variance</option>
              <option value="variancePct">Largest variance %</option>
              <option value="date">Newest invoice</option>
            </select>
          </label>
        </div>
        {data && (
          <>
            {tableView === 'skus' ? (
              <div className={`overflow-x-auto ${report.isFetching ? 'opacity-60' : ''}`}>
                {data.skus ? <SkuTable skus={data.skus} onOpenSku={openSku} /> : <p className="px-4 py-3 text-sm text-slate-500">Grouping by SKU…</p>}
              </div>
            ) : tableView === 'lots' ? (
              <div className={`overflow-x-auto ${lots.isFetching ? 'opacity-60' : ''}`}>
                {lots.isError && <p className="px-4 py-3 text-sm text-red-600">{(lots.error as Error).message}</p>}
                {lots.isLoading && <p className="px-4 py-3 text-sm text-slate-500">Loading lot detail…</p>}
                {lots.data && <LotDetailTable groups={lots.data.groups} />}
              </div>
            ) : tableView === 'jobwork' ? (
              <div className={`overflow-x-auto p-2 ${lots.isFetching ? 'opacity-60' : ''}`}>
                {lots.isError && <p className="px-4 py-3 text-sm text-red-600">{(lots.error as Error).message}</p>}
                {lots.isLoading && <p className="px-4 py-3 text-sm text-slate-500">Loading job work details…</p>}
                {lots.data && (
                  <>
                    <p className="mb-2 text-xs text-slate-500 flex items-center gap-1.5">
                      <span className="inline-block h-3 w-5 rounded-sm border border-slate-300 bg-amber-100" />
                      Chart or invoice amount missing — that jewellery&apos;s difference is not like for like; see Remarks.
                    </p>
                    <JobWorkTable groups={lots.data.groups} startIndex={page * pageSize} pageOnly={lots.data.totalLines > lots.data.groups.length} />
                  </>
                )}
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500 bg-slate-50">
                  <tr>
                    <th className="pl-4 pr-1 py-1.5 w-6" />
                    <th className="px-3 py-1.5 text-left font-medium">Invoice</th>
                    <th className="px-3 py-1.5 text-left font-medium">Jewellery</th>
                    <th className="px-3 py-1.5 text-left font-medium">Product type</th>
                    <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                    <th className="px-3 py-1.5 text-right font-medium">g/pc</th>
                    <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Metal inv / chart</th>
                    <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Setting inv / chart</th>
                    <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap" title="All labour on the line; below it, the part compared with the chart">Invoice labour</th>
                    <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Chart labour</th>
                    <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Diff Amount</th>
                    <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Diff %</th>
                    <th className="px-4 py-1.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const isOpen = open === r.invDetId;
                    return (
                      <Fragment key={r.invDetId}>
                        <tr onClick={() => setOpen(isOpen ? null : r.invDetId)} className="border-t border-slate-100 cursor-pointer hover:bg-amber-50/50">
                          <td className="pl-4 pr-1 py-2 text-slate-400">{isOpen ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Link href={`/dashboard/factory-invoices/${r.invId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-amber-700 hover:underline">{r.invNo}</Link>
                            <span className="block text-xs text-slate-500">{fmtDate(r.invDt)} · {r.factoryName}</span>
                          </td>
                          <td className="px-3 py-2">{r.jewNo}{r.bagNo && <span className="block text-xs text-slate-500">Bag {r.bagNo}</span>}{r.skuNo &&<span className="block text-xs text-slate-500">{r.skuNo}</span>}</td>
                          <td className="px-3 py-2">{r.productType ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.qty, 0)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.gramsPerPiece != null ? fmtNum(r.gramsPerPiece, 3) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {r.metalChart > 0 ? <>{fmtNum(r.metalInvoiced)} / <LineChartAmount invDetId={r.invDetId} chart={data.chart.code} value={r.metalChart} pick={(c) => c.metal} currency={currency} /></> : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {r.settingChart > 0 ? <>{fmtNum(r.settingInvoiced)} / <LineChartAmount invDetId={r.invDetId} chart={data.chart.code} value={r.settingChart} pick={(c) => c.setting} currency={currency} /></> : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {fmtNum(r.invoicedLabour)}
                            {r.status !== 'NOT_COMPARABLE' && r.invoicedCompared !== r.invoicedLabour && <span className="block text-xs text-slate-500">{fmtNum(r.invoicedCompared)} compared</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.status === 'NOT_COMPARABLE' ? '—' : <LineChartAmount invDetId={r.invDetId} chart={data.chart.code} value={r.chartTotal} pick={(c) => c.total} currency={currency} />}
                          </td>
                          <td className="px-3 py-2 text-right">{r.status === 'NOT_COMPARABLE' ? '—' : <Variance value={r.variance} />}</td>
                          <td className="px-3 py-2 text-right">{r.status === 'NOT_COMPARABLE' ? '—' : <VariancePct pct={r.variancePct} />}</td>
                          <td className="px-4 py-2">
                            <StatusLabel status={r.status} />
                            {r.status === 'NOT_COMPARABLE' && r.issue && <span className="block text-xs text-slate-500">{REASON_TEXT[r.issue] ?? r.issue}</span>}
                            {r.partial && r.status !== 'NOT_COMPARABLE' && <span className="block text-xs text-amber-800">Partly compared</span>}
                            {r.possibleDoubleSetting && <span className="block text-xs text-red-700">Possible double setting</span>}
                            {r.componentSettingNotCounted !== 0 && (
                              <span className="block text-xs text-amber-800" title={settingNotCountedRemark(r.componentSettingNotCounted)}>
                                Component setting {fmtNum(r.componentSettingNotCounted)} not counted
                              </span>
                            )}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-50/70">
                            <td />
                            <td colSpan={12} className="px-3 py-3"><LineDrilldown invDetId={r.invDetId} chart={data.chart.code} currency={currency} /></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {data.rows.length === 0 && <tr><td colSpan={13} className="px-4 py-6 text-center text-slate-500">No lines match.</td></tr>}
                </tbody>
              </table>
            </div>
            )}
            <div className="px-4 py-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <span>
                {data.totalRows === 0
                  ? `No ${rowNoun}`
                  : `Showing ${(page * pageSize + 1).toLocaleString()}–${Math.min((page + 1) * pageSize, data.totalRows).toLocaleString()} of ${data.totalRows.toLocaleString()} ${rowNoun}`}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Per page</span>
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className={inputClass}>
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button onClick={() => goToPage(0)} disabled={page === 0} className={pagerButton}>First</button>
                <button onClick={() => goToPage(page - 1)} disabled={page === 0} className={pagerButton}>Previous</button>
                <span className="flex items-center gap-1">
                  Page
                  <input
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
                    onBlur={submitPageInput}
                    onKeyDown={(e) => e.key === 'Enter' && submitPageInput()}
                    inputMode="numeric"
                    aria-label="Page number"
                    className="w-14 px-2 py-1 border border-slate-300 rounded-lg text-center tabular-nums"
                  />
                  of {totalPages.toLocaleString()}
                </span>
                <button onClick={() => goToPage(page + 1)} disabled={page + 1 >= totalPages} className={pagerButton}>Next</button>
                <button onClick={() => goToPage(totalPages - 1)} disabled={page + 1 >= totalPages} className={pagerButton}>Last</button>
              </div>
            </div>
          </>
        )}
      </section>

      {s && (
          <p className="text-xs text-slate-500 leading-relaxed">
            How it is compared: invoice labour rows are line totals, so chart amounts are rate × line quantity (metal) or rate × stone pieces (setting).
            Metal: net metal weight ÷ quantity picks the product type’s weight range; Basic uses the “under 5 pcs” price below 5 pieces, else “5 pcs up”.
            Only labour the factory actually invoiced is compared, against the newest price chart. Stones without a setting type in the ERP
            are priced as Prong/Pave; a line within ±5% of the chart counts as in line.
            Labour with no chart rate (plating, CAD, alloy, findings…) is listed on each line but not compared.
            Lot detail: setting is priced per stone lot from commodity, consumed weight ÷ consumed pieces and setting type (the ERP’s, else the one
            named on the invoice’s Setting labour row). Setting labour the invoice charges for the whole line is shown on a “Setting (line)” row
            against the chart amount of those stones; rates there are averages per stone. Net weight is the consumed metal weight.
          </p>
      )}
    </div>
  );
}
