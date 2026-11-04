import ExcelJS from 'exceljs';
import type { PriceChart, StoneSection } from '@/lib/priceChart';

// Download / upload format of a factory price chart: one sheet per table of the
// normalised structure (src/lib/priceChart.ts). Rate sheets are laid out like
// the chart screens (one column per charge type / setting type) so they can be
// edited by hand; their headers end in "[CODE]", which ties the column to the
// Charge Types / Setting Types sheet. Row ids are not in the workbook — they
// are regenerated on upload (rangeId), so download → upload gives back the
// same chart.

const SHEETS = {
  readme: 'Read me',
  chart: 'Chart',
  goldLoss: 'Gold Loss',
  productTypes: 'Product Types',
  chargeTypes: 'Charge Types',
  metalRates: 'Metal Rates',
  alloy: 'Alloy',
  stamping: 'Stamping',
  modelStyle: 'Model Making (Style)',
  modelWeight: 'Model Making (Weight)',
  settingTypes: 'Setting Types',
  rateGroups: 'Rate Groups',
  commodities: 'Commodities',
  settingRates: 'Setting Rates',
} as const;

const HEADERS = {
  chart: ['Field', 'Value'],
  goldLoss: ['Style', 'Style (中文)', 'Karats', 'Loss %'],
  productTypes: ['Product type (ERP)', 'Name', 'Name (中文)'],
  chargeTypes: ['Code', 'Name', 'Name (中文)', 'Group'],
  metalRatesLead: ['Product type (ERP)', 'Type', 'Wt from (g)', 'Wt to (g)'],
  alloy: ['Metal', 'Price per gm'],
  stamping: ['Stamp', 'Price per pc'],
  modelStyle: ['Style', 'Min', 'Max', 'Remark'],
  modelWeightLead: ['Style', 'Style (中文)'],
  settingTypes: ['Code', 'Setting type', 'Name (中文)', 'Sections', 'ERP setting types'],
  rateGroups: ['Code', 'Name', 'Name (中文)', 'Section', 'Shapes (ERP)', 'Note'],
  commodities: ['Code', 'Commodity', 'Name (中文)', 'Rate groups', 'ERP names', 'ERP name contains', 'ERP commodity groups', 'Exclude'],
  settingRatesLead: ['Rate group', 'Wt from (ct)', 'Wt to (ct)', 'Size (mm)', 'Max mm', 'Max mm (round)'],
};

const CHART_FIELDS: [string, keyof PriceChart | 'alloyNotes'][] = [
  ['Code', 'code'],
  ['Name', 'name'],
  ['Chart ref', 'factoryLabel'],
  ['Metal', 'metal'],
  ['Currency', 'currency'],
  ['Effective date (yyyy-mm-dd)', 'effectiveDate'],
  ['Alloy note', 'alloyNotes'],
];

const list = (values: string[] | undefined) => (values ?? []).join(', ');
const slug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

// Range ids, shared with scripts/import-labor-chart.mjs (keep in step).
export const weightRangeId = (productType: string, variant: string | null, n: number) =>
  `${slug(productType)}${variant ? `-${slug(variant)}` : ''}-${n}`;
export const sizeRangeId = (rateGroup: string, n: number) => `${rateGroup}-${n}`;

// ---------- download ----------

function addSheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: (string | number | null)[][], widths: number[] = []) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  for (const r of rows) ws.addRow(r.map((v) => (v === null ? '' : v)));
  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = widths[i] ?? Math.min(40, Math.max(12, h.length + 2));
  });
  return ws;
}

