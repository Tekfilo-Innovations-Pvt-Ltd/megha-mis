// Colour bands that tell invoice labour, chart labour and their difference apart
// in every labour-vs-chart table, the way the factory's invoice sheet colours its
// sections. Headers get the stronger tint, body cells the lighter one. Amber is
// left free for "missing on one side" shading, and the difference's red/blue
// text (over/under chart) stays readable on its pink band.
export const SIDE = {
  invoice: { head: 'bg-indigo-200 text-indigo-950', cell: 'bg-indigo-100', swatch: 'bg-indigo-200 border-indigo-400', label: 'Invoice labour' },
  chart: { head: 'bg-emerald-200 text-emerald-950', cell: 'bg-emerald-100', swatch: 'bg-emerald-200 border-emerald-400', label: 'Chart labour' },
  diff: { head: 'bg-rose-200 text-rose-950', cell: 'bg-rose-100', swatch: 'bg-rose-200 border-rose-400', label: 'Difference' },
} as const;

export function SideLegend({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 ${className}`}>
      {Object.values(SIDE).map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3 w-5 rounded-sm border ${s.swatch}`} />
          {s.label}
        </span>
      ))}
    </span>
  );
}
