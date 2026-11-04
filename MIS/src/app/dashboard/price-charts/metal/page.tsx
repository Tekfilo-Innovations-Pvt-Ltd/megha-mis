'use client';

import { useMemo, useState } from 'react';
import ChartHeader, { useSelectedChart } from '@/components/priceChart/ChartHeader';
import { useMasters } from '@/components/priceChart/useMasters';
import { findRange, metalRateIndex, type PriceChart } from '@/lib/priceChart';
import type { PriceChartSummary } from '@/lib/priceChartStore';
import { fmtNum } from '@/lib/format';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200">
      <header className="px-4 py-2.5 border-b border-slate-100">
        <h2 className="font-semibold text-slate-900 text-sm">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const wt = (v: number | null) => (v == null ? 'and above' : fmtNum(v, v % 1 === 0 ? 0 : 2));

export default function MetalChartPage() {
  const { chart, charts, select, isLoading, isEmpty, isError } = useSelectedChart();
  if (isLoading) return <p className="text-slate-500">Loading chart…</p>;
  if (isEmpty) return <p className="text-slate-500">No factory price chart has been loaded yet.</p>;
  if (isError || !chart) return <p className="text-red-600">Could not load the price chart.</p>;
  // key: start fresh (filters, rate finder) when another chart is selected
  return <MetalChartView key={chart.code} chart={chart} charts={charts} onSelect={select} />;
}

