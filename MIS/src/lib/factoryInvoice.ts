import erp from '@/lib/erp';
import { compareLine, type ComparisonOptions } from '@/lib/labourComparison';
import { loadComparisonLines } from '@/lib/labourComparisonData';
import type { PriceChart } from '@/lib/priceChart';

// Factory invoice, read from the ERP and reshaped into third normal form.
//
// The ERP tables are not 3NF: component/labour/chgs/prod_note/gross_wt_breakup
// all repeat inv_id (and component repeats jew_id), which are already
// determined by inv_det_id. Here each child hangs off its line only, and every
// lookup (jewellery, lot, bin, process, shape, setting type) is its own entity
// stored once and referenced by id. The redundant copies were verified equal
// to the line's values across the whole tenant before being dropped.

const num = (v: { toString(): string } | number | null | undefined) => (v == null ? null : Number(v));
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const notDeleted = { is_deleted: 0 };

const sum = (values: (number | null)[]) => values.reduce<number>((acc, v) => acc + (v ?? 0), 0);

// companyId scopes the read: an invoice of another company is "not found".
export async function getFactoryInvoice(invId: number, companyId: number) {
  const main = await erp.tbl_factory_invoice_main.findFirst({
    where: { inv_id: invId, company_id: companyId, ...notDeleted },
    include: {
      tbl_factory: true,
      tbl_factory_invoice_document: { where: notDeleted, orderBy: { document_id: 'asc' } },
      tbl_factory_invoice_det: {
        where: notDeleted,
        orderBy: { inv_det_id: 'asc' },
        include: {
          tbl_factory_invoice_component: { where: notDeleted, orderBy: { component_id: 'asc' } },
          tbl_factory_invoice_labour: { where: notDeleted, orderBy: { factory_invoice_labour_id: 'asc' } },
          tbl_factory_invoice_chgs: { where: notDeleted, orderBy: { map_id: 'asc' } },
          tbl_factory_invoice_prod_note: { where: notDeleted, orderBy: { note_id: 'asc' } },
          tbl_factory_invoice_gross_wt_breakup: { where: notDeleted, orderBy: { gross_wt_breakup_id: 'asc' } },
        },
      },
    },
  });
  if (!main) return null;

  const dets = main.tbl_factory_invoice_det;
  const components = dets.flatMap((d) => d.tbl_factory_invoice_component);
  const labours = dets.flatMap((d) => d.tbl_factory_invoice_labour);

  const unique = (ids: (number | null)[]) => Array.from(new Set(ids.filter((id): id is number => id != null)));
  const jewIds = unique(dets.map((d) => d.jew_id));
  const lotIds = unique(components.flatMap((c) => [c.lot_id, c.consume_lot_id]));
  const binIds = unique([...dets.map((d) => d.bin_id), ...components.map((c) => c.bin_id)]);
  const processIds = unique(labours.map((l) => l.process_id));
  const shapeIds = unique(components.map((c) => c.shape_id));
  const settingTypeIds = unique(components.map((c) => c.setting_type_id));

  const [jewellery, lots, bins, processes, shapes, settingTypes, labourInvoices] = await Promise.all([
    erp.tbl_jewellery.findMany({
      where: { jew_id: { in: jewIds } },
      select: { jew_id: true, jew_type: true, jew_no: true, sku_id: true, design_no: true, description: true, image_url: true },
    }),
    erp.tbl_lot.findMany({
      where: { lot_id: { in: lotIds } },
      select: { lot_id: true, lot_code: true, lot_type: true, tbl_commodity: { select: { commodity_name: true } } },
    }),
    erp.tbl_bin.findMany({ where: { bin_id: { in: binIds } }, select: { bin_id: true, bin_name: true } }),
    erp.tbl_process.findMany({ where: { process_id: { in: processIds } }, select: { process_id: true, process_name: true } }),
    erp.tbl_shape.findMany({ where: { shape_id: { in: shapeIds } }, select: { shape_id: true, shape_name: true } }),
    erp.tbl_setting_type.findMany({
      where: { setting_type_id: { in: settingTypeIds } },
      select: { setting_type_id: true, setting_type_name: true },
    }),
    // Labour invoices raised against this factory invoice (ref_inv_id has no FK in the ERP).
    erp.tbl_factory_invoice_labour_main.findMany({
      where: { ref_inv_id: invId, company_id: companyId, ...notDeleted },
      orderBy: { inv_dt: 'asc' },
    }),
  ]);

  // tbl_jewellery.sku_no is empty in this ERP — the SKU lives in tbl_sku,
  // linked by sku_id without a foreign key.
  const skus = await erp.tbl_sku.findMany({
    where: { sku_id: { in: unique(jewellery.map((j) => j.sku_id)) } },
    select: { sku_id: true, sku_no: true },
  });
  const skuNo = new Map(skus.map((s) => [s.sku_id, s.sku_no]));

  const lines = dets.map((d) => ({
    invDetId: d.inv_det_id,
    jewId: d.jew_id,
    binId: d.bin_id,
    invQty: num(d.inv_qty),
    grossWt: num(d.gross_wt),
    physicalGrossWt: num(d.physical_gross_wt),
    labourAmount: num(d.labour_amount),
    totalCogsAmount: num(d.total_cogs_amount),
    totalPpAmount: num(d.total_pp_amount),
    totalOtherChargesAmount: num(d.total_other_charges_amount),
    basePrice: num(d.base_price),
    basePriceCode: d.base_price_code,
    salesPrice: num(d.sales_price),
    salesPriceCode: d.sales_price_code,
    adminPct: num(d.admin_pct),
    metalRates: [
      { metal: 'Gold', rate: num(d.gold_rate), uom: d.gold_uom, rateLossPct: num(d.gold_rate_loss_pct), lossPct: num(d.gold_loss_pct) },
      { metal: 'Silver', rate: num(d.silver_rate), uom: d.silver_uom, rateLossPct: num(d.silver_rate_loss_pct), lossPct: num(d.silver_loss_pct) },
      { metal: 'Platinum', rate: num(d.platinum_rate), uom: d.platinum_uom, rateLossPct: num(d.platinum_rate_loss_pct), lossPct: num(d.platinum_loss_pct) },
      { metal: 'PT', rate: num(d.pt_rate), uom: d.pt_uom, rateLossPct: num(d.pt_rate_loss_pct), lossPct: null },
    ].filter((m) => (m.rate ?? 0) !== 0 || (m.lossPct ?? 0) !== 0),
    components: d.tbl_factory_invoice_component.map((c) => ({
      componentId: c.component_id,
      lotId: c.lot_id,
      consumeLotId: c.consume_lot_id,
      binId: c.bin_id,
      shapeId: c.shape_id,
      settingTypeId: c.setting_type_id,
      description: c.description,
      stoneSize: c.stone_size,
      sieveSize: c.sieve_size,
      mmSize: c.mm_size,
      uom1: c.uom1,
      uom2: c.uom2,
      consumedQty1: num(c.consumed_qty1),
      consumedQty2: num(c.consumed_qty2),
      brokenQty1: num(c.broken_qty1),
      lossQty1: num(c.loss_qty1),
      returnQty1: num(c.return_qty1),
      totalQty1: num(c.total_qty1),
      totalQty2: num(c.total_qty2),
      costPrice: num(c.cost_price),
      actualRate: num(c.actual_rate),
      actualAmount: num(c.actual_amount),
      cogsAmount: num(c.cogs_amount),
      settingRate: num(c.setting_rate),
      settingAmount: num(c.setting_amount),
      isCenterStone: c.is_center_stone === 1,
      isFg: c.is_fg === 1,
    })),
    labour: d.tbl_factory_invoice_labour.map((l) => ({
      labourId: l.factory_invoice_labour_id,
      processId: l.process_id,
      description: l.description,
      qty: num(l.qty),
      rate: num(l.rate),
      amount: num(l.amount),
      inputCurrency: l.input_currency,
      inputRate: num(l.input_rate),
      inputAmount: num(l.input_amount),
    })),
    // charge_id has no master table in the ERP, so charge_name stays as the only label.
    charges: d.tbl_factory_invoice_chgs.map((c) => ({
      mapId: c.map_id,
      chargeId: c.charge_id,
      chargeName: c.charge_name,
      chargeType: c.charge_type,
      isHandling: c.is_handling === 1,
      chargeRate: num(c.charge_rate),
      chargePcs: num(c.charge_pcs),
      chargeAmt: num(c.charge_amt),
    })),
    notes: d.tbl_factory_invoice_prod_note.map((n) => ({ noteId: n.note_id, note: n.note })),
    grossWtBreakup: d.tbl_factory_invoice_gross_wt_breakup.map((g) => ({
      breakupId: g.gross_wt_breakup_id,
      grossWt: num(g.gross_wt),
    })),
  }));

  return {
    invoice: {
      invId: main.inv_id,
      invType: main.inv_type,
      invNo: main.inv_no,
      displayNo: `${main.inv_type}-${main.inv_no}`,
      referenceNo: main.reference_no,
      exportInvNo: main.export_inv_no,
      invDt: iso(main.inv_dt),
      invDueDt: iso(main.inv_due_dt),
      dueMonths: num(main.inv_due_months),
      dueDays: num(main.inv_due_days),
      currency: main.currency,
      exchangeRate: num(main.exchange_rate),
      status: main.status,
      paymentStatus: main.payment_status,
      accountingStatus: main.accounting_status,
      customInvStatus: main.custom_inv_status,
      note: main.note,
      termsConditions: main.terms_conditions,
      factoryId: main.factory_id,
      companyId: main.company_id,
    },
    factory: {
      factoryId: main.tbl_factory.factory_id,
      factoryName: main.tbl_factory.factory_name,
      displayName: main.tbl_factory.display_name,
      email: main.tbl_factory.email,
      phoneNo: main.tbl_factory.phone_no,
      currency: main.tbl_factory.currency,
    },
    lines,
    documents: main.tbl_factory_invoice_document.map((doc) => ({
      documentId: doc.document_id,
      documentType: doc.document_type,
      documentName: doc.document_name,
      documentUrl: doc.document_url,
    })),
    labourInvoices: labourInvoices.map((l) => ({
      invId: l.inv_id,
      displayNo: `${l.inv_type}-${l.inv_no}`,
      invDt: iso(l.inv_dt),
      status: l.status,
      paymentStatus: l.payment_status,
      currency: l.currency,
      totalQty: num(l.total_qty),
      labourAmountLocal: num(l.labour_amount_local),
      labourAmountUsd: num(l.labour_amount_usd),
      labourAmountPaidUsd: num(l.labour_amount_paid_usd),
    })),
    // Lookup entities — each stored once, referenced from lines/components/labour by id.
    lookups: {
      jewellery: Object.fromEntries(jewellery.map((j) => [j.jew_id, {
        jewNo: `${j.jew_type}${j.jew_no}`,
        skuNo: j.sku_id != null ? (skuNo.get(j.sku_id) ?? null) : null,
        designNo: j.design_no,
        description: j.description,
        imageUrl: j.image_url,
      }])),
      lots: Object.fromEntries(lots.map((l) => [l.lot_id, { lotCode: l.lot_code, lotType: l.lot_type, commodity: l.tbl_commodity.commodity_name }])),
      bins: Object.fromEntries(bins.map((b) => [b.bin_id, b.bin_name])),
      processes: Object.fromEntries(processes.map((p) => [p.process_id, p.process_name])),
      shapes: Object.fromEntries(shapes.map((s) => [s.shape_id, s.shape_name])),
      settingTypes: Object.fromEntries(settingTypes.map((s) => [s.setting_type_id, s.setting_type_name])),
    },
    // Header totals are derived data (not 3NF) — show the stored value next to
    // the value recomputed from the lines so drift is visible.
    totals: {
      qty: { stored: num(main.total_qty), computed: sum(lines.map((l) => l.invQty)) },
      labourAmount: { stored: num(main.total_labour_amount), computed: sum(lines.flatMap((l) => l.labour.map((x) => x.amount))) },
      amount: { stored: num(main.total_amount), computed: null },
      paidAmount: { stored: num(main.total_paid_amount), computed: null },
      cogsAmount: { stored: null, computed: sum(lines.map((l) => l.totalCogsAmount)) },
      otherCharges: { stored: null, computed: sum(lines.flatMap((l) => l.charges.map((c) => c.chargeAmt))) },
      grossWt: { stored: null, computed: sum(lines.map((l) => l.grossWt)) },
    },
  };
}