export async function chartToWorkbook(chart: PriceChart): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Megha MIS';
  wb.created = new Date();
  const m = chart.metalChart;
  const s = chart.settingChart;

  addSheet(wb, SHEETS.readme, ['How to use this workbook'], [
    [`Price chart "${chart.name}" (${chart.code}), downloaded from Megha MIS.`],
    ['Uploading this file DELETES the chart in MIS and replaces it with the contents of this workbook (the previous chart is kept as a backup).'],
    ['Edit rows freely, but keep every sheet and its header row. Leave a rate cell empty when there is no rate.'],
    ['Wt to empty = no upper limit. Setting Rates: give Wt from/to in carats, or — for stones priced by size — leave them empty and give Max mm (largest stone dimension) and Max mm (round) (diameter of a round stone).'],
    ['Rate columns end in [CODE] — that code must exist on the Charge Types / Setting Types sheet.'],
    ['A metal rate can be a number or "<number> per <unit>", e.g. "0.35 per link".'],
    ['Product types, shapes, setting types and commodities are matched by name to the ERP masters of the selected company.'],
    ['Lists (sections, shapes, names…) are comma separated. The Code on the Chart sheet must stay the same.'],
  ], [120]);

  addSheet(wb, SHEETS.chart, HEADERS.chart, CHART_FIELDS.map(([label, key]) => [
    label,
    key === 'alloyNotes' ? m.alloyNotes.join(' | ') : String(chart[key]),
  ]), [30, 60]);

  addSheet(wb, SHEETS.goldLoss, HEADERS.goldLoss, m.goldLoss.map((g) => [g.style, g.styleZh, g.karats, g.pct]));
  addSheet(wb, SHEETS.productTypes, HEADERS.productTypes, m.productTypes.map((p) => [p.code, p.name, p.nameZh]), [24, 20, 20]);
  addSheet(wb, SHEETS.chargeTypes, HEADERS.chargeTypes, m.chargeTypes.map((t) => [t.code, t.name, t.nameZh, t.group]), [18, 32, 14, 14]);

  const rateCol = (name: string, code: string) => `${name} [${code}]`;
  const metalRate = new Map(m.rates.map((r) => [`${r.rangeId}|${r.chargeType}`, r]));
  addSheet(
    wb,
    SHEETS.metalRates,
    [...HEADERS.metalRatesLead, ...m.chargeTypes.map((t) => rateCol(t.name, t.code)), 'Note'],
    m.weightRanges.map((r) => [
      r.productType,
      r.variant,
      r.wtFrom,
      r.wtTo,
      ...m.chargeTypes.map((t) => {
        const rate = metalRate.get(`${r.id}|${t.code}`);
        return rate ? (rate.unit === 'per pc' ? rate.rate : `${rate.rate} ${rate.unit}`) : null;
      }),
      r.note,
    ]),
    [22, 16, 12, 12, ...m.chargeTypes.map(() => 16), 40],
  );

  addSheet(wb, SHEETS.alloy, HEADERS.alloy, m.alloy.map((a) => [a.metal, a.pricePerGm]), [28, 14]);
  addSheet(wb, SHEETS.stamping, HEADERS.stamping, m.stamping.map((x) => [x.stamp, x.pricePerPc]), [36, 14]);
  addSheet(wb, SHEETS.modelStyle, HEADERS.modelStyle, m.modelMaking.byStyle.map((x) => [x.style, x.min, x.max, x.remark]), [20, 10, 10, 40]);
  addSheet(
    wb,
    SHEETS.modelWeight,
    [...HEADERS.modelWeightLead, ...m.modelMaking.byWeight.weightBands, 'Remark'],
    m.modelMaking.byWeight.rows.map((x) => [x.style, x.styleZh, ...x.rates, x.remark]),
    [34, 16, ...m.modelMaking.byWeight.weightBands.map(() => 10), 40],
  );

  addSheet(wb, SHEETS.settingTypes, HEADERS.settingTypes, s.settingTypes.map((t) => [t.code, t.name, t.nameZh, list(t.sections), list(t.erpNames)]), [14, 16, 12, 16, 40]);
  addSheet(wb, SHEETS.rateGroups, HEADERS.rateGroups, s.rateGroups.map((g) => [g.code, g.name, g.nameZh, g.section, list(g.shapes), g.note]), [20, 50, 40, 10, 50, 40]);
  addSheet(
    wb,
    SHEETS.commodities,
    HEADERS.commodities,
    s.commodities.map((c) => [c.code, c.name, c.nameZh, list(c.rateGroups), list(c.match.names), list(c.match.contains), list(c.match.groups), list(c.match.exclude)]),
    [20, 22, 14, 30, 30, 24, 40, 20],
  );

  const settingRate = new Map(s.rates.map((r) => [`${r.rangeId}|${r.settingType}`, r.rate]));
  addSheet(
    wb,
    SHEETS.settingRates,
    [...HEADERS.settingRatesLead, ...s.settingTypes.map((t) => rateCol(t.name, t.code)), 'Note'],
    s.sizeRanges.map((r) => [
      r.rateGroup,
      r.wtFrom,
      r.wtTo,
      r.sizeMm,
      r.mmMax,
      r.mmMaxRound,
      ...s.settingTypes.map((t) => settingRate.get(`${r.id}|${t.code}`) ?? null),
      r.note,
    ]),
    [20, 12, 12, 30, 10, 14, ...s.settingTypes.map(() => 14), 30],
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- upload ----------

export class WorkbookError extends Error {
  constructor(public problems: string[]) {
    super(`The workbook has ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  }
}

type Cell = string | number | null;

function cellValue(cell: ExcelJS.Cell): Cell {
  let v: unknown = cell.value;
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) v = (v as { result: unknown }).result; // formula
    else if ('richText' in v) v = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
    else if ('text' in v) v = (v as { text: unknown }).text; // hyperlink
  }
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export async function workbookToChart(buffer: ArrayBuffer, expectedCode: string, fileName: string): Promise<PriceChart> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new WorkbookError(['The file is not a readable .xlsx workbook — download the chart from MIS and edit that file.']);
  }
  const problems: string[] = [];

  // Rows of a sheet after its header, with their Excel row numbers. Checks the
  // leading header cells, and returns the full header for variable columns.
  function readSheet(name: string, leadHeaders: string[]) {
    const ws = wb.getWorksheet(name);
    if (!ws) {
      problems.push(`Sheet "${name}" is missing`);
      return { header: [] as string[], rows: [] as { n: number; cells: Cell[] }[] };
    }
    const header: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => {
      header[col - 1] = String(cellValue(c) ?? '');
    });
    leadHeaders.forEach((h, i) => {
      if ((header[i] ?? '') !== h) problems.push(`${name}: column ${i + 1} header should be "${h}" but is "${header[i] ?? ''}"`);
    });
    const rows: { n: number; cells: Cell[] }[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const cells: Cell[] = [];
      for (let col = 1; col <= Math.max(header.length, leadHeaders.length); col++) cells.push(cellValue(row.getCell(col)));
      if (cells.some((c) => c !== null)) rows.push({ n, cells });
    });
    return { header, rows };
  }

  const at = (sheet: string, n: number) => `${sheet} row ${n}`;
  const text = (v: Cell) => (v == null ? '' : String(v).trim());
  const optText = (v: Cell) => (v == null ? null : String(v).trim() || null);
  const upper = (v: Cell) => text(v).toUpperCase();
  const csv = (v: Cell) => text(v).split(',').map((x) => x.trim()).filter(Boolean);
  const upperCsv = (v: Cell) => csv(v).map((x) => x.toUpperCase());
  function num(v: Cell, where: string, field: string, opts: { required?: boolean } = {}): number | null {
    if (v == null) {
      if (opts.required) problems.push(`${where}: ${field} is required`);
      return null;
    }
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    if (Number.isNaN(n)) {
      problems.push(`${where}: ${field} "${v}" is not a number`);
      return null;
    }
    return Math.round(n * 10000) / 10000;
  }
  const codeOf = (header: string) => header.match(/\[([^\]]+)\]\s*$/)?.[1]?.trim() ?? null;
  function required(v: Cell, where: string, field: string) {
    const s = text(v);
    if (!s) problems.push(`${where}: ${field} is required`);
    return s;
  }

  // ---- Chart ----
  const chartSheet = readSheet(SHEETS.chart, HEADERS.chart);
  const fields = new Map(chartSheet.rows.map((r) => [text(r.cells[0]), r.cells[1]]));
  const field = (label: string) => {
    if (!fields.has(label)) problems.push(`${SHEETS.chart}: field "${label}" is missing`);
    return fields.get(label) ?? null;
  };
  const code = text(field('Code'));
  if (code && code !== expectedCode) {
    problems.push(`${SHEETS.chart}: this workbook is for chart "${code}", but you are uploading to "${expectedCode}"`);
  }
  const effectiveDate = text(field('Effective date (yyyy-mm-dd)'));
  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) problems.push(`${SHEETS.chart}: Effective date "${effectiveDate}" must be yyyy-mm-dd`);
  const alloyNote = text(field('Alloy note'));

  // ---- Metal chart ----
  const goldLoss = readSheet(SHEETS.goldLoss, HEADERS.goldLoss).rows.map(({ n, cells }) => ({
    style: required(cells[0], at(SHEETS.goldLoss, n), 'Style'),
    styleZh: optText(cells[1]),
    karats: text(cells[2]),
    pct: num(cells[3], at(SHEETS.goldLoss, n), 'Loss %'),
  }));

  const productTypes = readSheet(SHEETS.productTypes, HEADERS.productTypes).rows.map(({ n, cells }) => ({
    code: upper(required(cells[0], at(SHEETS.productTypes, n), 'Product type')),
    name: text(cells[1]) || text(cells[0]),
    nameZh: optText(cells[2]),
  }));

  const chargeTypes = readSheet(SHEETS.chargeTypes, HEADERS.chargeTypes).rows.map(({ n, cells }) => {
    const group = text(cells[3]);
    if (group !== 'Basic charge' && group !== 'Add-on') problems.push(`${at(SHEETS.chargeTypes, n)}: Group must be "Basic charge" or "Add-on"`);
    return {
      code: upper(required(cells[0], at(SHEETS.chargeTypes, n), 'Code')),
      name: required(cells[1], at(SHEETS.chargeTypes, n), 'Name'),
      nameZh: optText(cells[2]),
      group: (group === 'Add-on' ? 'Add-on' : 'Basic charge') as 'Basic charge' | 'Add-on',
    };
  });

  const metalSheet = readSheet(SHEETS.metalRates, HEADERS.metalRatesLead);
  const metalRateCols = metalSheet.header.slice(HEADERS.metalRatesLead.length, metalSheet.header.length - 1);
  if (metalSheet.header.length && metalSheet.header[metalSheet.header.length - 1] !== 'Note') problems.push(`${SHEETS.metalRates}: last column header should be "Note"`);
  const metalColCodes = metalRateCols.map((h) => {
    const c = codeOf(h);
    if (!c) problems.push(`${SHEETS.metalRates}: column "${h}" must end in [CODE]`);
    else if (!chargeTypes.some((t) => t.code === c.toUpperCase())) problems.push(`${SHEETS.metalRates}: column "${h}" — charge type ${c} is not on the Charge Types sheet`);
    return c?.toUpperCase() ?? '';
  });
  const weightRanges: PriceChart['metalChart']['weightRanges'] = [];
  const metalRates: PriceChart['metalChart']['rates'] = [];
  for (const { n, cells } of metalSheet.rows) {
    const where = at(SHEETS.metalRates, n);
    const productType = upper(required(cells[0], where, 'Product type'));
    const variant = optText(cells[1]);
    const wtFrom = num(cells[2], where, 'Wt from', { required: true }) ?? 0;
    const wtTo = num(cells[3], where, 'Wt to');
    const id = weightRangeId(productType, variant, weightRanges.filter((r) => r.productType === productType && r.variant === variant).length + 1);
    weightRanges.push({ id, productType, variant, wtFrom, wtTo, note: optText(cells[cells.length - 1]) });
    metalColCodes.forEach((chargeType, i) => {
      const raw = cells[HEADERS.metalRatesLead.length + i];
      if (raw == null || !chargeType) return;
      if (typeof raw === 'number') {
        metalRates.push({ rangeId: id, chargeType, rate: Math.round(raw * 10000) / 10000, unit: 'per pc' });
        return;
      }
      const m = String(raw).match(/^\s*([\d.]+)\s*(per\s+.+?)?\s*$/i);
      if (!m) problems.push(`${where}: rate "${raw}" for ${chargeType} should be a number or "<number> per <unit>"`);
      else metalRates.push({ rangeId: id, chargeType, rate: Number(m[1]), unit: m[2]?.toLowerCase() ?? 'per pc' });
    });
  }

  const alloy = readSheet(SHEETS.alloy, HEADERS.alloy).rows.map(({ n, cells }) => ({
    metal: required(cells[0], at(SHEETS.alloy, n), 'Metal'),
    pricePerGm: num(cells[1], at(SHEETS.alloy, n), 'Price per gm', { required: true }) ?? 0,
  }));
  const stamping = readSheet(SHEETS.stamping, HEADERS.stamping).rows.map(({ n, cells }) => ({
    stamp: required(cells[0], at(SHEETS.stamping, n), 'Stamp'),
    pricePerPc: num(cells[1], at(SHEETS.stamping, n), 'Price per pc', { required: true }) ?? 0,
  }));
  const byStyle = readSheet(SHEETS.modelStyle, HEADERS.modelStyle).rows.map(({ n, cells }) => ({
    style: required(cells[0], at(SHEETS.modelStyle, n), 'Style'),
    min: num(cells[1], at(SHEETS.modelStyle, n), 'Min', { required: true }) ?? 0,
    max: num(cells[2], at(SHEETS.modelStyle, n), 'Max', { required: true }) ?? 0,
    remark: optText(cells[3]),
  }));
  const weightSheet = readSheet(SHEETS.modelWeight, HEADERS.modelWeightLead);
  const weightBands = weightSheet.header.slice(HEADERS.modelWeightLead.length, weightSheet.header.length - 1);
  const byWeightRows = weightSheet.rows.map(({ n, cells }) => ({
    style: required(cells[0], at(SHEETS.modelWeight, n), 'Style'),
    styleZh: optText(cells[1]),
    rates: weightBands.map((b, i) => num(cells[HEADERS.modelWeightLead.length + i], at(SHEETS.modelWeight, n), b)),
    remark: optText(cells[cells.length - 1]),
  }));

  // ---- Setting chart ----
  const sections = (v: Cell, where: string): StoneSection[] => {
    const out = upperCsv(v);
    for (const s of out) if (s !== 'SIDE' && s !== 'CENTER') problems.push(`${where}: section "${s}" must be SIDE or CENTER`);
    if (out.length === 0) problems.push(`${where}: give at least one section (SIDE, CENTER)`);
    return out.filter((s): s is StoneSection => s === 'SIDE' || s === 'CENTER');
  };
  const settingTypes = readSheet(SHEETS.settingTypes, HEADERS.settingTypes).rows.map(({ n, cells }) => ({
    code: upper(required(cells[0], at(SHEETS.settingTypes, n), 'Code')),
    name: required(cells[1], at(SHEETS.settingTypes, n), 'Setting type'),
    nameZh: optText(cells[2]),
    sections: sections(cells[3], at(SHEETS.settingTypes, n)),
    erpNames: upperCsv(cells[4]),
  }));
  const rateGroups = readSheet(SHEETS.rateGroups, HEADERS.rateGroups).rows.map(({ n, cells }) => ({
    code: upper(required(cells[0], at(SHEETS.rateGroups, n), 'Code')),
    name: required(cells[1], at(SHEETS.rateGroups, n), 'Name'),
    nameZh: optText(cells[2]),
    section: sections(cells[3], at(SHEETS.rateGroups, n))[0] ?? 'CENTER',
    shapes: upperCsv(cells[4]),
    note: optText(cells[5]),
  }));
  const commodities = readSheet(SHEETS.commodities, HEADERS.commodities).rows.map(({ n, cells }) => {
    const match: PriceChart['settingChart']['commodities'][number]['match'] = {};
    const names = upperCsv(cells[4]);
    const contains = upperCsv(cells[5]);
    const groups = upperCsv(cells[6]);
    const exclude = upperCsv(cells[7]);
    if (names.length) match.names = names;
    if (contains.length) match.contains = contains;
    if (groups.length) match.groups = groups;
    if (exclude.length) match.exclude = exclude;
    return {
      code: upper(required(cells[0], at(SHEETS.commodities, n), 'Code')),
      name: required(cells[1], at(SHEETS.commodities, n), 'Commodity'),
      nameZh: optText(cells[2]),
      rateGroups: upperCsv(cells[3]),
      match,
    };
  });

  const settingSheet = readSheet(SHEETS.settingRates, HEADERS.settingRatesLead);
  const settingRateCols = settingSheet.header.slice(HEADERS.settingRatesLead.length, settingSheet.header.length - 1);
  if (settingSheet.header.length && settingSheet.header[settingSheet.header.length - 1] !== 'Note') problems.push(`${SHEETS.settingRates}: last column header should be "Note"`);
  const settingColCodes = settingRateCols.map((h) => {
    const c = codeOf(h);
    if (!c) problems.push(`${SHEETS.settingRates}: column "${h}" must end in [CODE]`);
    else if (!settingTypes.some((t) => t.code === c.toUpperCase())) problems.push(`${SHEETS.settingRates}: column "${h}" — setting type ${c} is not on the Setting Types sheet`);
    return c?.toUpperCase() ?? '';
  });
  const sizeRanges: PriceChart['settingChart']['sizeRanges'] = [];
  const settingRates: PriceChart['settingChart']['rates'] = [];
  for (const { n, cells } of settingSheet.rows) {
    const where = at(SHEETS.settingRates, n);
    const rateGroup = upper(required(cells[0], where, 'Rate group'));
    const wtFrom = num(cells[1], where, 'Wt from');
    const wtTo = num(cells[2], where, 'Wt to');
    const sizeMm = optText(cells[3]);
    const mmMax = num(cells[4], where, 'Max mm');
    const mmMaxRound = num(cells[5], where, 'Max mm (round)');
    if (wtFrom == null && wtTo != null) problems.push(`${where}: Wt to is given without Wt from`);
    if (wtFrom == null && mmMax == null) problems.push(`${where}: give Wt from (carats) or Max mm (mm-size row)`);
    const id = sizeRangeId(rateGroup, sizeRanges.filter((r) => r.rateGroup === rateGroup).length + 1);
    sizeRanges.push({
      id,
      rateGroup,
      wtFrom,
      wtTo: wtFrom == null ? null : wtTo,
      sizeMm,
      mmMax: wtFrom == null ? mmMax : null,
      mmMaxRound: wtFrom == null ? mmMaxRound : null,
      note: optText(cells[cells.length - 1]),
    });
    settingColCodes.forEach((settingType, i) => {
      const rate = num(cells[HEADERS.settingRatesLead.length + i], where, settingRateCols[i]);
      if (rate != null && settingType) settingRates.push({ rangeId: id, settingType, rate });
    });
  }

  if (problems.length) throw new WorkbookError(problems);

  return {
    code: expectedCode,
    name: text(field('Name')),
    factoryLabel: text(field('Chart ref')),
    metal: text(field('Metal')),
    currency: text(field('Currency')),
    effectiveDate,
    source: { file: fileName, sheet: 'MIS chart workbook', importedAt: new Date().toISOString().slice(0, 10) },
    metalChart: {
      goldLoss,
      productTypes,
      chargeTypes,
      weightRanges,
      rates: metalRates,
      alloy,
      stamping,
      alloyNotes: alloyNote ? alloyNote.split(' | ').map((x) => x.trim()).filter(Boolean) : [],
      modelMaking: { byStyle, byWeight: { weightBands, rows: byWeightRows } },
    },
    settingChart: { settingTypes, rateGroups, commodities, sizeRanges, rates: settingRates },
  };
}
