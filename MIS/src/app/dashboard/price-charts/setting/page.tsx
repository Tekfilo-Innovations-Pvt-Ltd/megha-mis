'use client';

import { useMemo, useState } from 'react';
import ChartHeader, { useSelectedChart } from '@/components/priceChart/ChartHeader';
import { useMasters } from '@/components/priceChart/useMasters';
import { findRange, matchCommodity, settingRateIndex, type ChartCommodity, type PriceChart, type StoneSection } from '@/lib/priceChart';
import type { PriceChartSummary } from '@/lib/priceChartStore';
import { fmtNum } from '@/lib/format';

const SECTION_TITLES: Record<StoneSection, string> = {
  SIDE: 'B) Diamond setting · 钻石镶工单价',
  CENTER: 'C) Center stone setting · 主石镶工单价',
};

// ERP commodity groups that are not stones — left out of the "not mapped" check.
const NON_STONE_GROUPS = ['METAL', 'OTHER METAL', 'CHAIN', 'FINDINGS', 'OTHERS', 'LAB GROWN', 'CVD'];

const ct = (v: number | null) => (v == null ? 'and above' : String(v));

export default function SettingChartPage() {
  const { chart, charts, select, isLoading, isEmpty, isError } = useSelectedChart();
  if (isLoading) return <p className="text-slate-500">Loading chart…</p>;
  if (isEmpty) return <p className="text-slate-500">No factory price chart has been loaded yet.</p>;
  if (isError || !chart) return <p className="text-red-600">Could not load the price chart.</p>;
  // key: start fresh (selected commodity, rate finder) when another chart is selected
  return <SettingChartView key={chart.code} chart={chart} charts={charts} onSelect={select} />;
}

