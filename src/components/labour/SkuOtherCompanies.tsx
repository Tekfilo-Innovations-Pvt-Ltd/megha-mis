'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { fmtDate, fmtNum } from '@/lib/format';
import { labourTypeOf } from '@/lib/labourTypes';
import type { SkuCompany } from '@/lib/skuOtherCompanies';

// In the chart labour pop-up / SKU hint: the same SKU in the user's other
// companies (e.g. an AAA line's SKU at RTPHK, "-A" clones included) — labour
// per piece beside this line's, by labour type, and each invoice line with
// its labour breakup.

export interface SkuContext {
  skuNo: string;
  chartCode: string;
  qty: number;
  invoicedLabour: number; // this line's whole invoice labour
  chart: number | null; // this line's chart labour (compared part)
  gramsPerPiece: number | null;
  breakup?: { process: string; amount: number }[]; // this line's labour breakup, when known
}

type Response = { companies: SkuCompany[] };

const per = (v: number | null | undefined, qty: number) => (v == null || qty <= 0 ? null : v / qty);
const n = (v: number | null | undefined, digits = 2) => (v == null ? '—' : fmtNum(v, digits));
const pct = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : ((a - b) / b) * 100);
const pctText = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmtNum(v, 1)}%`);
const pctClass = (v: number | null) => (v == null ? 'text-slate-400' : v > 0 ? 'text-red-700' : v < 0 ? 'text-sky-700' : '');

export default function SkuOtherCompanies({ context, currency }: { context: SkuContext; currency?: string }) {
  const q = useQuery({
    queryKey: ['sku-other-companies', context.skuNo, context.chartCode],
    queryFn: async () => {
      const res = await fetch(`/api/reports/labour-vs-chart/sku-other-companies?${new URLSearchParams({ sku: context.skuNo, chart: context.chartCode })}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Request failed');
      return (await res.json()) as Response;
    },
    staleTime: 5 * 60 * 1000,
  });
  const ownPerPc = per(context.invoicedLabour, context.qty);

  // This line's labour per piece by labour type.
  const ownByType = new Map<string, number>();
  for (const x of context.breakup ?? []) ownByType.set(labourTypeOf(x.process), (ownByType.get(labourTypeOf(x.process)) ?? 0) + x.amount);

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <h3 className="font-medium text-slate-900">Same SKU in your other companies — {context.skuNo.replace(/-A$/i, '')} (incl. its -A clone)</h3>
      <p className="text-xs text-slate-600 mb-2">
        This line: invoice labour <b className="tabular-nums">{n(ownPerPc)}</b>/pc · chart <b className="tabular-nums">{n(per(context.chart, context.qty))}</b>/pc
        {context.gramsPerPiece != null && <> · {fmtNum(context.gramsPerPiece, 3)} g/pc</>} {currency}
      </p>
      {q.isLoading && <p className="text-xs text-slate-500">Looking up the SKU…</p>}
      {q.isError && <p className="text-xs text-red-600">{(q.error as Error).message}</p>}
      {q.data && q.data.companies.length === 0 && <p className="text-xs text-slate-500">This SKU isn&apos;t invoiced in any other company you can open.</p>}
      {q.data?.companies.map((co) => (
        <div key={co.companyId} className="mt-3">
          <div className="text-xs font-semibold text-slate-800">
            {co.company} — {co.totalLines.toLocaleString()} line{co.totalLines === 1 ? '' : 's'}
            {co.averages.map((a) => (
              <span key={a.currency} className="ml-2 font-normal text-slate-600">
                average <b className="tabular-nums">{fmtNum(a.labourPerPc)}</b>/pc {a.currency} (setting {fmtNum(a.settingPerPc)}, other {fmtNum(a.otherPerPc)}) over {fmtNum(a.qty, 0)} pcs
                {ownPerPc != null && a.labourPerPc > 0 && a.currency === currency && (
                  <span className={pctClass(pct(ownPerPc, a.labourPerPc))}> · this line {pctText(pct(ownPerPc, a.labourPerPc))}</span>
                )}
              </span>
            ))}
          </div>

          {co.byType && co.byType.types.length > 0 && <ByType co={co} own={ownByType} qty={context.qty} hasOwn={!!context.breakup} currency={currency} />}

          <Lines co={co} />
        </div>
      ))}
    </section>
  );
}

