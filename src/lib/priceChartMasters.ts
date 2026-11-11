import erp from '@/lib/erp';

// ERP masters (product types, commodities, shapes, setting types) that
// price-chart rows are keyed on, by name. The ERP's masters are shared across
// companies — a company's invoices mostly reference company 1's master rows —
// so names are collected from every company and de-duplicated, upper-cased and
// trimmed to compare with the chart's keys.
export async function getPriceChartMasters() {
  const where = { is_deleted: 0 };
  const [productTypes, commodities, shapes, settingTypes] = await Promise.all([
    erp.tbl_product_type.findMany({ where, select: { product_type_id: true, product_type_name: true } }),
    erp.tbl_commodity.findMany({
      where,
      select: { commodity_id: true, commodity_name: true, tbl_commodity_group: { select: { commodity_group_name: true } } },
    }),
    erp.tbl_shape.findMany({ where, select: { shape_id: true, shape_name: true } }),
    erp.tbl_setting_type.findMany({ where, select: { setting_type_id: true, setting_type_name: true } }),
  ]);
  const up = (s: string | null) => (s ?? '').trim().toUpperCase();
  // One entry per name (lowest id kept), sorted by name.
  const unique = <T extends { id: number; name: string }>(rows: T[]) =>
    Array.from(
      rows
        .filter((r) => r.name)
        .sort((a, b) => a.id - b.id)
        .reduce((map, r) => (map.has(r.name) ? map : map.set(r.name, r)), new Map<string, T>())
        .values(),
    ).sort((a, b) => a.name.localeCompare(b.name));

  return {
    productTypes: unique(productTypes.map((p) => ({ id: p.product_type_id, name: up(p.product_type_name) }))),
    commodities: unique(commodities.map((c) => ({ id: c.commodity_id, name: up(c.commodity_name), group: up(c.tbl_commodity_group.commodity_group_name) }))),
    shapes: unique(shapes.map((s) => ({ id: s.shape_id, name: up(s.shape_name) }))),
    settingTypes: unique(settingTypes.map((s) => ({ id: s.setting_type_id, name: up(s.setting_type_name) }))),
  };
}

export type PriceChartMasters = Awaited<ReturnType<typeof getPriceChartMasters>>;
