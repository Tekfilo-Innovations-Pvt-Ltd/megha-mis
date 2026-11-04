import ExcelJS from 'exceljs';
import type { MissingCombination, MissingStone } from '@/lib/settingNotInChart';

// Excel download of "Setting not in chart": Summary (reason × commodity),
// Combinations (grouped by ct range) and Detail (one row per stone).

type Column<T> = { header: string; key: keyof T & string; width: number; numFmt?: string };

const SUMMARY: Column<SummaryRow>[] = [
  { header: 'Why no chart value', key: 'issue', width: 40 },
  { header: 'Commodity (ERP)', key: 'commodity', width: 22 },
  { header: 'Combinations', key: 'combinations', width: 13, numFmt: '0' },
  { header: 'Stone Rows', key: 'stoneRows', width: 11, numFmt: '0' },
  { header: 'Pcs', key: 'pcs', width: 10, numFmt: '#,##0.##' },
];

const COMBINATIONS: Column<MissingCombination>[] = [
  { header: 'Why no chart value', key: 'issue', width: 36 },
  { header: 'Commodity (ERP)', key: 'commodity', width: 20 },
  { header: 'Commodity Group (ERP)', key: 'commodityGroup', width: 16 },
  { header: 'Chart Commodity', key: 'chartCommodity', width: 16 },
  { header: 'Shape', key: 'shape', width: 14 },
  { header: 'Chart Rate Group', key: 'rateGroup', width: 16 },
  { header: 'Setting Type (ERP)', key: 'erpSettingType', width: 16 },
  { header: 'Chart Setting Type', key: 'chartSettingType', width: 16 },
  { header: 'Ct Range (per stone)', key: 'ctRange', width: 16 },
  { header: 'MM Size', key: 'mmSize', width: 10 },
  { header: 'Min Ct per Stone', key: 'minCtPerStone', width: 11, numFmt: '0.0000' },
  { header: 'Max Ct per Stone', key: 'maxCtPerStone', width: 11, numFmt: '0.0000' },
  { header: 'Stone Rows', key: 'stoneRows', width: 9, numFmt: '0' },
  { header: 'Invoices', key: 'invoices', width: 9, numFmt: '0' },
  { header: 'Jewellery', key: 'jewellery', width: 9, numFmt: '0' },
  { header: 'Pcs', key: 'pcs', width: 9, numFmt: '#,##0.##' },
  { header: 'Carats', key: 'carats', width: 10, numFmt: '#,##0.000' },
  { header: 'Invoiced Setting Labour', key: 'invoicedSetting', width: 13, numFmt: '#,##0.00' },
  { header: 'First Invoice Date', key: 'firstDate', width: 12, numFmt: 'dd-mmm-yyyy' },
  { header: 'Last Invoice Date', key: 'lastDate', width: 12, numFmt: 'dd-mmm-yyyy' },
  { header: 'Sample Invoices', key: 'sampleInvoices', width: 36 },
  { header: 'Sample Jewellery', key: 'sampleJewellery', width: 36 },
];

const DETAIL: Column<MissingStone>[] = [
  { header: 'Invoice No', key: 'invNo', width: 16 },
  { header: 'Invoice Date', key: 'invDt', width: 12, numFmt: 'dd-mmm-yyyy' },
  { header: 'Factory', key: 'factory', width: 20 },
  { header: 'Jewellery No', key: 'jewNo', width: 14 },
  { header: 'SKU No', key: 'sku', width: 16 },
  { header: 'Product Type', key: 'productType', width: 14 },
  { header: 'Lot Code', key: 'lotCode', width: 16 },
  { header: 'Why no chart value', key: 'issue', width: 36 },
  { header: 'Commodity (ERP)', key: 'commodity', width: 20 },
  { header: 'Commodity Group (ERP)', key: 'commodityGroup', width: 16 },
  { header: 'Chart Commodity', key: 'chartCommodity', width: 16 },
  { header: 'Shape', key: 'shape', width: 14 },
  { header: 'Chart Rate Group', key: 'rateGroup', width: 16 },
  { header: 'Setting Type (ERP)', key: 'erpSettingType', width: 16 },
  { header: 'Setting Type From', key: 'settingTypeSource', width: 11 },
  { header: 'Chart Setting Type', key: 'chartSettingType', width: 16 },
  { header: 'Ct Range (per stone)', key: 'ctRange', width: 16 },
  { header: 'Ct per Stone', key: 'ctPerStone', width: 10, numFmt: '0.0000' },
  { header: 'MM Size', key: 'mmSize', width: 10 },
  { header: 'Pcs', key: 'pcs', width: 8, numFmt: '#,##0.##' },
  { header: 'Carats', key: 'carats', width: 10, numFmt: '0.000' },
  { header: 'Invoiced Setting Labour', key: 'invoicedSetting', width: 13, numFmt: '#,##0.00' },
  { header: 'Currency', key: 'currency', width: 8 },
];

interface SummaryRow {
  issue: string;
  commodity: string;
  combinations: number;
  stoneRows: number;
  pcs: number;
}

const DATE_KEYS = new Set(['invDt', 'firstDate', 'lastDate']);

function addSheet<T extends object>(wb: ExcelJS.Workbook, name: string, columns: Column<T>[], rows: T[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
  for (const r of rows) {
    const values = r as Record<string, unknown>;
    ws.addRow(
      Object.fromEntries(
        columns.map(({ key }) => [key, DATE_KEYS.has(key) && values[key] ? new Date(`${values[key]}T00:00:00Z`) : values[key]]),
      ),
    );
  }
  columns.forEach((c, i) => {
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
  });
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

export async function settingNotInChartWorkbook(combinations: MissingCombination[], missing: MissingStone[], meta: { chartName: string }) {
  const summary = new Map<string, SummaryRow>();
  for (const c of combinations) {
    const k = `${c.issue}|${c.commodity}`;
    const s = summary.get(k) ?? { issue: c.issue, commodity: c.commodity, combinations: 0, stoneRows: 0, pcs: 0 };
    s.combinations++;
    s.stoneRows += c.stoneRows;
    s.pcs = Math.round((s.pcs + c.pcs) * 10000) / 10000;
    summary.set(k, s);
  }

  const wb = new ExcelJS.Workbook();
  addSheet(wb, 'Summary', SUMMARY, Array.from(summary.values()).sort((a, b) => b.pcs - a.pcs));
  addSheet(wb, 'Combinations', COMBINATIONS, combinations);
  addSheet(wb, 'Detail', DETAIL, missing);
  wb.creator = 'MIS';
  wb.title = `Setting not in chart — ${meta.chartName}`;
  return wb.xlsx.writeBuffer();
}
