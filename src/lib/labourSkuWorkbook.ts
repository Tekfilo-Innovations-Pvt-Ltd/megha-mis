import ExcelJS from 'exceljs';
import type { SkuRow } from '@/lib/labourReport';

// Excel download of the report grouped by SKU: one row per SKU.

const COLUMNS: { header: string; key: keyof SkuRow | 'productType'; width: number; numFmt?: string }[] = [
  { header: 'SKU No', key: 'skuNo', width: 18 },
  { header: 'Product Type', key: 'productType', width: 16 },
  { header: 'Jewellery', key: 'jewelleries', width: 10, numFmt: '0' },
  { header: 'Invoices', key: 'invoices', width: 9, numFmt: '0' },
  { header: 'Lines', key: 'lines', width: 8, numFmt: '0' },
  { header: 'Comparable Lines', key: 'comparableLines', width: 11, numFmt: '0' },
  { header: 'Qty (comparable)', key: 'qty', width: 10, numFmt: '0' },
  { header: 'Metal Invoice', key: 'metalInvoiced', width: 13, numFmt: '#,##0.00' },
  { header: 'Metal Chart', key: 'metalChart', width: 13, numFmt: '#,##0.00' },
  { header: 'Setting Invoice', key: 'settingInvoiced', width: 13, numFmt: '#,##0.00' },
  { header: 'Setting Chart', key: 'settingChart', width: 13, numFmt: '#,##0.00' },
  { header: 'Invoice Labour Amount', key: 'invoiced', width: 14, numFmt: '#,##0.00' },
  { header: 'Chart Labour Amount', key: 'chart', width: 14, numFmt: '#,##0.00' },
  { header: 'Difference Amount', key: 'variance', width: 13, numFmt: '#,##0.00;[Red]-#,##0.00' },
  { header: 'Difference %', key: 'variancePct', width: 11, numFmt: '0.0"%";[Red]-0.0"%"' },
  { header: 'Invoice Labour per Pc', key: 'invoicedPerPc', width: 12, numFmt: '#,##0.00' },
  { header: 'Chart Labour per Pc', key: 'chartPerPc', width: 12, numFmt: '#,##0.00' },
  { header: 'Over Chart', key: 'over', width: 8, numFmt: '0' },
  { header: 'Under Chart', key: 'under', width: 8, numFmt: '0' },
  { header: 'In Line', key: 'inLine', width: 8, numFmt: '0' },
  { header: 'Not Comparable', key: 'notComparable', width: 11, numFmt: '0' },
  { header: 'Last Invoice Date', key: 'lastInvDt', width: 12, numFmt: 'dd-mmm-yyyy' },
];

export async function skuReportToWorkbook(skus: SkuRow[], meta: { chartName: string; currency: string }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('By SKU', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  ws.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  for (const s of skus) {
    ws.addRow({
      ...s,
      skuNo: s.skuNo ?? '(no SKU)',
      productType: s.productTypes.join(', '),
      lastInvDt: new Date(`${s.lastInvDt}T00:00:00Z`),
    });
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
  wb.title = `Labour vs Chart by SKU — ${meta.chartName} (${meta.currency})`;
  return wb.xlsx.writeBuffer();
}
