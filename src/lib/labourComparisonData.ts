import erp from '@/lib/erp';
import type { LineInput, StoneInput } from '@/lib/labourComparison';

// Loads factory-invoice lines in the shape src/lib/labourComparison.ts needs,
// in four set-based queries (lines, metal, labour, stones) rather than one per
// line. Always scoped to one company. ERP masters are shared across companies,
// so names are taken from whatever master row the invoice references.

export interface LineFilter {
  companyId: number;
  from?: string; // yyyy-mm-dd, invoice date
  to?: string;
  productType?: string; // ERP product type name (case-insensitive)
  jobCategory?: string; // tbl_jewellery.job_category (case-insensitive), e.g. Normal / Repair
  sku?: string; // part of the SKU number
  skuExact?: boolean; // sku is the whole SKU number (case-insensitive)
  invNo?: string; // part of the invoice number as shown, e.g. FI-1234 (case-insensitive)
  jewNo?: string; // part of the jewellery number as shown, e.g. J800223 (case-insensitive)
  bagNo?: string; // part of the bag number as shown, e.g. B803443 (case-insensitive)
  invId?: number;
  invIds?: number[];
  invDetId?: number;
}

export interface LineInfo {
  invDetId: number;
  invId: number;
  invNo: string;
  invDt: string;
  factoryId: number;
  factoryName: string;
  jewNo: string;
  skuNo: string | null;
  soNo: string | null; // sales order number on the jewellery
  bagNo: string | null; // manufacturing bag (e.g. B803443) — tells apart lines of the same jewellery on one invoice; older lines have none
  size: string | null; // product size (ring size, bracelet length…)
  jobCategory: string | null; // tbl_jewellery.job_category: Normal, Repair, QC Repair
  grossWt: number | null; // as recorded on the line (physical, else invoiced); null when neither is
  componentSettingNotCounted: number; // setting_amount on the stone components left out because the labour table has a setting row; 0 normally
}

// Labour rows that are stone setting only (not combined rows like "CPF+ Setting + Rhodium").
const SETTING_ROW = /^((side|center|centre) stone )?setting$/i;

