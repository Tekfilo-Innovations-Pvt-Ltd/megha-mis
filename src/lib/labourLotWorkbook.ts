import ExcelJS from 'exceljs';
import { lotNoteText, type LotGroup, type LotRowKind } from '@/lib/labourLotReport';
import { addJobWorkSheet } from '@/lib/labourJobWorkSheet';

// Excel download of the lot-detail report: a "Job Work Details" sheet in the
// ERP report's layout (src/lib/labourJobWorkSheet.ts), then one row per lot
// with the line's columns repeated on every row so it can be filtered and pivoted.

const KIND_TEXT: Record<LotRowKind, string> = {
  METAL: 'Metal labour',
  SETTING: 'Setting',
  SETTING_LINE: 'Setting (line)',
  OTHER: 'Other labour',
};

const COLUMNS: { header: string; key: string; width: number; numFmt?: string }[] = [
  // ERP invoice line id — one invoice can list the same jewellery on many lines.
  { header: 'Line ID', key: 'invDetId', width: 9, numFmt: '0' },
  { header: 'Invoice No', key: 'invNo', width: 16 },
  { header: 'Invoice Date', key: 'invDt', width: 12, numFmt: 'dd-mmm-yyyy' },
  { header: 'Factory', key: 'factory', width: 20 },
  { header: 'Jewellery No', key: 'jewNo', width: 14 },
  { header: 'Bag No', key: 'bagNo', width: 11 },
  { header: 'SKU No', key: 'skuNo', width: 16 },
  { header: 'Product Type', key: 'productType', width: 14 },
  { header: 'Job Category', key: 'jobCategory', width: 12 },
  { header: 'Qty', key: 'qty', width: 7, numFmt: '0' },
  { header: 'Gross Wt (g)', key: 'grossWt', width: 11, numFmt: '0.000' },
  { header: 'Net Wt (g)', key: 'netWt', width: 11, numFmt: '0.000' },
  { header: 'Diamond Wt (ct)', key: 'diamondWt', width: 12, numFmt: '0.000' },
  { header: 'Color Stone Wt (ct)', key: 'colorStoneWt', width: 14, numFmt: '0.000' },
  { header: 'Labour', key: 'kind', width: 13 },
  { header: 'Lot Code', key: 'lotCode', width: 16 },
  { header: 'Commodity', key: 'commodity', width: 20 },
  { header: 'Item', key: 'item', width: 26 },
  { header: 'Setting Type', key: 'settingType', width: 13 },
  { header: 'Chart Size / Range', key: 'size', width: 18 },
  { header: 'Qty Wt', key: 'wt', width: 10, numFmt: '0.000' },
  { header: 'Wt UOM', key: 'wtUom', width: 7 },
  { header: 'Qty Pcs', key: 'pcs', width: 8, numFmt: '0' },
  { header: 'Wt per Stone (ct)', key: 'perStoneWt', width: 12, numFmt: '0.0000' },
  { header: 'Invoice Labour Rate', key: 'invoiceRate', width: 12, numFmt: '#,##0.0000' },
  { header: 'Invoice Labour Amount', key: 'invoiceAmount', width: 13, numFmt: '#,##0.00' },
  { header: 'Chart Labour Rate', key: 'chartRate', width: 12, numFmt: '#,##0.0000' },
  { header: 'Chart Labour Amount', key: 'chartAmount', width: 13, numFmt: '#,##0.00' },
  { header: 'Difference Amount', key: 'variance', width: 12, numFmt: '#,##0.00;[Red]-#,##0.00' },
  { header: 'Difference %', key: 'variancePct', width: 11, numFmt: '0.0"%";[Red]-0.0"%"' },
  { header: 'Line Status', key: 'status', width: 13 },
  { header: 'Note', key: 'note', width: 40 },
];

export async function lotReportToWorkbook(groups: (LotGroup & { status: string })[], meta: { chartName: string; currency: string }) {
  const wb = new ExcelJS.Workbook();
  addJobWorkSheet(wb, groups);
  const ws = wb.addWorksheet('Labour vs Chart', { views: [{ state: 'frozen', ySplit: 1, xSplit: 5 }] });
  ws.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  for (const g of groups) {
    const l = g.line;
    for (const r of g.rows) {
      ws.addRow({
        invDetId: l.invDetId,
        invNo: l.invNo,
        invDt: new Date(`${l.invDt}T00:00:00Z`),
        factory: l.factoryName,
        jewNo: l.jewNo,
        bagNo: l.bagNo,
        skuNo: l.skuNo,
        productType: l.productType,
        jobCategory: l.jobCategory,
        qty: l.qty,
        grossWt: l.grossWt,
        netWt: l.netWt,
        diamondWt: l.diamondWt,
        colorStoneWt: l.colorStoneWt,
        kind: KIND_TEXT[r.kind],
        lotCode: r.lotCode,
        commodity: r.commodity,
        item: r.item,
        settingType: r.settingType,
        size: r.size,
        wt: r.wt,
        wtUom: r.wtUom,
        pcs: r.pcs,
        perStoneWt: r.perStoneWt,
        invoiceRate: r.invoiceRate,
        invoiceAmount: r.invoiceAmount,
        chartRate: r.chartRate,
        chartAmount: r.chartAmount,
        variance: r.variance,
        variancePct: r.variancePct,
        status: g.status.replace('_', ' ').toLowerCase(),
        note: [l.grossWtCalculated ? 'Gross wt calculated (net + ct ÷ 5)' : null, lotNoteText(r.notes)].filter(Boolean).join('; ') || null,
      });
    }
  }
  COLUMNS.forEach((c, i) => {
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
  });
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  wb.creator = 'MIS';
  wb.title = `Labour vs Chart — ${meta.chartName} (${meta.currency})`;
  return wb.xlsx.writeBuffer();
}