export type FactoryInvoiceDetail = NonNullable<Awaited<ReturnType<typeof getFactoryInvoice>>>;

export interface FactoryInvoiceFilter {
  companyId: number;
  search?: string; // invoice no, reference, export invoice no or factory
  invNo?: string; // part of the invoice number as shown, e.g. JW-800016
  jewNo?: string; // part of a jewellery number on any of the invoice's lines
}

// Invoices whose shown number / any line's jewellery number contains the text —
// both are concatenations Prisma can't filter on. null when neither is set.
async function matchingInvoiceIds(filter: FactoryInvoiceFilter): Promise<number[] | null> {
  const invNo = filter.invNo?.trim();
  const jewNo = filter.jewNo?.trim();
  if (!invNo && !jewNo) return null;
  const like = (s: string | undefined) => (s ? `%${s.replace(/[\\%_]/g, '\\$&')}%` : null);
  const rows = await erp.$queryRaw<{ inv_id: number }[]>`
    SELECT m.inv_id
      FROM tbl_factory_invoice_main m
     WHERE m.company_id = ${filter.companyId} AND m.is_deleted = 0
       AND (${like(invNo)}::text IS NULL OR (m.inv_type || '-' || m.inv_no) ILIKE ${like(invNo)})
       AND (${like(jewNo)}::text IS NULL OR EXISTS (
             SELECT 1 FROM tbl_factory_invoice_det d JOIN tbl_jewellery j ON j.jew_id = d.jew_id
              WHERE d.inv_id = m.inv_id AND d.is_deleted = 0 AND concat(j.jew_type, j.jew_no) ILIKE ${like(jewNo)}))`;
  return rows.map((r) => r.inv_id);
}