// Every filter is optional — with none, all lines of the company are loaded.
export async function loadComparisonLines(filter: LineFilter): Promise<{ info: Map<number, LineInfo>; lines: LineInput[] }> {
  // The optional conditions are assembled as plain SQL with numbered
  // parameters. (Composing Prisma.sql fragments looked fine under tsx, but in
  // the Next.js bundle the fragments were sent as one JSON value — "argument
  // of WHERE must be type boolean, not type jsonb".) Values stay bound
  // parameters, never string-concatenated.
  const params: unknown[] = [];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [`m.company_id = ${param(filter.companyId)}`, 'm.is_deleted = 0', 'd.is_deleted = 0'];
  if (filter.from) where.push(`m.inv_dt >= ${param(filter.from)}::date`);
  if (filter.to) where.push(`m.inv_dt <= ${param(filter.to)}::date`);
  if (filter.productType) where.push(`upper(trim(pt.product_type_name)) = ${param(filter.productType.trim().toUpperCase())}`);
  if (filter.jobCategory) where.push(`upper(trim(j.job_category)) = ${param(filter.jobCategory.trim().toUpperCase())}`);
  if (filter.sku) {
    const escaped = filter.sku.trim().replace(/[\\%_]/g, '\\$&');
    where.push(`s.sku_no ILIKE ${param(filter.skuExact ? escaped : `%${escaped}%`)}`);
  }
  if (filter.invNo) {
    const escaped = filter.invNo.trim().replace(/[\\%_]/g, '\\$&');
    where.push(`(m.inv_type || '-' || m.inv_no::text) ILIKE ${param(`%${escaped}%`)}`);
  }
  if (filter.jewNo) {
    const escaped = filter.jewNo.trim().replace(/[\\%_]/g, '\\$&');
    where.push(`concat(j.jew_type, j.jew_no) ILIKE ${param(`%${escaped}%`)}`);
  }
  if (filter.bagNo) {
    const escaped = filter.bagNo.trim().replace(/[\\%_]/g, '\\$&');
    where.push(`concat(b.bag_type, b.bag_no) ILIKE ${param(`%${escaped}%`)}`);
  }
  if (filter.invId) where.push(`m.inv_id = ${param(filter.invId)}`);
  if (filter.invIds) where.push(`m.inv_id = ANY(${param(filter.invIds)}::int[])`);
  if (filter.invDetId) where.push(`d.inv_det_id = ${param(filter.invDetId)}`);

  const rows = await erp.$queryRawUnsafe<
    {
      inv_det_id: number;
      inv_id: number;
      inv_no: string;
      inv_dt: Date;
      currency: string;
      factory_id: number;
      factory_name: string;
      jew_no: string;
      sku_no: string | null;
      so_no: string | null;
      bag_no: string | null;
      size: string | null;
      job_category: string | null;
      product_type: string | null;
      qty: number;
      gross_wt: number | null;
    }[]
  >(
    `SELECT d.inv_det_id, m.inv_id, m.inv_type || '-' || m.inv_no AS inv_no, m.inv_dt, m.currency,
            f.factory_id, f.factory_name, concat(j.jew_type, j.jew_no) AS jew_no, s.sku_no, nullif(trim(j.sales_order_no), '') AS so_no,
            nullif(concat(b.bag_type, b.bag_no), '') AS bag_no,
            coalesce(nullif(trim(j.product_size), ''), nullif(trim(ps.product_size), '')) AS size, nullif(trim(j.job_category), '') AS job_category,
            upper(trim(pt.product_type_name)) AS product_type, d.inv_qty::float8 AS qty,
            coalesce(nullif(d.physical_gross_wt, 0), nullif(d.gross_wt, 0))::float8 AS gross_wt
       FROM tbl_factory_invoice_det d
       JOIN tbl_factory_invoice_main m ON m.inv_id = d.inv_id
       JOIN tbl_factory f ON f.factory_id = m.factory_id
       JOIN tbl_jewellery j ON j.jew_id = d.jew_id
       LEFT JOIN tbl_product_type pt ON pt.product_type_id = j.product_type_id
       -- tbl_jewellery.sku_no is empty in this ERP; the SKU lives in tbl_sku (no FK, joined by id)
       LEFT JOIN tbl_sku s ON s.sku_id = j.sku_id
       LEFT JOIN tbl_product_size ps ON ps.size_id = j.product_size_id
       -- the bag comes from the manufacturing invoice line this line was made from
       LEFT JOIN tbl_mfg_factory_invoice_det md ON md.inv_det_id = d.jb_inv_det_id
       LEFT JOIN tbl_mfg_bag b ON b.bag_id = md.bag_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.inv_dt DESC, m.inv_id DESC, d.inv_det_id`,
    ...params,
  );

  const lineRows = rows;
  const ids = lineRows.map((r) => r.inv_det_id);
  if (ids.length === 0) return { info: new Map(), lines: [] };

  const [metal, labour, stones] = await Promise.all([
    // Net weight is the consumed quantity; total_qty1 also counts the loss.
    erp.$queryRaw<{ inv_det_id: number; lot_code: string; commodity: string; grams: number }[]>`
      SELECT c.inv_det_id, l.lot_code, upper(trim(co.commodity_name)) AS commodity, sum(c.consumed_qty1)::float8 AS grams
        FROM tbl_factory_invoice_component c
        JOIN tbl_lot l ON l.lot_id = c.lot_id
        JOIN tbl_commodity co ON co.commodity_id = l.commodity_id
       WHERE c.inv_det_id = ANY(${ids}) AND c.is_deleted = 0
         AND l.lot_type = 'METAL' AND upper(trim(c.uom1)) IN ('GM', 'GMS', 'G', 'GRAM')
       GROUP BY 1, 2, 3
       ORDER BY 1, min(c.component_id)`,
    erp.$queryRaw<{ inv_det_id: number; process: string; amount: number; qty: number; description: string | null }[]>`
      SELECT x.inv_det_id, p.process_name AS process, x.amount::float8 AS amount, x.qty::float8 AS qty,
             nullif(trim(x.description), '') AS description
        FROM tbl_factory_invoice_labour x
        JOIN tbl_process p ON p.process_id = x.process_id
       WHERE x.inv_det_id = ANY(${ids}) AND x.is_deleted = 0
       ORDER BY x.inv_det_id, x.sort_seq, x.factory_invoice_labour_id`,
    erp.$queryRaw<
      {
        component_id: number;
        inv_det_id: number;
        lot_code: string;
        master_lot_code: string | null;
        commodity: string;
        commodity_group: string;
        shape: string | null;
        mm_size: string | null;
        qty1: number;
        uom1: string | null;
        qty2: number;
        uom2: string | null;
        setting_type: string | null;
        setting_amount: number;
      }[]
    >`
      SELECT c.component_id, c.inv_det_id, l.lot_code, ml.lot_code AS master_lot_code,
             upper(trim(co.commodity_name)) AS commodity, upper(trim(cg.commodity_group_name)) AS commodity_group,
             upper(trim(sh.shape_name)) AS shape, nullif(trim(c.mm_size), '') AS mm_size,
             c.consumed_qty1::float8 AS qty1, upper(trim(c.uom1)) AS uom1,
             c.consumed_qty2::float8 AS qty2, upper(trim(c.uom2)) AS uom2,
             upper(trim(st.setting_type_name)) AS setting_type, c.setting_amount::float8 AS setting_amount
        FROM tbl_factory_invoice_component c
        JOIN tbl_lot l ON l.lot_id = c.lot_id
        LEFT JOIN tbl_lot ml ON ml.lot_id = l.master_lot_id
        JOIN tbl_commodity co ON co.commodity_id = l.commodity_id
        JOIN tbl_commodity_group cg ON cg.commodity_group_id = co.commodity_group_id
        LEFT JOIN tbl_shape sh ON sh.shape_id = coalesce(c.shape_id, l.shape_id)
        LEFT JOIN tbl_setting_type st ON st.setting_type_id = c.setting_type_id
       WHERE c.inv_det_id = ANY(${ids}) AND c.is_deleted = 0 AND l.lot_type = 'STONE'
       ORDER BY c.inv_det_id, c.component_id`,
  ]);

  const group = <T extends { inv_det_id: number }>(xs: T[]) => {
    const map = new Map<number, T[]>();
    for (const x of xs) map.set(x.inv_det_id, [...(map.get(x.inv_det_id) ?? []), x]);
    return map;
  };
  const metalBy = group(metal);
  const labourBy = group(labour);
  const stonesBy = group(stones);

  const info = new Map<number, LineInfo>();
  const lines: LineInput[] = lineRows.map((r) => {
    // The user's rule (2026-11-02): setting labour comes from the labour table
    // (Setting / Side Stone Setting / Center Stone Setting rows) when the line has
    // such a row; only when it has none is the setting_amount on the stone
    // components taken. Some AAA lines (May–Sep 2026) carry both, and the ERP line
    // total adds both — there the component amount is left out and noted.
    const lineStones = stonesBy.get(r.inv_det_id) ?? [];
    const lineLabour = labourBy.get(r.inv_det_id) ?? [];
    const settingInLabour = lineLabour.some((l) => l.amount !== 0 && SETTING_ROW.test(l.process.trim()));
    const componentSettingNotCounted = settingInLabour ? lineStones.reduce((sum, s) => sum + (s.setting_amount ?? 0), 0) : 0;
    info.set(r.inv_det_id, {
      invDetId: r.inv_det_id,
      invId: r.inv_id,
      invNo: r.inv_no,
      invDt: r.inv_dt.toISOString().slice(0, 10),
      factoryId: r.factory_id,
      factoryName: r.factory_name,
      jewNo: r.jew_no,
      skuNo: r.sku_no,
      soNo: r.so_no,
      bagNo: r.bag_no,
      size: r.size,
      jobCategory: r.job_category,
      grossWt: r.gross_wt,
      componentSettingNotCounted: Math.round(componentSettingNotCounted * 100) / 100,
    });
    return {
      invDetId: r.inv_det_id,
      qty: r.qty,
      productType: r.product_type,
      currency: r.currency,
      metal: (metalBy.get(r.inv_det_id) ?? []).map((m) => ({ commodity: m.commodity, grams: m.grams, lotCode: m.lot_code })),
      labour: lineLabour.map((l) => ({ process: l.process, amount: l.amount, qty: l.qty, description: l.description })),
      stones: lineStones.map(
        (s): StoneInput => ({
          componentId: s.component_id,
          lotCode: s.lot_code,
          masterLotCode: s.master_lot_code ?? undefined,
          commodity: s.commodity,
          commodityGroup: s.commodity_group,
          shape: s.shape,
          mmSize: s.mm_size,
          // Stones are normally CT / PCS; anything else can't give carats per stone.
          carats: s.uom1 === 'CT' ? s.qty1 : null,
          pieces: s.uom2 === 'PCS' ? s.qty2 : 0,
          settingType: s.setting_type,
          settingAmount: settingInLabour ? 0 : (s.setting_amount ?? 0), // see the rule above
        }),
      ),
    };
  });

  return { info, lines };
}