function SettingChartView({ chart, charts, onSelect }: { chart: PriceChart; charts: PriceChartSummary[]; onSelect: (code: string) => void }) {
  const setting = chart.settingChart;
  const rateOf = useMemo(() => settingRateIndex(setting), [setting]);
  const { masters } = useMasters();

  const [selected, setSelected] = useState(setting.commodities[0].code);
  const [finderShape, setFinderShape] = useState('');
  const [finderCt, setFinderCt] = useState('');

  const commodity = setting.commodities.find((c) => c.code === selected) ?? setting.commodities[0];
  const groups = commodity.rateGroups.map((code) => setting.rateGroups.find((g) => g.code === code)!);
  const section = groups[0].section;
  // Prong/Pave, Micro Pave, Channel, Bezel, … are ERP setting types (tbl_setting_type).
  const settingTypes = setting.settingTypes.filter((t) => t.sections.includes(section));
  const erpSettingTypes = (erpNames: string[]) => (masters?.settingTypes ?? []).filter((s) => erpNames.includes(s.name));

  // ERP commodities (shared by all companies), grouped under the chart commodity they match.
  const erpByCommodity = useMemo(() => {
    const map = new Map<string, { id: number; name: string }[]>();
    const unmapped: { id: number; name: string; group: string }[] = [];
    for (const c of masters?.commodities ?? []) {
      const hit = matchCommodity(setting.commodities, c.name, c.group);
      if (hit) map.set(hit.code, [...(map.get(hit.code) ?? []), c]);
      else if (!NON_STONE_GROUPS.includes(c.group)) unmapped.push(c);
    }
    return { map, unmapped };
  }, [masters, setting.commodities]);
  const erpShapes = new Set(masters?.shapes.map((s) => s.name));

  // Rate finder for the selected commodity: shape → rate group, then carats → range.
  const shapes = groups.flatMap((g) => g.shapes);
  const shape = shapes.includes(finderShape) ? finderShape : shapes[0];
  const finderGroup = groups.find((g) => g.shapes.includes(shape))!;
  const weight = parseFloat(finderCt);
  const hasWeight = finderCt !== '' && !Number.isNaN(weight);
  const finderRanges = setting.sizeRanges.filter((r) => r.rateGroup === finderGroup.code);
  const matched = hasWeight ? findRange(finderRanges, weight) : undefined;

  const select = (c: ChartCommodity) => {
    setSelected(c.code);
    setFinderShape('');
  };

  return (
    <div className="space-y-4 max-w-7xl">
      <ChartHeader title="Setting Chart" chart={chart} charts={charts} onSelect={onSelect} />

      <div className="grid lg:grid-cols-[16rem_minmax(0,1fr)] gap-4 items-start">
        {/* Commodity list */}
        <nav className="bg-white rounded-xl border border-slate-200 lg:sticky lg:top-4">
          {(['SIDE', 'CENTER'] as StoneSection[]).map((s) => (
            <div key={s}>
              <h2 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s === 'SIDE' ? 'Diamond setting' : 'Center stone'}</h2>
              <ul className="pb-2">
                {setting.commodities
                  .filter((c) => setting.rateGroups.find((g) => g.code === c.rateGroups[0])?.section === s)
                  .map((c) => {
                    const count = erpByCommodity.map.get(c.code)?.length ?? 0;
                    return (
                      <li key={c.code}>
                        <button
                          onClick={() => select(c)}
                          className={`w-full flex items-center justify-between gap-2 px-4 py-1.5 text-left text-sm border-l-4 ${c.code === commodity.code ? 'border-amber-600 bg-amber-50 text-slate-900' : 'border-transparent text-slate-700 hover:bg-slate-50'}`}
                        >
                          <span className="truncate">
                            {c.name} {c.nameZh && <span className="text-xs text-slate-400">{c.nameZh}</span>}
                          </span>
                          {masters && <span className="text-xs text-slate-400 tabular-nums shrink-0" title="ERP commodities covered">{count}</span>}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="space-y-4 min-w-0">
          {/* Selected commodity */}
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold text-slate-900">{commodity.name}</h2>
              {commodity.nameZh && <span className="text-slate-500">{commodity.nameZh}</span>}
              <span className="text-xs text-slate-500">{SECTION_TITLES[section]}</span>
            </div>
            <div className="mt-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">ERP commodities covered</div>
              {!masters ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : (erpByCommodity.map.get(commodity.code) ?? []).length === 0 ? (
                <p className="text-sm text-amber-700">None — no ERP commodity matches.</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {erpByCommodity.map.get(commodity.code)!.map((c) => (
                    <span key={c.id} className="px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-700" title={`ERP id ${c.id}`}>{c.name}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Rate finder */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Shape</span>
                <select
                  value={shape}
                  onChange={(e) => setFinderShape(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                >
                  {shapes.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500 mb-1">Stone weight (ct)</span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={finderCt}
                  onChange={(e) => setFinderCt(e.target.value)}
                  placeholder="e.g. 0.12"
                  className="w-32 px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </label>
              {hasWeight && (
                matched ? (
                  <p className="text-sm text-slate-700 pb-1.5">
                    Wt <b>{ct(matched.wtFrom)} – {ct(matched.wtTo)} ct</b>: {settingTypes.map((t) => {
                      const r = rateOf(matched.id, t.code);
                      return r != null ? `${t.name} ${fmtNum(r, r < 1 ? 3 : 2)}` : null;
                    }).filter(Boolean).join(' · ')}
                  </p>
                ) : (
                  <p className="text-sm text-red-600 pb-1.5">
                    No weight range for {finderCt} ct
                    {finderRanges.some((r) => r.wtFrom == null) && ' — smaller stones are priced by mm size in the table below'}.
                  </p>
                )
              )}
            </div>
          </section>

          {/* One table per rate group (Diamond: round, and fancy shapes) */}
          {groups.map((g) => {
            const ranges = setting.sizeRanges.filter((r) => r.rateGroup === g.code);
            const hasMm = ranges.some((r) => r.sizeMm);
            return (
              <section key={g.code} className="bg-white rounded-xl border border-slate-200">
                <header className="px-4 py-2.5 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-900 text-sm">{g.name}</h3>
                  {g.nameZh && <p className="text-xs text-slate-500">{g.nameZh}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[11px] uppercase tracking-wide text-slate-400 mr-1">Shapes</span>
                    {g.shapes.map((s) => (
                      <span
                        key={s}
                        className={`px-2 py-0.5 rounded text-xs ${!masters || erpShapes.has(s) ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800'}`}
                        title={masters && !erpShapes.has(s) ? 'Not in the ERP shape master' : undefined}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  {g.note && <p className="mt-1 text-xs text-slate-600">Note: {g.note}</p>}
                </header>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-slate-500 bg-slate-50">
                      <tr>
                        <th className="px-4 py-1.5 text-right font-medium whitespace-nowrap">Wt from (ct)</th>
                        <th className="px-3 py-1.5 text-right font-medium whitespace-nowrap">Wt to (ct)</th>
                        {hasMm && <th className="px-3 py-1.5 text-left font-medium">Size (mm)</th>}
                        {settingTypes.map((t) => {
                          const erp = erpSettingTypes(t.erpNames);
                          return (
                            <th key={t.code} className="px-3 py-1.5 text-right font-medium whitespace-nowrap align-bottom">
                              {t.name}
                              {t.nameZh && <span className="block text-[11px] font-normal text-slate-400">{t.nameZh}</span>}
                              {masters && (
                                <span
                                  className={`block text-[10px] font-normal ${erp.length ? 'text-slate-400' : 'text-amber-700'}`}
                                  title={`ERP setting types matched: ${t.erpNames.join(', ')}`}
                                >
                                  {erp.length ? `ERP: ${erp.map((s) => s.name).join(', ')}` : 'not in ERP'}
                                </span>
                              )}
                            </th>
                          );
                        })}
                        <th className="px-3 py-1.5 text-left font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {ranges.map((r) => (
                        <tr key={r.id} className={matched?.id === r.id ? 'bg-amber-50' : ''}>
                          <td className="px-4 py-1.5 text-right tabular-nums">{r.wtFrom != null ? r.wtFrom : <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                            {r.wtFrom != null ? ct(r.wtTo) : <span className="text-slate-300">—</span>}
                          </td>
                          {hasMm && <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{r.sizeMm ?? '—'}</td>}
                          {settingTypes.map((t) => {
                            const rate = rateOf(r.id, t.code);
                            return (
                              <td key={t.code} className="px-3 py-1.5 text-right tabular-nums">
                                {rate != null ? fmtNum(rate, rate < 1 ? 3 : 2) : <span className="text-slate-300">—</span>}
                              </td>
                            );
                          })}
                          <td className="px-3 py-1.5 text-xs text-slate-500">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
                  {chart.currency} per stone. Columns are setting types (Prong/Pave, Micro Pave, Channel, Bezel…), matched by name to
                   the ERP setting type master. Rows with only a mm size are priced by stone size, not
                  weight. A weight on a range boundary uses the lower range.
                </p>
              </section>
            );
          })}

          {masters && erpByCommodity.unmapped.length > 0 && (
            <details className="bg-white rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <summary className="cursor-pointer text-slate-700">
                {erpByCommodity.unmapped.length} ERP stone commodities are not covered by this chart
              </summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {erpByCommodity.unmapped.map((c) => (
                  <span key={c.id} className="px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-700" title={c.group}>{c.name}</span>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
