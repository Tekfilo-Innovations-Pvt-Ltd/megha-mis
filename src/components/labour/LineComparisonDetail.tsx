'use client';

import { CheckCircleIcon, ArrowTrendingUpIcon, ArrowTrendingDownIcon, MinusCircleIcon } from '@heroicons/react/24/outline';
import {
  isComparedCharge,
  isComparedSetting,
  METAL_ISSUE_TEXT,
  STONE_ISSUE_TEXT,
  type LineComparison,
  type LineStatus,
} from '@/lib/labourComparison';
import { fmtNum } from '@/lib/format';
import type { LineCalcs } from '@/lib/chartCalc';
import ChartAmount from '@/components/labour/ChartAmount';

// Status is carried by icon + word, never colour alone.
const STATUS_META: Record<LineStatus, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  IN_LINE: { label: 'In line', icon: CheckCircleIcon, className: 'text-slate-700' },
  OVER: { label: 'Over chart', icon: ArrowTrendingUpIcon, className: 'text-red-700' },
  UNDER: { label: 'Under chart', icon: ArrowTrendingDownIcon, className: 'text-sky-700' },
  NOT_COMPARABLE: { label: 'Not comparable', icon: MinusCircleIcon, className: 'text-slate-500' },
};

export function StatusLabel({ status }: { status: LineStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${m.className}`}>
      <m.icon className="h-4 w-4" /> {m.label}
    </span>
  );
}

const signClass = (v: number) => (v > 0 ? 'text-red-700' : v < 0 ? 'text-sky-700' : '');

// Difference amount (invoiced − chart); the % goes in its own column — see VariancePct.
export function Variance({ value }: { value: number }) {
  return (
    <span className={`tabular-nums whitespace-nowrap ${signClass(value)}`}>
      {value > 0 ? '+' : ''}
      {fmtNum(value)}
    </span>
  );
}

export function VariancePct({ pct }: { pct: number | null }) {
  if (pct == null) return <>—</>;
  return (
    <span className={`tabular-nums whitespace-nowrap ${signClass(pct)}`}>
      {pct > 0 ? '+' : ''}
      {fmtNum(pct, 1)}%
    </span>
  );
}

export const variancePct = (invoiced: number, chart: number) => (chart > 0 ? ((invoiced - chart) / chart) * 100 : null);

const SETTING_TYPE_NAMES: Record<string, string> = {
  PRONG_PAVE: 'Prong/Pave',
  MICRO_PAVE: 'Micro Pave',
  CHANNEL: 'Channel',
  BEZEL: 'Bezel',
  WAX: 'Wax setting',
  INVISIBLE: 'Invisible',
  PRESSURE: 'Pressure',
};

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-1.5 font-medium whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

// Metal charges, every stone, and the labour the chart has no rate for — for one invoice line.
export default function LineComparisonDetail({ comparison, currency, calcs }: { comparison: LineComparison; currency: string; calcs?: LineCalcs }) {
  const { metal, setting } = comparison;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <StatusLabel status={comparison.status} />
        <span>
          Invoiced <b className="tabular-nums">{fmtNum(comparison.invoicedCompared)}</b> vs chart <b><ChartAmount value={comparison.chartTotal} calc={calcs?.total} currency={currency} /></b> {currency}
        </span>
        <span>Difference <Variance value={comparison.variance} /></span>
        <span>Difference % <VariancePct pct={comparison.variancePct} /></span>
        {comparison.partial && <span className="text-amber-800">Partly compared — see notes below</span>}
      </div>

      {/* Metal */}
      <section>
        <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Metal labour (Metal Chart)</h4>
        <p className="text-slate-600 mb-1.5">
          {metal.issue ? (
            <span className="text-amber-800">{METAL_ISSUE_TEXT[metal.issue]}.</span>
          ) : (
            <>
              {fmtNum(metal.grams, 3)} g {metal.metals.join(', ')} → <b>{fmtNum(metal.gramsPerPiece, 3)} g/pc</b> → range{' '}
              <b>{fmtNum(metal.wtFrom, 2)} – {metal.wtTo == null ? 'and above' : fmtNum(metal.wtTo, 2)} g</b>
              {metal.variant && <> ({metal.variant}, assumed)</>}
            </>
          )}
        </p>
        {metal.charges.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="text-slate-500 bg-slate-50">
                <tr><Th>Charge</Th><Th right>Invoiced</Th><Th right>Chart rate</Th><Th right>Chart amount</Th><Th right>Diff Amount</Th><Th right>Diff %</Th><Th>Note</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metal.charges.map((c) => {
                  const compared = isComparedCharge(c);
                  return (
                    <tr key={c.code} className={compared ? '' : 'text-slate-500'}>
                      <td className="px-3 py-1.5">{c.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(c.invoiced)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{c.chartRate != null ? fmtNum(c.chartRate, 4) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums"><ChartAmount value={c.chartAmount} calc={calcs?.charges[c.code]} currency={currency} empty="—" /></td>
                      <td className="px-3 py-1.5 text-right">{compared ? <Variance value={c.invoiced - c.chartAmount!} /> : '—'}</td>
                      <td className="px-3 py-1.5 text-right">{compared ? <VariancePct pct={variancePct(c.invoiced, c.chartAmount!)} /> : '—'}</td>
                      <td className="px-3 py-1.5 text-xs">{c.note ?? (c.invoiced === 0 && c.chartAmount != null ? 'Not invoiced — not counted' : '')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Setting */}
      <section>
        <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Setting labour (Setting Chart)</h4>
        <p className="text-slate-600 mb-1.5">
          Invoiced <b className="tabular-nums">{fmtNum(setting.invoiced)}</b>
          {setting.invoicedOnStones > 0 && <> ({fmtNum(setting.invoicedLabour)} labour rows + {fmtNum(setting.invoicedOnStones)} on stones)</>} vs chart{' '}
          <b><ChartAmount value={setting.chartAmount} calc={calcs?.setting} currency={currency} /></b>
          {!isComparedSetting(setting) && setting.stones.length > 0 && <span className="text-slate-500"> — not counted ({setting.invoiced > 0 ? 'chart could not price the stones' : 'no setting invoiced on this line'})</span>}
          {setting.unpricedStones > 0 && <span className="text-amber-800"> · {setting.unpricedStones} stone row(s) not priced by the chart</span>}
          {setting.possibleDoubleCharge && <span className="text-red-700"> · Possible double charge: the setting labour row equals the stones’ own setting total</span>}
        </p>
        {setting.stones.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="text-slate-500 bg-slate-50">
                <tr>
                  <Th>Commodity</Th><Th>Shape</Th><Th right>Pcs</Th><Th right>ct/stone</Th><Th>mm</Th><Th>Chart size</Th><Th>Setting type</Th>
                  <Th right>Chart rate</Th><Th right>Chart amount</Th><Th right>On stone</Th><Th>Note</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {setting.stones.map((s) => (
                  <tr key={s.componentId} className={s.issue ? 'text-slate-500' : ''}>
                    <td className="px-3 py-1.5">{s.commodity}</td>
                    <td className="px-3 py-1.5">{s.shape ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(s.pieces, 0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.caratsPerStone != null ? fmtNum(s.caratsPerStone, 4) : '—'}</td>
                    <td className="px-3 py-1.5">{s.mmSize ?? '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{s.sizeLabel ?? '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {s.settingType ? SETTING_TYPE_NAMES[s.settingType] ?? s.settingType : '—'}
                      {s.settingTypeAssumed && <span className="text-xs text-slate-500"> (default)</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.chartRate != null ? fmtNum(s.chartRate, 3) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums"><ChartAmount value={s.chartAmount} calc={calcs?.stones[s.componentId]} currency={currency} empty="—" /></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{s.invoiced ? fmtNum(s.invoiced) : '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-amber-800">{s.issue ? STONE_ISSUE_TEXT[s.issue] : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(comparison.combined?.length ?? 0) + (comparison.modelMaking?.length ?? 0) > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Combined rows and CAD</h4>
          <table className="text-sm">
            <tbody className="divide-y divide-slate-100">
              {comparison.combined?.map((x) => (
                <tr key={x.process}>
                  <td className="pr-4 py-1">{x.process}</td>
                  <td className="pr-4 py-1 text-right tabular-nums">{fmtNum(x.invoiced)}</td>
                  <td className="pr-4 py-1 text-right tabular-nums">
                    vs chart <ChartAmount value={x.chartAmount} calc={calcs?.combined?.[x.process]} currency={currency} empty="—" />
                  </td>
                  <td className="py-1 text-xs text-slate-500">{x.note ?? 'Chart amounts of its parts added up'}</td>
                </tr>
              ))}
              {comparison.modelMaking?.map((m) => (
                <tr key={m.process}>
                  <td className="pr-4 py-1">{m.process}</td>
                  <td className="pr-4 py-1 text-right tabular-nums">{fmtNum(m.invoiced)}</td>
                  <td className={`pr-4 py-1 text-right whitespace-nowrap ${m.status === 'ABOVE' ? 'text-red-700 font-medium' : ''}`}>
                    {m.status === 'WITHIN' ? 'within' : m.status === 'ABOVE' ? 'above' : 'below'} {m.min}–{m.max}
                  </td>
                  <td className="py-1 text-xs text-slate-500">Model-making range — {m.basis}. Not in the totals.</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {comparison.notInChart.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Other labour — no chart rate, not compared</h4>
          <div className="flex flex-wrap gap-1.5">
            {comparison.notInChart.map((l) => (
              <span key={l.process} className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {l.process} <span className="tabular-nums">{fmtNum(l.amount)}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