// Labour per piece by labour type: this line beside the other company's average.
function ByType({ co, own, qty, hasOwn, currency }: { co: SkuCompany; own: Map<string, number>; qty: number; hasOwn: boolean; currency?: string }) {
  const types = co.byType!;
  const sameCurrency = !currency || types.currency === currency;
  const names = Array.from(new Set([...types.types.map((t) => t.labourType), ...(hasOwn ? Array.from(own.keys()) : [])]));
  const th = 'px-2 py-1 font-medium whitespace-nowrap';
  const td = 'px-2 py-1 tabular-nums whitespace-nowrap text-right';
  return (
    <div className="overflow-x-auto mt-1.5">
      <table className="text-xs bg-white rounded border border-slate-200">
        <thead className="bg-slate-50 text-slate-500 text-left">
          <tr>
            <th className={th}>Labour type (per piece)</th>
            {hasOwn && <th className={`${th} text-right bg-indigo-100`}>This line {currency}</th>}
            <th className={`${th} text-right bg-indigo-100`}>{co.company.replace(/\s*\(.*\)$/, '')} avg {types.currency}</th>
            {hasOwn && sameCurrency && <th className={`${th} text-right bg-rose-100`}>Diff %</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {names.map((name) => {
            const mine = hasOwn ? per(own.get(name) ?? 0, qty) : null;
            const theirs = types.types.find((t) => t.labourType === name)?.perPc ?? 0;
            const d = pct(mine, theirs);
            return (
              <tr key={name}>
                <td className="px-2 py-1">{name}</td>
                {hasOwn && <td className={td}>{n(mine)}</td>}
                <td className={td}>{n(theirs)}</td>
                {hasOwn && sameCurrency && <td className={`${td} ${pctClass(d)}`}>{pctText(d)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// The other company's invoice lines, newest first; a line opens its labour breakup.
function Lines({ co }: { co: SkuCompany }) {
  const [open, setOpen] = useState<string | null>(null);
  const th = 'px-2 py-1 font-medium whitespace-nowrap';
  const td = 'px-2 py-1 tabular-nums whitespace-nowrap';
  return (
    <div className="overflow-x-auto mt-1.5">
      <table className="min-w-full text-xs bg-white rounded border border-slate-200">
        <thead className="bg-slate-50 text-slate-500 text-left">
          <tr>
            <th className={th} />
            <th className={th}>Invoice</th><th className={th}>Date</th><th className={th}>Factory</th><th className={th}>Jewellery</th>
            <th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>g/pc</th>
            <th className={`${th} text-right bg-indigo-100`}>Labour/pc</th><th className={`${th} text-right bg-indigo-100`}>Setting/pc</th><th className={`${th} text-right bg-indigo-100`}>Other/pc</th>
            <th className={`${th} text-right bg-emerald-100`}>Chart/pc</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {co.lines.map((l) => {
            const key = `${l.invId}-${l.jewNo}`;
            const isOpen = open === key;
            return (
              <Fragment key={key}>
                <tr onClick={() => setOpen(isOpen ? null : key)} className="cursor-pointer hover:bg-amber-50/60" title="Show this invoice line's labour breakup">
                  <td className="pl-2 py-1 text-slate-400">{isOpen ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}</td>
                  <td className={`${td} font-medium text-slate-900`}>{l.invNo}</td>
                  <td className={td}>{fmtDate(l.invDt)}</td>
                  <td className="px-2 py-1">{l.factory}</td>
                  <td className={td}>
                    {l.jewNo}
                    {l.skuNo && <span className="text-slate-500"> · {l.skuNo}</span>}
                    {l.jobCategory && l.jobCategory !== 'Normal' && <span className="text-amber-700"> ({l.jobCategory})</span>}
                  </td>
                  <td className={`${td} text-right`}>{fmtNum(l.qty, 0)}</td>
                  <td className={`${td} text-right`}>{n(l.gramsPerPiece, 3)}</td>
                  <td className={`${td} text-right font-medium`}>{n(l.labourPerPc)} <span className="text-slate-400">{l.currency}</span></td>
                  <td className={`${td} text-right`}>{n(l.settingPerPc)}</td>
                  <td className={`${td} text-right`}>{n(l.otherPerPc)}</td>
                  <td className={`${td} text-right`}>{n(l.chartPerPc)}</td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50">
                    <td />
                    <td colSpan={10} className="px-2 py-2">
                      {l.breakup.length === 0 ? (
                        <p className="text-slate-500">No labour on this line.</p>
                      ) : (
                        <table className="text-xs bg-white border border-slate-200 rounded">
                          <thead className="text-slate-500 text-left">
                            <tr>
                              <th className={th}>Process</th>
                              <th className={th}>Labour type</th>
                              <th className={`${th} text-right`}>Qty</th>
                              <th className={`${th} bg-slate-100`}>Input</th>
                              <th className={`${th} text-right bg-indigo-100`}>Rate {l.currency}</th>
                              <th className={`${th} text-right bg-indigo-100`}>Amount {l.currency}</th>
                              <th className={`${th} text-right bg-indigo-100`}>Per pc</th>
                              <th className={`${th} text-right bg-emerald-100`}>Chart amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {l.breakup.map((x, i) => (
                              <tr key={i}>
                                <td className="px-2 py-1 whitespace-nowrap">{x.process}</td>
                                <td className="px-2 py-1 whitespace-nowrap text-slate-500">{x.labourType}</td>
                                <td className={`${td} text-right`}>{n(x.qty, 2)}</td>
                                <td className={`${td} bg-slate-50`}>
                                  {x.inputCurrency && x.inputAmount ? <>{x.inputCurrency} {x.inputRate ? `${fmtNum(x.inputRate, 4)} → ` : ''}{fmtNum(x.inputAmount)}</> : '—'}
                                </td>
                                <td className={`${td} text-right bg-indigo-50`}>{n(x.rate, 4)}</td>
                                <td className={`${td} text-right bg-indigo-50 font-medium`}>{n(x.amount)}</td>
                                <td className={`${td} text-right bg-indigo-50`}>{n(x.perPc)}</td>
                                <td className={`${td} text-right bg-emerald-50`}>{n(x.chartAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {co.totalLines > co.lines.length && <p className="text-[11px] text-slate-500 mt-0.5">Newest {co.lines.length} of {co.totalLines} lines shown; the averages cover all.</p>}
    </div>
  );
}