async function invoiceWhere(filter: FactoryInvoiceFilter) {
  const search = filter.search?.trim();
  const ids = await matchingInvoiceIds(filter);
  return {
    ...notDeleted,
    company_id: filter.companyId,
    ...(ids ? { inv_id: { in: ids } } : {}),
    ...(search
      ? {
          OR: [
            { inv_no: { contains: search, mode: 'insensitive' as const } },
            { reference_no: { contains: search, mode: 'insensitive' as const } },
            { export_inv_no: { contains: search, mode: 'insensitive' as const } },
            { tbl_factory: { factory_name: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}

// Invoice labour of the given invoices compared with a price chart: per invoice,
// the chart labour of its comparable lines and the invoiced labour it is set against.
export async function chartLabourByInvoice(companyId: number, invIds: number[], chart: PriceChart, options: ComparisonOptions) {
  const byInvoice = new Map<number, { invoicedCompared: number; chart: number; lines: number; comparableLines: number }>();
  if (invIds.length === 0) return byInvoice;
  const { info, lines } = await loadComparisonLines({ companyId, invIds });
  for (const line of lines) {
    const invId = info.get(line.invDetId)!.invId;
    const c = compareLine(line, chart, options);
    const t = byInvoice.get(invId) ?? { invoicedCompared: 0, chart: 0, lines: 0, comparableLines: 0 };
    t.lines += 1;
    if (c.status !== 'NOT_COMPARABLE') {
      t.comparableLines += 1;
      t.invoicedCompared += c.invoicedCompared;
      t.chart += c.chartTotal;
    }
    byInvoice.set(invId, t);
  }
  return byInvoice;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Totals of every invoice in the filter: stored labour and amount, and the chart comparison.
export async function factoryInvoiceTotals(filter: FactoryInvoiceFilter, chart: PriceChart, options: ComparisonOptions) {
  const where = await invoiceWhere(filter);
  const invoices = await erp.tbl_factory_invoice_main.findMany({ where, select: { inv_id: true, total_labour_amount: true } });
  const byInvoice = await chartLabourByInvoice(filter.companyId, invoices.map((i) => i.inv_id), chart, options);
  const t = Array.from(byInvoice.values()).reduce(
    (a, b) => ({ invoicedCompared: a.invoicedCompared + b.invoicedCompared, chart: a.chart + b.chart, lines: a.lines + b.lines, comparableLines: a.comparableLines + b.comparableLines }),
    { invoicedCompared: 0, chart: 0, lines: 0, comparableLines: 0 },
  );
  return {
    invoices: invoices.length,
    labour: r2(invoices.reduce((s, i) => s + (num(i.total_labour_amount) ?? 0), 0)),
    invoicedCompared: r2(t.invoicedCompared),
    chartLabour: r2(t.chart),
    variance: r2(t.invoicedCompared - t.chart),
    lines: t.lines,
    comparableLines: t.comparableLines,
  };
}

export type FactoryInvoiceTotals = Awaited<ReturnType<typeof factoryInvoiceTotals>>;

export async function listFactoryInvoices(
  params: FactoryInvoiceFilter & { page: number; size: number },
  comparison?: { chart: PriceChart; options: ComparisonOptions }, // without it the chart fields are null
) {
  const where = await invoiceWhere(params);
  const [rows, total] = await Promise.all([
    erp.tbl_factory_invoice_main.findMany({
      where,
      orderBy: [{ inv_dt: 'desc' }, { inv_id: 'desc' }],
      skip: params.page * params.size,
      take: params.size,
      select: {
        inv_id: true,
        inv_type: true,
        inv_no: true,
        reference_no: true,
        inv_dt: true,
        currency: true,
        status: true,
        payment_status: true,
        total_qty: true,
        total_amount: true,
        total_labour_amount: true,
        tbl_factory: { select: { factory_name: true } },
        _count: { select: { tbl_factory_invoice_det: { where: notDeleted } } },
      },
    }),
    erp.tbl_factory_invoice_main.count({ where }),
  ]);
  const byInvoice = comparison
    ? await chartLabourByInvoice(params.companyId, rows.map((r) => r.inv_id), comparison.chart, comparison.options)
    : new Map();

  return {
    content: rows.map((r) => {
      const c = byInvoice.get(r.inv_id);
      return {
      invId: r.inv_id,
      displayNo: `${r.inv_type}-${r.inv_no}`,
      referenceNo: r.reference_no,
      invDt: iso(r.inv_dt),
      factoryName: r.tbl_factory.factory_name,
      currency: r.currency,
      status: r.status,
      paymentStatus: r.payment_status,
      lineCount: r._count.tbl_factory_invoice_det,
      totalQty: num(r.total_qty),
      totalAmount: num(r.total_amount),
      totalLabourAmount: num(r.total_labour_amount),
      // Chart comparison over the invoice's comparable lines; null when none is comparable.
      invoicedCompared: c?.comparableLines ? r2(c.invoicedCompared) : null,
      chartLabour: c?.comparableLines ? r2(c.chart) : null,
      comparableLines: c?.comparableLines ?? 0,
      };
    }),
    totalElements: total,
    page: params.page,
    size: params.size,
  };
}

export type FactoryInvoiceListResponse = Awaited<ReturnType<typeof listFactoryInvoices>>;