// Job categories used on the company's invoice lines — the report's filter options.
export async function listLineJobCategories(companyId: number): Promise<string[]> {
  const rows = await erp.$queryRaw<{ job_category: string }[]>`
    SELECT DISTINCT trim(j.job_category) AS job_category
      FROM tbl_factory_invoice_det d
      JOIN tbl_factory_invoice_main m ON m.inv_id = d.inv_id
      JOIN tbl_jewellery j ON j.jew_id = d.jew_id
     WHERE m.company_id = ${companyId} AND m.is_deleted = 0 AND d.is_deleted = 0
       AND trim(coalesce(j.job_category, '')) <> ''
     ORDER BY 1`;
  return rows.map((r) => r.job_category);
}

// Product types used on the company's invoice lines — the report's filter options.
export async function listLineProductTypes(companyId: number): Promise<string[]> {
  const rows = await erp.$queryRaw<{ product_type: string }[]>`
    SELECT DISTINCT upper(trim(pt.product_type_name)) AS product_type
      FROM tbl_factory_invoice_det d
      JOIN tbl_factory_invoice_main m ON m.inv_id = d.inv_id
      JOIN tbl_jewellery j ON j.jew_id = d.jew_id
      JOIN tbl_product_type pt ON pt.product_type_id = j.product_type_id
     WHERE m.company_id = ${companyId} AND m.is_deleted = 0 AND d.is_deleted = 0
       AND trim(coalesce(pt.product_type_name, '')) <> ''
     ORDER BY 1`;
  return rows.map((r) => r.product_type);
}
