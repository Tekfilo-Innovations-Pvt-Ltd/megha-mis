import type ExcelJS from 'exceljs';
import { jobWorkBlock, jobWorkTotals, missingSide, rangeText, stoneSetting } from '@/lib/jobWorkBlocks';
import type { LotGroup, LotRow } from '@/lib/labourLotReport';

// "Job Work Details" sheet of the lot-detail Excel, in the layout of the ERP's
// Job Work Details report: one block per jewellery with metal, colour stone,
// diamond and labour breakups side by side, invoice vs chart labour totals and
// their difference. An amount with nothing on the other side is shaded, as is
// that jewellery's difference, and Remarks says what is missing.

const AMOUNT = '#,##0.00';
const DIFF = '#,##0.00;[Red]-#,##0.00';
const PCT = '0.00%;[Red]-0.00%';
const WT = '#,##0.000';
const MISSING_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFEF3C7' } }; // light amber

const colLetters = (n: number): string => (n > 26 ? colLetters(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));

// The columns in order, as [key, width] — a key with two widths is a pair of
// columns merged into one cell, as in the ERP sample (S.No, SKU No, Size,
// colour stone Master Lot Code). Letters are worked out from this order, so a
// column can be added without renumbering the rest.
const LAYOUT = [
  ['sNo', [3, 6]], ['invNo', [14]], ['invDt', [11]], ['soNo', [11]], ['jobNo', [10]], ['bagNo', [10]], ['sku', [13, 2]], ['category', [11]], ['size', [3, 7]],
  ['qty', [6]], ['grossWt', [10]],
  ['metal', [10]], ['metalLot', [14]], ['metalWt', [11]],
  ['csLot', [19]], ['csMaster', [11, 8]], ['csCommodity', [19]], ['csShape', [13]], ['csMm', [11]], ['csPcs', [9]], ['csWt', [10]],
  ['csInvRate', [11]], ['csInvAmt', [11]], ['csChartRate', [11]], ['csChartAmt', [11]],
  ['dLot', [19]], ['dMaster', [19]], ['dCommodity', [19]], ['dShape', [13]], ['dMm', [11]], ['dPcs', [9]], ['dWt', [10]],
  ['dInvRate', [11]], ['dInvAmt', [11]], ['dChartRate', [11]], ['dChartAmt', [11]],
  ['labour', [22]], ['labourInv', [12]], ['labourChart', [12]],
  ['totalInv', [13]], ['totalChart', [13]], ['diff', [13]], ['diffPct', [11]], ['remarks', [45]],
] as const;
type Key = (typeof LAYOUT)[number][0];

const C = {} as Record<Key, string>;
const PAIRS: Partial<Record<string, string>> = {};
const WIDTHS: Record<string, number> = {};
let nextCol = 1;
for (const [key, widths] of LAYOUT) {
  C[key] = colLetters(nextCol);
  widths.forEach((w, i) => (WIDTHS[colLetters(nextCol + i)] = w));
  if (widths.length > 1) PAIRS[C[key]] = colLetters(nextCol + 1);
  nextCol += widths.length;
}
const LAST = colLetters(nextCol - 1);

const GROUPS: [string, string, string][] = [
  [C.metal, C.metalWt, 'Metal Details - Breakup'],
  [C.csLot, C.csChartAmt, 'Color Stone Details'],
  [C.dLot, C.dChartAmt, 'Diamond Details'],
  [C.labour, C.labourChart, 'Labour Breakup - Row wise'],
];

// Columns that span both header rows and, in the body, the whole jewellery block.
const LINE_COLUMNS: [string, string][] = [
  [C.sNo, 'S.No'], [C.invNo, 'Job Work\nInvoice No'], [C.invDt, 'Invoice\nDate'], [C.soNo, 'SO No'], [C.jobNo, 'Job No'], [C.bagNo, 'Bag No'],[C.sku, 'SKU No'], [C.category, 'Jewellery\nCategory'], [C.size, 'Size'],
  [C.qty, 'Qty'], [C.grossWt, 'Gross\nWt(g)'],
  [C.totalInv, 'Total Invoice Labor\nAmount'], [C.totalChart, 'Total Chart Labor\nAmount'], [C.diff, 'Difference\nAmount'], [C.diffPct, 'Difference\n%'],
  [C.remarks, 'Remarks'],
];

