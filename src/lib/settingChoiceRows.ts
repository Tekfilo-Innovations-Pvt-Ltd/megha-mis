import { compareLine, type ComparisonOptions } from '@/lib/labourComparison';
import { loadComparisonLines, type LineFilter } from '@/lib/labourComparisonData';
import type { PriceChart } from '@/lib/priceChart';
import { settingChoiceKey } from '@/lib/settingChoices';

// The distinct stones (lot code + shape + MM size) the ERP records no setting
// type for, in the given lines — what the Setting types picker lists. For each:
// how much of it there is, what type the report would use without a choice
// (the invoice's Setting row, else the default), the type chosen, and the
// chart types that can price it (those of its rate group's section).

export interface SettingChoiceRow {
  key: string;
  lotCode: string | null;
  commodity: string;
  shape: string | null;
  mmSize: string | null;
  lines: number;
  pieces: number;
  invoiceType: string | null; // type named on the invoice's Setting row (most common), if any
  chosen: string | null;
  allowedTypes: string[] | null; // null = the chart can't place the stone (commodity / shape / size)
  issue: string | null; // why the chart can't price it whatever the type, if so
}

export function settingChoiceRows(
  data: Awaited<ReturnType<typeof loadComparisonLines>>,
  chart: PriceChart,
  options: ComparisonOptions,
): SettingChoiceRow[] {
  // Compared without the choices, to see what the invoice / default would give.
  const plain: ComparisonOptions = { ...options, settingTypeChoices: undefined };
  const rows = new Map<string, SettingChoiceRow & { lineIds: Set<number>; invoiceTypes: Map<string, number> }>();
  const sectionOf = new Map(chart.settingChart.rateGroups.map((g) => [g.code, g.section]));

  for (const line of data.lines) {
    const erpTyped = new Set(line.stones.filter((s) => s.settingType).map((s) => s.componentId));
    const c = compareLine(line, chart, plain);
    for (const st of c.setting.stones) {
      if (erpTyped.has(st.componentId)) continue;
      const key = settingChoiceKey(st.lotCode, st.shape, st.mmSize);
      const row =
        rows.get(key) ??
        {
          key,
          lotCode: st.lotCode,
          commodity: st.commodity,
          shape: st.shape,
          mmSize: st.mmSize,
          lines: 0,
          pieces: 0,
          invoiceType: null,
          chosen: options.settingTypeChoices?.[key] ?? null,
          allowedTypes: null,
          issue: null,
          lineIds: new Set<number>(),
          invoiceTypes: new Map<string, number>(),
        };
      row.lineIds.add(line.invDetId);
      row.pieces += st.pieces;
      if (st.settingTypeSource === 'INVOICE' && st.settingType) row.invoiceTypes.set(st.settingType, (row.invoiceTypes.get(st.settingType) ?? 0) + 1);
      const section = st.rateGroup ? sectionOf.get(st.rateGroup) : undefined;
      if (section && !row.allowedTypes) {
        row.allowedTypes = chart.settingChart.settingTypes.filter((t) => t.sections.includes(section)).map((t) => t.code);
      }
      if (!section && st.issue && st.issue !== 'NO_SETTING_TYPE' && st.issue !== 'NO_RATE') row.issue = st.issue;
      rows.set(key, row);
    }
  }

  return Array.from(rows.values())
    .map(({ lineIds, invoiceTypes, ...r }) => ({
      ...r,
      lines: lineIds.size,
      pieces: Math.round(r.pieces),
      invoiceType: Array.from(invoiceTypes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      issue: r.allowedTypes ? null : r.issue,
    }))
    .sort((a, b) => b.lines - a.lines || (a.lotCode ?? '').localeCompare(b.lotCode ?? ''));
}

export async function loadSettingChoiceRows(filter: LineFilter, chart: PriceChart, options: ComparisonOptions) {
  return settingChoiceRows(await loadComparisonLines(filter), chart, options);
}
