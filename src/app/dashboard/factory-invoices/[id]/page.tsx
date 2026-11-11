'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { FactoryInvoiceDetail } from '@/lib/factoryInvoice';
import type { LineComparison } from '@/lib/labourComparison';
import LineComparisonDetail, { StatusLabel } from '@/components/labour/LineComparisonDetail';
import { fmtDate, fmtNum } from '@/lib/format';

type Line = FactoryInvoiceDetail['lines'][number];
type Lookups = FactoryInvoiceDetail['lookups'];

interface ChartComparison {
  chart: { code: string; name: string; currency: string };
  settingType: string;
  lines: Record<number, LineComparison>;
}

// The invoice's lines compared with the (newest) factory price chart.
async function fetchChartComparison(id: string): Promise<ChartComparison> {
  const res = await fetch(`/api/factory-invoices/${id}/chart-comparison`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Chart comparison unavailable');
  return res.json();
}

async function fetchInvoice(id: string): Promise<FactoryInvoiceDetail> {
  const res = await fetch(`/api/factory-invoices/${id}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Factory invoice not found in the selected company' : 'Failed to load factory invoice');
  return res.json();
}

// Middle section height: the line list and the line detail scroll independently
// inside it, so the header and the bottom sections stay put.
const PANE_HEIGHT = 'lg:h-[calc(100vh-15rem)] lg:min-h-[28rem]';

// ---------- small presentational pieces ----------

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-900 truncate" title={typeof value === 'string' ? value : undefined}>
        {value || value === 0 ? value : '—'}
      </dd>
    </div>
  );
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'amber' | 'green' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-100 text-amber-800',
    green: 'bg-emerald-100 text-emerald-800',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function Table({ headers, rows, empty }: { headers: { label: string; right?: boolean }[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-slate-500 bg-slate-50">
          <tr>
            {headers.map((h) => (
              <th key={h.label} className={`px-3 py-1.5 font-medium whitespace-nowrap ${h.right ? 'text-right' : ''}`}>{h.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j} className={`px-3 py-1.5 whitespace-nowrap ${headers[j]?.right ? 'text-right tabular-nums' : ''}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- header (2 rows) ----------

function InvoiceHeader({ data }: { data: FactoryInvoiceDetail }) {
  const { invoice, factory, lines } = data;
  return (
    <header className="bg-white rounded-xl border border-slate-200 px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href="/dashboard/factory-invoices" className="text-slate-400 hover:text-slate-700" aria-label="Back to factory invoices">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold text-slate-900">{invoice.displayNo}</h1>
        <span className="text-slate-600">{factory.factoryName}</span>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {invoice.status && <Badge tone="amber">{invoice.status}</Badge>}
          {invoice.paymentStatus && <Badge tone="green">{invoice.paymentStatus}</Badge>}
          {invoice.accountingStatus && <Badge>{invoice.accountingStatus}</Badge>}
        </div>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-4 gap-y-2">
        <Field label="Date" value={fmtDate(invoice.invDt)} />
        <Field label="Due" value={fmtDate(invoice.invDueDt)} />
        <Field label="Terms" value={`${fmtNum(invoice.dueMonths, 0)}m ${fmtNum(invoice.dueDays, 0)}d`} />
        <Field label="Currency" value={`${invoice.currency} @ ${fmtNum(invoice.exchangeRate, 4)}`} />
        <Field label="Reference" value={invoice.referenceNo} />
        <Field label="Export inv no" value={invoice.exportInvNo} />
        <Field label="Custom status" value={invoice.customInvStatus} />
        <Field label="Lines" value={lines.length} />
      </dl>
    </header>
  );
}

// ---------- middle: line list (left) ----------

function LineList({
  lines,
  lookups,
  selectedId,
  onSelect,
  comparisons,
}: {
  lines: Line[];
  lookups: Lookups;
  selectedId: number | null;
  onSelect: (id: number) => void;
  comparisons?: Record<number, LineComparison>;
}) {
  return (
    <section className={`bg-white rounded-xl border border-slate-200 flex flex-col max-h-96 ${PANE_HEIGHT}`}>
      <header className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900 text-sm">Lines</h2>
        <span className="text-xs text-slate-500">{lines.length}</span>
      </header>
      {lines.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">This invoice has no lines.</p>
      ) : (
        <ul className="overflow-y-auto divide-y divide-slate-100">
          {lines.map((line) => {
            const jew = lookups.jewellery[line.jewId];
            const selected = line.invDetId === selectedId;
            return (
              <li key={line.invDetId}>
                <button
                  onClick={() => onSelect(line.invDetId)}
                  className={`w-full text-left px-4 py-2 border-l-4 ${selected ? 'border-amber-600 bg-amber-50' : 'border-transparent hover:bg-slate-50'}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-900 truncate">{jew?.jewNo ?? line.jewId}</span>
                    <span className="text-xs text-slate-500 tabular-nums shrink-0">Qty {fmtNum(line.invQty, 0)}</span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">{jew?.skuNo || jew?.designNo || '—'}</div>
                  <div className="flex justify-between text-xs text-slate-600 tabular-nums mt-0.5">
                    <span>{fmtNum(line.grossWt, 3)} g</span>
                    <span>COGS {fmtNum(line.totalCogsAmount)}</span>
                  </div>
                  {comparisons?.[line.invDetId] && comparisons[line.invDetId].status !== 'NOT_COMPARABLE' && (
                    <div className="text-xs mt-0.5"><StatusLabel status={comparisons[line.invDetId].status} /></div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------- middle: selected line detail (right) ----------

const CHILD_TABS = ['Labour', 'Charges', 'Metal rates', 'Notes & gross wt'] as const;

function ComponentsTable({ line, lookups }: { line: Line; lookups: Lookups }) {
  const lot = (id: number) => lookups.lots[id];
  return (
    <Table
      empty="No components on this line."
      headers={[
        { label: 'Lot' }, { label: 'Commodity' }, { label: 'Shape' }, { label: 'Size' }, { label: 'Setting' },
        { label: 'Consumed', right: true }, { label: 'Broken', right: true }, { label: 'Loss', right: true }, { label: 'Return', right: true },
        { label: 'Total', right: true }, { label: 'Rate', right: true }, { label: 'Amount', right: true }, { label: 'Setting amt', right: true },
        { label: 'COGS', right: true },
      ]}
      rows={line.components.map((c) => [
        <span key="lot">
          {lot(c.lotId)?.lotCode ?? c.lotId}
          {c.isCenterStone && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">center</span>}
          {c.consumeLotId !== c.lotId && (
            <span className="block text-xs text-slate-400">from {lot(c.consumeLotId)?.lotCode ?? c.consumeLotId}</span>
          )}
        </span>,
        lot(c.lotId)?.commodity ?? '—',
        c.shapeId != null ? lookups.shapes[c.shapeId] ?? c.shapeId : '—',
        [c.stoneSize, c.sieveSize, c.mmSize && `${c.mmSize} mm`].filter(Boolean).join(' · ') || '—',
        c.settingTypeId != null ? lookups.settingTypes[c.settingTypeId] ?? c.settingTypeId : '—',
        `${fmtNum(c.consumedQty1, 3)} ${c.uom1}`,
        fmtNum(c.brokenQty1, 3),
        fmtNum(c.lossQty1, 3),
        fmtNum(c.returnQty1, 3),
        <span key="total">
          {fmtNum(c.totalQty1, 3)} {c.uom1}
          {c.uom2 && <span className="block text-xs text-slate-400">{fmtNum(c.totalQty2, 3)} {c.uom2}</span>}
        </span>,
        fmtNum(c.actualRate),
        fmtNum(c.actualAmount),
        fmtNum(c.settingAmount),
        fmtNum(c.cogsAmount),
      ])}
    />
  );
}

function ChartComparisonSection({ comparison, chart }: { comparison: LineComparison | undefined; chart: ChartComparison['chart'] | undefined }) {
  const [open, setOpen] = useState(true);
  if (!comparison || !chart) return null;
  return (
    <div className="rounded-lg border border-slate-200">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
        <span className="text-xs font-semibold text-slate-500 uppercase">Chart comparison</span>
        <span className="text-xs text-slate-500 truncate">{chart.name}</span>
        <span className="ml-auto text-xs"><StatusLabel status={comparison.status} /></span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <LineComparisonDetail comparison={comparison} currency={chart.currency} />
        </div>
      )}
    </div>
  );
}

function LineDetail({
  line,
  lookups,
  comparison,
  chart,
}: {
  line: Line;
  lookups: Lookups;
  comparison?: LineComparison;
  chart?: ChartComparison['chart'];
}) {
  const [tab, setTab] = useState<(typeof CHILD_TABS)[number]>('Labour');
  const jew = lookups.jewellery[line.jewId];
  const counts: Record<(typeof CHILD_TABS)[number], number> = {
    Labour: line.labour.length,
    Charges: line.charges.length,
    'Metal rates': line.metalRates.length,
    'Notes & gross wt': line.notes.length + line.grossWtBreakup.length,
  };

  return (
    <section className={`bg-white rounded-xl border border-slate-200 flex flex-col ${PANE_HEIGHT}`}>
      <header className="px-4 py-2.5 border-b border-slate-100">
        <h2 className="font-semibold text-slate-900 text-sm">
          {jew?.jewNo ?? line.jewId}
          {jew?.description && <span className="ml-2 font-normal text-slate-500">{jew.description}</span>}
        </h2>
      </header>

      <div className="overflow-y-auto p-4 space-y-4">
        {/* Line values not shown in the compact list */}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
          <Field label="SKU" value={jew?.skuNo} />
          <Field label="Design" value={jew?.designNo} />
          <Field label="Bin" value={lookups.bins[line.binId] ?? line.binId} />
          <Field label="Qty" value={fmtNum(line.invQty, 0)} />
          <Field label="Gross wt" value={fmtNum(line.grossWt, 3)} />
          <Field label="Physical gross wt" value={fmtNum(line.physicalGrossWt, 3)} />
          <Field label="Labour amount" value={fmtNum(line.labourAmount)} />
          <Field label="Other charges" value={fmtNum(line.totalOtherChargesAmount)} />
          <Field label="COGS" value={fmtNum(line.totalCogsAmount)} />
          <Field label="PP amount" value={fmtNum(line.totalPpAmount)} />
          <Field label="Base price" value={`${fmtNum(line.basePrice)}${line.basePriceCode ? ` (${line.basePriceCode})` : ''}`} />
          <Field label="Sales price" value={`${fmtNum(line.salesPrice)}${line.salesPriceCode ? ` (${line.salesPriceCode})` : ''}`} />
          <Field label="Admin %" value={fmtNum(line.adminPct)} />
        </dl>

        {/* Metal Chart against the line's metal, Setting Chart against each stone */}
        <ChartComparisonSection comparison={comparison} chart={chart} />

        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1.5">
            Components <span className="font-normal">({line.components.length})</span>
          </h3>
          <ComponentsTable line={line} lookups={lookups} />
        </div>

        <div>
          <div className="flex flex-wrap gap-1 mb-2">
            {CHILD_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-full text-xs font-medium ${tab === t ? 'bg-amber-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`}
              >
                {t} <span className="opacity-70">({counts[t]})</span>
              </button>
            ))}
          </div>

          {tab === 'Labour' && (
            <Table
              empty="No labour on this line."
              headers={[{ label: 'Process' }, { label: 'Description' }, { label: 'Qty', right: true }, { label: 'Rate', right: true }, { label: 'Amount', right: true }, { label: 'Input', right: true }]}
              rows={line.labour.map((l) => [
                lookups.processes[l.processId] ?? l.processId,
                l.description || '—',
                fmtNum(l.qty, 3),
                fmtNum(l.rate),
                fmtNum(l.amount),
                l.inputCurrency ? `${fmtNum(l.inputAmount)} ${l.inputCurrency}` : '—',
              ])}
            />
          )}

          {tab === 'Charges' && (
            <Table
              empty="No other charges on this line."
              headers={[{ label: 'Charge' }, { label: 'Type' }, { label: 'Pcs', right: true }, { label: 'Rate', right: true }, { label: 'Amount', right: true }]}
              rows={line.charges.map((c) => [
                <span key="name">{c.chargeName || `#${c.chargeId}`}{c.isHandling && <span className="ml-1 text-xs text-slate-400">(handling)</span>}</span>,
                c.chargeType || '—',
                fmtNum(c.chargePcs, 0),
                fmtNum(c.chargeRate),
                fmtNum(c.chargeAmt),
              ])}
            />
          )}

          {tab === 'Metal rates' && (
            <Table
              empty="No metal rates on this line."
              headers={[{ label: 'Metal' }, { label: 'Rate', right: true }, { label: 'UOM' }, { label: 'Rate loss %', right: true }, { label: 'Loss %', right: true }]}
              rows={line.metalRates.map((m) => [m.metal, fmtNum(m.rate), m.uom || '—', fmtNum(m.rateLossPct), fmtNum(m.lossPct)])}
            />
          )}

          {tab === 'Notes & gross wt' && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Production notes</h4>
                {line.notes.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
                  <ul className="text-sm space-y-1">{line.notes.map((n) => <li key={n.noteId}>{n.note || '—'}</li>)}</ul>
                )}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Gross weight breakup</h4>
                {line.grossWtBreakup.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
                  <ul className="text-sm space-y-1 tabular-nums">{line.grossWtBreakup.map((g) => <li key={g.breakupId}>{fmtNum(g.grossWt, 3)}</li>)}</ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- bottom sections ----------

function TotalRow({ label, total, digits = 2 }: { label: string; total: { stored: number | null; computed: number | null }; digits?: number }) {
  const differs = total.stored != null && total.computed != null && Math.abs(total.stored - total.computed) > 0.005;
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1.5 pr-4 text-slate-600">{label}</td>
      <td className="py-1.5 pr-4 text-right tabular-nums">{fmtNum(total.stored, digits)}</td>
      <td className={`py-1.5 text-right tabular-nums ${differs ? 'text-red-600 font-semibold' : ''}`}>
        {fmtNum(total.computed, digits)}
        {differs && <span className="ml-1 text-xs font-normal">≠ stored</span>}
      </td>
    </tr>
  );
}

const MODEL = [
  { entity: 'Factory Invoice', table: 'tbl_factory_invoice_main', key: 'inv_id', refs: 'factory_id → Factory' },
  { entity: 'Factory', table: 'tbl_factory', key: 'factory_id', refs: '' },
  { entity: 'Invoice Line', table: 'tbl_factory_invoice_det', key: 'inv_det_id', refs: 'inv_id → Invoice, jew_id → Jewellery, bin_id → Bin' },
  { entity: 'Component', table: 'tbl_factory_invoice_component', key: 'component_id', refs: 'inv_det_id → Line, lot_id / consume_lot_id → Lot, shape_id, setting_type_id' },
  { entity: 'Labour', table: 'tbl_factory_invoice_labour', key: 'factory_invoice_labour_id', refs: 'inv_det_id → Line, process_id → Process' },
  { entity: 'Other Charge', table: 'tbl_factory_invoice_chgs', key: 'map_id', refs: 'inv_det_id → Line' },
  { entity: 'Production Note', table: 'tbl_factory_invoice_prod_note', key: 'note_id', refs: 'inv_det_id → Line' },
  { entity: 'Gross Wt Breakup', table: 'tbl_factory_invoice_gross_wt_breakup', key: 'gross_wt_breakup_id', refs: 'inv_det_id → Line' },
  { entity: 'Document', table: 'tbl_factory_invoice_document', key: 'document_id', refs: 'inv_id → Invoice' },
  { entity: 'Labour Invoice', table: 'tbl_factory_invoice_labour_main', key: 'inv_id', refs: 'ref_inv_id → Invoice (no FK in ERP)' },
];

function DataModelPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-slate-900 text-slate-200 rounded-xl">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
        {open ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
        <span className="font-semibold text-sm">Data model (3rd normal form)</span>
        <span className="text-xs text-slate-400">how this screen reshapes the ERP tables</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 text-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="pr-4 py-1.5 font-medium">Entity</th>
                  <th className="pr-4 py-1.5 font-medium">ERP table</th>
                  <th className="pr-4 py-1.5 font-medium">Key</th>
                  <th className="py-1.5 font-medium">References</th>
                </tr>
              </thead>
              <tbody>
                {MODEL.map((m) => (
                  <tr key={m.table} className="border-t border-slate-800">
                    <td className="pr-4 py-1.5 text-white">{m.entity}</td>
                    <td className="pr-4 py-1.5 font-mono text-xs">{m.table}</td>
                    <td className="pr-4 py-1.5 font-mono text-xs text-amber-300">{m.key}</td>
                    <td className="py-1.5 text-slate-300">{m.refs || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-slate-300">
            <li>
              <b className="text-white">Removed transitive dependencies:</b> component, labour, charge, note and gross-wt rows also store{' '}
              <code>inv_id</code> (and component stores <code>jew_id</code>), which already follow from <code>inv_det_id</code>. They are dropped
              here, and each child sits under its line only. Every copy matches its line across the whole tenant.
            </li>
            <li>
              <b className="text-white">Lookups are separate entities:</b> jewellery, lot/commodity, bin, process, shape and setting type are stored
              once and referenced by id.
            </li>
            <li>
              <b className="text-white">Derived totals:</b> the header&apos;s stored totals are shown next to values recalculated from the lines.
            </li>
            <li>
              <b className="text-white">Not normalised:</b> <code>charge_name</code> stays on the charge row because the ERP has no charge master
              table to join to.
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------- page ----------

export default function FactoryInvoiceDetailPage({ params }: { params: { id: string } }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['factory-invoice', params.id], queryFn: () => fetchInvoice(params.id) });
  // Loaded separately so the invoice shows straight away even if no chart exists.
  const chartComparison = useQuery({ queryKey: ['factory-invoice-chart', params.id], queryFn: () => fetchChartComparison(params.id), retry: false });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (isLoading) return <p className="text-slate-500">Loading invoice…</p>;
  if (error || !data) return <p className="text-red-600">{(error as Error)?.message ?? 'Failed to load factory invoice'}</p>;

  const { invoice, factory, lines, lookups, totals, documents, labourInvoices } = data;
  const selected = lines.find((l) => l.invDetId === selectedId) ?? lines[0];

  return (
    <div className="space-y-4">
      <InvoiceHeader data={data} />

      <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)] gap-4">
        <LineList
          lines={lines}
          lookups={lookups}
          selectedId={selected?.invDetId ?? null}
          onSelect={setSelectedId}
          comparisons={chartComparison.data?.lines}
        />
        {selected ? (
          // key resets the child tab when switching lines
          <LineDetail
            key={selected.invDetId}
            line={selected}
            lookups={lookups}
            comparison={chartComparison.data?.lines[selected.invDetId]}
            chart={chartComparison.data?.chart}
          />
        ) : (
          <section className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-500">No line selected.</section>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Totals" subtitle="Stored on the header vs calculated from the lines">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-left">
              <tr>
                <th className="pb-1 font-medium" />
                <th className="pb-1 pr-4 font-medium text-right">Stored</th>
                <th className="pb-1 font-medium text-right">Calculated</th>
              </tr>
            </thead>
            <tbody>
              <TotalRow label="Quantity" total={totals.qty} digits={0} />
              <TotalRow label="Labour amount" total={totals.labourAmount} />
              <TotalRow label="Invoice amount" total={totals.amount} />
              <TotalRow label="Paid amount" total={totals.paidAmount} />
              <TotalRow label="COGS" total={totals.cogsAmount} />
              <TotalRow label="Other charges" total={totals.otherCharges} />
              <TotalRow label="Gross weight" total={totals.grossWt} digits={3} />
            </tbody>
          </table>
        </Card>

        <Card title="Documents" subtitle="tbl_factory_invoice_document">
          <Table
            empty="No documents attached."
            headers={[{ label: 'Type' }, { label: 'Name' }, { label: 'Link' }]}
            rows={documents.map((d) => [
              d.documentType,
              d.documentName || '—',
              d.documentUrl ? (
                <a key="url" href={d.documentUrl} target="_blank" rel="noreferrer" className="text-amber-700 hover:underline">Open</a>
              ) : '—',
            ])}
          />
        </Card>

        <Card title="Labour invoices" subtitle="tbl_factory_invoice_labour_main (ref_inv_id)">
          <Table
            empty="No labour invoices raised against this invoice."
            headers={[{ label: 'Labour invoice' }, { label: 'Date' }, { label: 'Status' }, { label: 'Amount', right: true }]}
            rows={labourInvoices.map((l) => [
              l.displayNo,
              fmtDate(l.invDt),
              [l.status, l.paymentStatus].filter(Boolean).join(' / ') || '—',
              `${fmtNum(l.labourAmountLocal)} ${l.currency}`,
            ])}
          />
        </Card>
      </div>

      {(invoice.note || invoice.termsConditions || factory.email || factory.phoneNo) && (
        <Card title="Notes & factory contact">
          <dl className="grid sm:grid-cols-4 gap-4">
            <Field label="Note" value={invoice.note} />
            <Field label="Terms & conditions" value={invoice.termsConditions} />
            <Field label="Factory email" value={factory.email} />
            <Field label="Factory phone" value={factory.phoneNo} />
          </dl>
        </Card>
      )}

      <DataModelPanel />
    </div>
  );
}