const STONE_HEADERS = ['Lot Code', 'Master Lot Code', 'Commodity', 'Shape', 'MM Size', 'PCS', 'Stone Wt', 'Invoice Setting Rate', 'Invoice Setting Amt', 'Chart Setting Rate', 'Chart Setting Amt'];
const SUB_HEADERS: [string, string][] = [
  [C.metal, 'Metal'], [C.metalLot, 'Metal Lot Code'], [C.metalWt, 'Metal Wt'],
  ...STONE_HEADERS.map((h, i): [string, string] => [[C.csLot, C.csMaster, C.csCommodity, C.csShape, C.csMm, C.csPcs, C.csWt, C.csInvRate, C.csInvAmt, C.csChartRate, C.csChartAmt][i], h]),
  ...STONE_HEADERS.map((h, i): [string, string] => [[C.dLot, C.dMaster, C.dCommodity, C.dShape, C.dMm, C.dPcs, C.dWt, C.dInvRate, C.dInvAmt, C.dChartRate, C.dChartAmt][i], h]),
  [C.labour, 'Labour Type'], [C.labourInv, 'Invoice Amount'], [C.labourChart, 'Chart Amount'],
];

const FORMATS: Partial<Record<string, string>> = {
  [C.invDt]: 'dd-mmm-yyyy', [C.qty]: '0', [C.grossWt]: WT, [C.metalWt]: WT,
  [C.csPcs]: '#,##0.##', [C.csWt]: WT, [C.csInvRate]: AMOUNT, [C.csInvAmt]: AMOUNT, [C.csChartRate]: AMOUNT, [C.csChartAmt]: AMOUNT,
  [C.dPcs]: '#,##0.##', [C.dWt]: WT, [C.dInvRate]: AMOUNT, [C.dInvAmt]: AMOUNT, [C.dChartRate]: AMOUNT, [C.dChartAmt]: AMOUNT,
  [C.labourInv]: AMOUNT, [C.labourChart]: AMOUNT, [C.totalInv]: AMOUNT, [C.totalChart]: AMOUNT, [C.diff]: DIFF, [C.diffPct]: PCT,
};

const colIndex = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

const FONT = { name: 'Arial', size: 10 };
const BORDER = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

// ExcelJS's mergeCells checks every new merge against all earlier ones, which
// is quadratic — a few thousand lines (tens of thousands of merges) took over
// ten minutes. The blocks never overlap, so do what it does minus that check:
// point the cells at the top-left one and record the range it writes out.
function merge(ws: ExcelJS.Worksheet, from: string, to: string) {
  if (from === to) return;
  const master = ws.getCell(from);
  const [top, left] = [Number(master.row), Number(master.col)];
  const end = ws.getCell(to);
  for (let r = top; r <= Number(end.row); r++) {
    for (let c = left; c <= Number(end.col); c++) {
      if (r > top || c > left) ws.getCell(r, c).merge(master, true);
    }
  }
  (ws as unknown as { _merges: Record<string, { range: string }> })._merges[master.address] = { range: `${from}:${to}` };
}