function MetalChartView({ chart, charts, onSelect }: { chart: PriceChart; charts: PriceChartSummary[]; onSelect: (code: string) => void }) {
  const metal = chart.metalChart;
  const rateOf = useMemo(() => metalRateIndex(metal), [metal]);
  const { masters } = useMasters();
  const erpProductType = (code: string) => masters?.productTypes.find((p) => p.name === code);

  const [filter, setFilter] = useState<string>('ALL');
  const [finderType, setFinderType] = useState(metal.productTypes[0].code);
  const finderVariants = Array.from(new Set(metal.weightRanges.filter((r) => r.productType === finderType).map((r) => r.variant)));
  const [finderVariant, setFinderVariant] = useState<string | null>(null);
  const [finderWeight, setFinderWeight] = useState('');

  const variant = finderVariants.includes(finderVariant) ? finderVariant : finderVariants[0];
  const finderRanges = metal.weightRanges.filter((r) => r.productType === finderType && r.variant === variant);
  const weight = parseFloat(finderWeight);
  const hasWeight = finderWeight !== '' && !Number.isNaN(weight);
  const matched = hasWeight ? findRange(finderRanges, weight) : undefined;

  const productTypes = metal.productTypes.filter((p) => filter === 'ALL' || p.code === filter);
  const basic = metal.chargeTypes.filter((t) => t.group === 'Basic charge');
  const addOns = metal.chargeTypes.filter((t) => t.group === 'Add-on');
  const rateColumns = [...basic, ...addOns];

  return (
    <div className="space-y-4 max-w-7xl">
      <ChartHeader title="Metal Chart" chart={chart} charts={charts} onSelect={onSelect} />

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="Gold loss" subtitle="金耗">
          <ul className="space-y-1.5 text-sm">
            {metal.goldLoss.map((g) => (
              <li key={g.style} className="flex justify-between gap-3">
                <span>
                  {g.style} {g.styleZh && <span className="text-slate-500">({g.styleZh})</span>}
                  <span className="block text-xs text-slate-500">{g.karats}</span>
                </span>
                <span className="font-semibold tabular-nums">{g.pct != null ? `${fmtNum(g.pct, 0)}%` : <span className="font-normal text-slate-400">not given</span>}</span>
              </li>
            ))}
          </ul>
        </Section>

        <div className="lg:col-span-2">
          <Section title="Rate finder" subtitle="Pick a product type and net gold weight">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Product type</span>
                <select
                  value={finderType}
                  onChange={(e) => setFinderType(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  {metal.productTypes.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
                </select>
              </label>
              {finderVariants.length > 1 && (
                <label className="text-sm">
                  <span className="block text-xs text-slate-500 mb-1">Type</span>
                  <select
                    value={variant ?? ''}
                    onChange={(e) => setFinderVariant(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  >
                    {finderVariants.map((v) => <option key={v} value={v ?? ''}>{v}</option>)}
                  </select>
                </label>
              )}
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Net gold weight (g)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={finderWeight}
                  onChange={(e) => setFinderWeight(e.target.value)}
                  placeholder="e.g. 4.5"
                  className="w-32 px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </label>
            </div>
            {hasWeight && (
              matched ? (
                <div className="mt-3">
                  <p className="text-sm text-slate-700">
                    Wt <b>{wt(matched.wtFrom)} – {wt(matched.wtTo)} g</b>
                    {matched.note && <span className="text-slate-500"> — {matched.note}</span>}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                    {rateColumns.map((t) => {
                      const r = rateOf(matched.id, t.code);
                      return (
                        <div key={t.code}>
                          <dt className="text-[11px] uppercase tracking-wide text-slate-400">{t.name}</dt>
                          <dd className="text-sm tabular-nums">{r ? `${fmtNum(r.rate)}${r.unit !== 'per pc' ? ` ${r.unit}` : ''}` : '—'}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ) : (
                <p className="mt-3 text-sm text-red-600">
                  No weight range for {finderWeight} g — this product type goes up to {wt(Math.max(...finderRanges.map((r) => r.wtTo ?? Infinity)))} g.
                </p>
              )
            )}
          </Section>
        </div>
      </div>

      <Section title="A) Labor cost" subtitle={`工费 · ${chart.currency} per piece unless marked · weight ranges are net gold weight in grams`}>
        <div className="flex flex-wrap gap-1 mb-3">
          {[{ code: 'ALL', label: 'All' }, ...metal.productTypes.map((p) => ({ code: p.code, label: p.code }))].map((p) => (
            <button
              key={p.code}
              onClick={() => setFilter(p.code)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${filter === p.code ? 'bg-amber-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-slate-500 bg-slate-50">
              <tr>
                <th rowSpan={2} className="px-3 py-1.5 text-left font-medium align-bottom">Product type</th>
                <th rowSpan={2} className="px-3 py-1.5 text-left font-medium align-bottom">Type</th>
                <th rowSpan={2} className="px-3 py-1.5 text-right font-medium align-bottom whitespace-nowrap">Wt from (g)</th>
                <th rowSpan={2} className="px-3 py-1.5 text-right font-medium align-bottom whitespace-nowrap">Wt to (g)</th>
                <th colSpan={basic.length} className="px-3 pt-1.5 text-center font-medium border-b border-slate-200">Basic charge</th>
                <th colSpan={addOns.length} className="px-3 pt-1.5 text-center font-medium border-b border-slate-200">Add-ons</th>
                <th rowSpan={2} className="px-3 py-1.5 text-left font-medium align-bottom">Note</th>
              </tr>
              <tr>
                {rateColumns.map((t) => (
                  <th key={t.code} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                    {t.group === 'Basic charge' ? t.name.replace('Basic — ', '') : t.name}
                    {t.nameZh && <span className="block text-[11px] font-normal text-slate-400">{t.nameZh}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productTypes.map((p) => {
                const ranges = metal.weightRanges.filter((r) => r.productType === p.code);
                const erp = erpProductType(p.code);
                return ranges.map((r, i) => (
                  <tr key={r.id} className={`border-t ${i === 0 ? 'border-slate-200' : 'border-slate-100'} ${matched?.id === r.id ? 'bg-amber-50' : ''}`}>
                    {i === 0 && (
                      <td rowSpan={ranges.length} className="px-3 py-1.5 align-top">
                        <span className="font-medium text-slate-900">{p.code}</span>
                        {p.nameZh && <span className="block text-xs text-slate-500">{p.nameZh}</span>}
                        {masters && (
                          <span className={`block text-[11px] mt-0.5 ${erp ? 'text-slate-400' : 'text-amber-700'}`}>
                            {erp ? `ERP id ${erp.id}` : 'not in the ERP master'}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{r.variant ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{wt(r.wtFrom)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{r.variant && r.wtTo == null ? 'any' : wt(r.wtTo)}</td>
                    {rateColumns.map((t) => {
                      const rate = rateOf(r.id, t.code);
                      return (
                        <td key={t.code} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {rate ? <>{fmtNum(rate.rate)}{rate.unit !== 'per pc' && <span className="text-xs text-slate-500"> {rate.unit}</span>}</> : <span className="text-slate-300">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-xs text-slate-500 max-w-xs">{r.note}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Product types are matched by name to the ERP product type master (shared by all companies). A weight on a range boundary (e.g. 3 g) uses the lower range.
        </p>
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="D) Alloy" subtitle={`补口 · ${chart.currency} per gram`}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {metal.alloy.map((a) => (
                <tr key={a.metal}><td className="py-1.5">{a.metal}</td><td className="py-1.5 text-right tabular-nums">{fmtNum(a.pricePerGm)}</td></tr>
              ))}
            </tbody>
          </table>
          {metal.alloyNotes.map((n) => <p key={n} className="mt-2 text-xs text-slate-500">{n}</p>)}
        </Section>
        <Section title="D) Laser stamping" subtitle={`字印费 · ${chart.currency} per piece`}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {metal.stamping.map((s) => (
                <tr key={s.stamp}><td className="py-1.5">{s.stamp}</td><td className="py-1.5 text-right tabular-nums">{fmtNum(s.pricePerPc)}</td></tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Section title="E) Model making charge" subtitle={`起版费 · ${chart.currency} by style`}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {metal.modelMaking.byStyle.map((m) => (
                <tr key={m.style}><td className="py-1.5">{m.style}</td><td className="py-1.5 text-right tabular-nums">{fmtNum(m.min, 0)} – {fmtNum(m.max, 0)}</td></tr>
              ))}
            </tbody>
          </table>
          {metal.modelMaking.byStyle[0]?.remark && <p className="mt-2 text-xs text-slate-500">{metal.modelMaking.byStyle[0].remark}</p>}
        </Section>
        <div className="lg:col-span-2">
          <Section title="F) Model making charge" subtitle={`起版费 · ${chart.currency} by metal weight`}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500 bg-slate-50">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Style</th>
                    {metal.modelMaking.byWeight.weightBands.map((w) => <th key={w} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">{w}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {metal.modelMaking.byWeight.rows.map((r) => (
                    <tr key={`${r.style}-${r.styleZh}`}>
                      <td className="px-3 py-1.5">
                        {r.style}
                        {r.styleZh && <span className="block text-xs text-slate-500">{r.styleZh}</span>}
                      </td>
                      {r.rates.map((v, i) => <td key={i} className="px-3 py-1.5 text-right tabular-nums">{v != null ? fmtNum(v, 0) : '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {metal.modelMaking.byWeight.rows[0]?.remark && <p className="mt-2 text-xs text-slate-500">{metal.modelMaking.byWeight.rows[0].remark}</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}