export function addJobWorkSheet(wb: ExcelJS.Workbook, groups: LotGroup[]) {
  const ws = wb.addWorksheet('Job Work Details', { views: [{ state: 'frozen', ySplit: 2, xSplit: 4 }] });
  for (let i = 1; i <= colIndex(LAST); i++) ws.getColumn(i).width = WIDTHS[colLetters(i)] ?? 11;

  // ---- header ----
  for (const [col, text] of LINE_COLUMNS) {
    ws.getCell(`${col}1`).value = text;
    merge(ws, `${col}1`, `${PAIRS[col] ?? col}2`);
  }
  for (const [from, to, text] of GROUPS) {
    ws.getCell(`${from}1`).value = text;
    merge(ws, `${from}1`, `${to}1`);
  }
  for (const [col, text] of SUB_HEADERS) {
    ws.getCell(`${col}2`).value = text;
    merge(ws, `${col}2`, `${PAIRS[col] ?? col}2`);
  }
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 30;

  // ---- one block per jewellery ----
  let row = 3;
  const blocks = groups.map(jobWorkBlock);
  const shaded: string[] = []; // cells to fill light amber once the sheet is styled
  blocks.forEach((b, i) => {
    const l = b.group.line;
    const { colour, diamonds, labour, height } = b;
    const lineValues: [string, unknown][] = [
      [C.sNo, i + 1], [C.invNo, l.invNo], [C.invDt, new Date(`${l.invDt}T00:00:00Z`)], [C.soNo, l.soNo], [C.jobNo, l.jewNo], [C.bagNo, l.bagNo],[C.sku, l.skuNo], [C.category, l.productType], [C.size, l.size],
      [C.qty, l.qty], [C.grossWt, l.grossWt],
      [C.totalInv, b.invoiceTotal], [C.totalChart, b.chartTotal], [C.diff, b.difference], [C.diffPct, b.differencePct],
      [C.remarks, b.remarks || null],
    ];
    if (b.incomplete) shaded.push(`${C.diff}${row}`, `${C.diffPct}${row}`);
    for (const [col, value] of lineValues) {
      ws.getCell(`${col}${row}`).value = value as ExcelJS.CellValue;
      merge(ws, `${col}${row}`, `${PAIRS[col] ?? col}${row + height - 1}`);
    }

    l.metals.forEach((m, k) => {
      ws.getCell(`${C.metal}${row + k}`).value = m.commodity;
      ws.getCell(`${C.metalLot}${row + k}`).value = m.lotCode;
      ws.getCell(`${C.metalWt}${row + k}`).value = m.grams;
    });
    const stoneCells = (list: LotRow[], cols: string[]) =>
      list.forEach((s, k) => {
        const set = stoneSetting(s);
        const values = [s.lotCode, s.masterLotCode, s.commodity, s.item, s.mmSize, s.pcs, s.wt, set.invoiceRate, set.invoiceAmount, set.chartRate, set.chartAmount];
        cols.forEach((col, j) => (ws.getCell(`${col}${row + k}`).value = values[j]));
        const missing = missingSide(s);
        if (missing === 'invoice') shaded.push(`${cols[7]}${row + k}`, `${cols[8]}${row + k}`);
        if (missing === 'chart') shaded.push(`${cols[9]}${row + k}`, `${cols[10]}${row + k}`);
      });
    stoneCells(colour, [C.csLot, C.csMaster, C.csCommodity, C.csShape, C.csMm, C.csPcs, C.csWt, C.csInvRate, C.csInvAmt, C.csChartRate, C.csChartAmt]);
    stoneCells(diamonds, [C.dLot, C.dMaster, C.dCommodity, C.dShape, C.dMm, C.dPcs, C.dWt, C.dInvRate, C.dInvAmt, C.dChartRate, C.dChartAmt]);
    labour.forEach((x, k) => {
      ws.getCell(`${C.labour}${row + k}`).value = x.process;
      ws.getCell(`${C.labourInv}${row + k}`).value = x.invoiceAmount;
      ws.getCell(`${C.labourChart}${row + k}`).value = x.chartAmount ?? (x.chartRange ? rangeText(x.chartRange) : null);
      const missing = x.chartRange ? null : missingSide(x);
      if (missing) shaded.push(`${missing === 'invoice' ? C.labourInv : C.labourChart}${row + k}`);
    });
    for (let k = 0; k < height; k++) merge(ws, `${C.csMaster}${row + k}`, `${PAIRS[C.csMaster]}${row + k}`);
    row += height;
  });

  // ---- total row ----
  const t = jobWorkTotals(blocks);
  const total = row;
  ws.getCell(`A${total}`).value = 'Total';
  merge(ws, `A${total}`, `${PAIRS[C.size]}${total}`);
  const totalValues: [string, number | null][] = [
    [C.qty, t.qty], [C.grossWt, t.grossWt], [C.metalWt, t.metalWt],
    [C.csPcs, t.colourPcs], [C.csWt, t.colourWt], [C.dPcs, t.diamondPcs], [C.dWt, t.diamondWt],
    [C.totalInv, t.invoiceTotal], [C.totalChart, t.chartTotal], [C.diff, t.difference], [C.diffPct, t.differencePct],
  ];
  for (const [col, value] of totalValues) ws.getCell(`${col}${total}`).value = value;
  merge(ws, `${C.csMaster}${total}`, `${PAIRS[C.csMaster]}${total}`);

  // ---- styling ----
  // One shared style object per kind of cell. Giving each of the millions of
  // cells its own font / border / alignment objects took ~3 GB and minutes for
  // a large company (RT, 9,000 lines). Shared objects must never be changed
  // through a cell, so shading picks its own preset instead of setting .fill.
  const shadedCells = new Set(shaded);
  const presets = new Map<string, Partial<ExcelJS.Style>>();
  const preset = (head: boolean, bold: boolean, horizontal: 'center' | 'right' | 'left', numFmt: string | undefined, fill: 'head' | 'missing' | null) => {
    const key = `${head}|${bold}|${horizontal}|${numFmt ?? ''}|${fill ?? ''}`;
    let s = presets.get(key);
    if (!s) {
      s = {
        font: { ...FONT, bold },
        border: BORDERS,
        alignment: { horizontal, vertical: 'middle', wrapText: true },
        ...(numFmt ? { numFmt } : {}),
        ...(fill === 'head' ? { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F5F5' } } } : fill === 'missing' ? { fill: MISSING_FILL } : {}),
      };
      presets.set(key, s);
    }
    return s;
  };
  const lastCol = colIndex(LAST);
  for (let r = 1; r <= total; r++) {
    const head = r <= 2;
    for (let cIdx = 1; cIdx <= lastCol; cIdx++) {
      const col = colLetters(cIdx);
      const address = `${col}${r}`;
      const cell = ws.getCell(address);
      const horizontal = head || (r === total && cIdx === 1) ? 'center' : r < total && col === C.remarks ? 'left' : typeof cell.value === 'number' ? 'right' : 'center';
      cell.style = preset(head, head || r === total, horizontal, head ? undefined : FORMATS[col], head ? 'head' : shadedCells.has(address) ? 'missing' : null) as ExcelJS.Style;
    }
  }
  return ws;
}
