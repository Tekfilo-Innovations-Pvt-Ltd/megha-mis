// Imports a factory labour chart (.xls/.xlsx) into MIS's normalised price-chart
// JSON (types in src/lib/priceChart.ts). Written for the W8 & W8-1 GOLD Labor
// Chart layout ("Labor" sheet, sections A–F); every cell it reads is checked
// against the expected header text first, so a changed layout fails loudly
// instead of importing wrong numbers.
//
//   node scripts/import-labor-chart.mjs <file.xls> <chart-code>
//   e.g. node scripts/import-labor-chart.mjs "W8 GOLD Labor Chart.xls" w8-gold-2018-12-01
//
// Writes data/price-charts/<chart-code>.json (or $PRICE_CHART_DIR), backing up
// an existing chart of the same code first. Values are read only — no
// formulas or macros from the workbook are run.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const [file, code] = process.argv.slice(2);
if (!file || !code || !/^[a-z0-9-]+$/.test(code)) {
  console.error('Usage: node scripts/import-labor-chart.mjs <file.xls> <chart-code (a-z, 0-9, -)>');
  process.exit(1);
}

const wb = XLSX.read(readFileSync(file), { cellFormula: false, cellHTML: false });
const SHEET = 'Labor';
const ws = wb.Sheets[SHEET];
if (!ws) throw new Error(`Sheet "${SHEET}" not found (sheets: ${wb.SheetNames.join(', ')})`);

// ---------- cell helpers ----------

const cell = (addr) => ws[addr]?.v;
const text = (addr) => {
  const v = cell(addr);
  return v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
};
const number = (addr) => {
  const v = cell(addr);
  if (v == null || v === '') return null;
  if (typeof v !== 'number') throw new Error(`${addr}: expected a number, found "${v}"`);
  return Math.round(v * 10000) / 10000; // the chart's own precision is 4 dp; drops float noise like 4.8405000000000005
};
const expect = (addr, fragment) => {
  if (!text(addr).toLowerCase().includes(fragment.toLowerCase())) {
    throw new Error(`Layout changed: ${addr} should contain "${fragment}" but has "${text(addr)}"`);
  }
};
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
// Range ids — same scheme as weightRangeId / sizeRangeId in src/lib/priceChartWorkbook.ts.
const slug = (s) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const weightRangeId = (productType, variant, n) => `${slug(productType)}${variant ? `-${slug(variant)}` : ''}-${n}`;
// Bilingual labels are "English 中文" — split at the first Chinese character,
// e.g. "Diamond - Round 钻石--圆形" or "Stud with Butterfly(用针迫的耳钉耳环)".
const CJK = /[㐀-鿿]/;
function splitBilingual(s) {
  const i = s.search(CJK);
  if (i < 0) return { en: s, zh: null };
  const en = s.slice(0, i).replace(/[\s(（:：-]+$/, '').trim();
  let zh = s.slice(i).trim();
  // drop a closing bracket whose opener was on the English side
  const open = (zh.match(/[(（]/g) || []).length;
  const close = (zh.match(/[)）]/g) || []).length;
  if (close > open) zh = zh.replace(/[)）]\s*$/, '');
  return { en, zh: zh || null };
}
const en = (s) => splitBilingual(s).en;
const zh = (s) => splitBilingual(s).zh;

// "under 3g" / "3-7g" / "15g up" / "10-15gm(含15个配件）" -> [min, max]
function parseRange(label) {
  const s = label.replace(/\(.*$|（.*$/, '').replace(/ct|gms?|g/gi, '').trim();
  let m;
  if ((m = s.match(/^(?:under|below)\s*([\d.]+)$/i))) return [null, Number(m[1])];
  if ((m = s.match(/^([\d.]+)\s*(?:up|\+)$/i))) return [Number(m[1]), null];
  if ((m = s.match(/^([\d.]+)\s*-\s*([\d.]+)$/))) return [Number(m[1]), Number(m[2])];
  throw new Error(`Can't read range "${label}"`);
}
const parenthesis = (label) => label.match(/[（(]([^）)]*)[）)]/)?.[1]?.trim() ?? null;

// ---------- header ----------

expect('A1', 'ADG & RT');
expect('G2', '2018-12-01');
const effectiveDate = text('G2').match(/\d{4}-\d{2}-\d{2}/)[0];

// ---------- A) Labor cost (metal) ----------

expect('A5', 'A) Labor Cost');
expect('C7', 'under 5pcs');
expect('D7', '5pcs up');
expect('E7', 'wax to gold');
expect('F6', 'J-back');
expect('G6', 'Soldering');
expect('H6', 'Rhodium');
expect('I6', 'Two Tone');

const chargeTypes = [
  { code: 'BASIC_UNDER_5', name: 'Basic — under 5 pcs per style', nameZh: '5件以下', group: 'Basic charge', col: 'C' },
  { code: 'BASIC_5_UP', name: 'Basic — 5 pcs up per style', nameZh: '5件以上', group: 'Basic charge', col: 'D' },
  { code: 'WAX_TO_GOLD', name: 'Wax to gold', nameZh: '喷蜡款', group: 'Basic charge', col: 'E' },
  { code: 'J_BACK', name: 'J-back', nameZh: text('F7'), group: 'Add-on', col: 'F' },
  { code: 'SOLDERING', name: 'Soldering', nameZh: text('G7'), group: 'Add-on', col: 'G' },
  { code: 'RHODIUM', name: 'Rhodium', nameZh: text('H7'), group: 'Add-on', col: 'H' },
  { code: 'TWO_TONE', name: 'Two tone', nameZh: text('I7'), group: 'Add-on', col: 'I' },
];

// Chart categories → ERP product types (tbl_product_type.product_type_name).
// The category label sits on its first row; its Chinese name a couple of rows
// below. The two stud rows are product type STUD with a different back.
const metalBlocks = [
  { productType: 'RING', labelAddr: 'A8', label: 'Ring', zhAddr: 'A10', rows: range(8, 12) },
  { productType: 'EARRINGS', labelAddr: 'A13', label: 'Earrings', zhAddr: 'A15', rows: range(13, 17) },
  { productType: 'STUD', labelAddr: 'A18', label: 'Stud with Butterfly', zhAddr: 'A18', rows: [18], variant: 'Butterfly back' },
  { productType: 'STUD', labelAddr: 'A19', label: 'Stud with lever back', zhAddr: 'A19', rows: [19], variant: 'Lever back' },
  { productType: 'PENDANT', labelAddr: 'A20', label: 'Pendant', zhAddr: 'A22', rows: range(20, 24) },
  { productType: 'PENDANT WITH CHAIN', labelAddr: 'A25', label: 'Pendant+Chain', zhAddr: 'A27', rows: range(25, 28) },
  { productType: 'BRACELET', labelAddr: 'A29', label: 'Bracelet', zhAddr: 'A30', rows: range(29, 30) },
];
for (const b of metalBlocks) expect(b.labelAddr, b.label);

const productTypes = [];
for (const b of metalBlocks) {
  if (productTypes.some((p) => p.code === b.productType)) continue;
  const name = b.productType.charAt(0) + b.productType.slice(1).toLowerCase();
  // studs: "Stud with Butterfly(用针迫的耳钉耳环)" — the shared product type takes the common part
  productTypes.push({ code: b.productType, name, nameZh: b.variant ? '耳钉耳环' : zh(text(b.zhAddr)) });
}

const studNote = text('J18'); // merged J18:K19 — applies to both stud rows
const weightRanges = [];
const metalRates = [];
for (const b of metalBlocks) {
  for (const row of b.rows) {
    const label = text(`B${row}`);
    const [from, to] = label ? parseRange(label) : [null, null];
    const range_ = {
      id: weightRangeId(b.productType, b.variant ?? null, weightRanges.filter((r) => r.productType === b.productType && r.variant === (b.variant ?? null)).length + 1),
      productType: b.productType,
      variant: b.variant ?? null,
      wtFrom: from ?? 0, // "under 3g" starts at 0 g
      wtTo: to,
      note: b.variant ? studNote : parenthesis(label),
    };
    weightRanges.push(range_);
    for (const ct of chargeTypes) {
      const raw = cell(`${ct.col}${row}`);
      if (raw == null || raw === '') continue;
      if (typeof raw === 'string') {
        // e.g. bracelet J-back "0.35 per link"
        const m = raw.match(/^\s*([\d.]+)\s*(per\s+\w+)\s*$/i);
        if (!m) throw new Error(`${ct.col}${row}: can't read "${raw}"`);
        metalRates.push({ rangeId: range_.id, chargeType: ct.code, rate: Number(m[1]), unit: m[2].toLowerCase() });
      } else {
        metalRates.push({ rangeId: range_.id, chargeType: ct.code, rate: number(`${ct.col}${row}`), unit: 'per pc' });
      }
    }
  }
}

// Gold loss (row 4): "Nomal style(普通款)：9K/14K/18K--9%" and "Wax to gold(喷蜡款): 9K/14K/18K--" (no % given)
expect('A3', 'GOLD LOSS');
const goldLoss = ['A4', 'E4'].map((addr) => {
  const s = text(addr);
  const m = s.match(/^(.*?)[（(]([^）)]*)[）)]\s*[:：]\s*([\w/]+)\s*-*\s*([\d.]+)?\s*%?$/);
  if (!m) throw new Error(`${addr}: can't read gold loss "${s}"`);
  return { style: m[1].trim().replace(/^Nomal/, 'Normal'), styleZh: m[2], karats: m[3], pct: m[4] ? Number(m[4]) : null };
});

// ---------- D) Alloy and laser stamping ----------

expect('A108', 'D) Alloy');
expect('B109', 'price/gm');
expect('D109', 'Stamp');
expect('F109', 'price/pc');
const dollars = (addr) => {
  const m = text(addr).match(/\$?\s*([\d.]+)/);
  if (!m) throw new Error(`${addr}: can't read price "${text(addr)}"`);
  return Number(m[1]);
};
const alloy = range(110, 113).map((r) => ({ metal: text(`A${r}`), pricePerGm: dollars(`B${r}`) }));
const stamping = range(110, 113).map((r) => ({ stamp: text(`D${r}`), pricePerPc: dollars(`F${r}`) }));
const alloyNotes = [text('A114')].filter(Boolean);

// ---------- E) / F) Model making ----------

expect('A116', 'E) Model making');
expect('A118', 'Style');
const styleRemark = text('C119'); // merged C119:C124
const modelByStyle = range(119, 124).map((r) => {
  const [min, max] = text(`B${r}`).split('-').map(Number);
  return { style: text(`A${r}`), min, max, remark: styleRemark || null };
});

expect('A126', 'F) Model making');
expect('A128', 'Style');
const mmCols = ['B', 'C', 'D', 'E', 'F'];
const weightRemark = text('G129'); // merged G129:G134
const modelByWeight = {
  weightBands: mmCols.map((c) => text(`${c}128`)),
  rows: range(129, 134).map((r) => ({
    style: en(text(`A${r}`)),
    styleZh: zh(text(`A${r}`)),
    rates: mmCols.map((c) => number(`${c}${r}`)),
    remark: weightRemark || null,
  })),
};

// ---------- B) Diamond setting / C) Center stone setting ----------

expect('A32', 'B) Diamond Setting');
expect('A52', 'C) Center stone');
// The rate columns are ERP setting types (tbl_setting_type). erpNames: the ERP
// master names each column covers — the ERP spells some differently ("Bazel",
// "Micro Pave set").
const settingTypeCols = [
  { col: 'C', code: 'PRONG_PAVE', name: 'Prong/Pave', erpNames: ['PRONG', 'PAVE', 'MINI PRONG', 'SHARE PRONG', 'CLAW', 'CLAW PRONG', 'HAND-PAVE', 'PRE-PAVE'] },
  { col: 'D', code: 'MICRO_PAVE', name: 'Micro Pave', erpNames: ['MICRO PAVE', 'MICRO PAVE SET', 'PRE MICRO PAVE SET'] },
  { col: 'E', code: 'CHANNEL', name: 'Channel', erpNames: ['CHANNEL'] },
  { col: 'F', code: 'BEZEL', name: 'Bezel', erpNames: ['BEZEL', 'BAZEL', 'HALF BAZEL'] },
  { col: 'G', code: 'WAX', name: 'Wax setting', erpNames: ['WAX', 'WAX SETTING'] },
  { col: 'H', code: 'INVISIBLE', name: 'Invisible', erpNames: ['INVISIBLE'] },
  { col: 'I', code: 'PRESSURE', name: 'Pressure', erpNames: ['PRESSURE'] }, // spelled "Pressue" in the chart (爪无边镶)
];
for (const t of settingTypeCols) expect(`${t.col}34`, t.name.split(' ')[0].replace('Pressure', 'Pressue'));
for (const t of settingTypeCols.slice(0, 4)) expect(`${t.col}54`, t.name.split(' ')[0]);
const settingTypes = settingTypeCols.map((t) => ({
  code: t.code,
  name: t.name,
  nameZh: text(`${t.col}35`) || null,
  sections: t.col <= 'F' ? ['SIDE', 'CENTER'] : ['SIDE'],
  erpNames: t.erpNames,
}));

// Excel row blocks = rate groups, with the ERP shapes (tbl_shape.shape_name) they price.
const CENTER_SHAPES = ['ROUND', 'OVAL', 'PEAR', 'TRIANGLE']; // "(round, oval, pear, triangle)"
const stoneGroupDefs = [
  { code: 'DIAMOND_ROUND', section: 'SIDE', nameAddr: 'A36', rows: range(36, 46), methods: 'CDEFGHI', shapes: ['ROUND'] },
  // "MQ, TP/BG, PE, CU, OCT, SQ" — OCTOGON is the ERP's own spelling
  { code: 'DIAMOND_FANCY', section: 'SIDE', nameAddr: 'A47', rows: range(47, 50), methods: 'CDEFGHI', shapes: ['MARQUISE', 'TAPER', 'BAGUETTE', 'PEAR', 'CUSHION', 'OCTOGON', 'SQUARE'] },
  { code: 'SEMI_PRECIOUS', section: 'CENTER', nameAddr: 'A56', rows: range(56, 70), methods: 'CDEF', shapes: CENTER_SHAPES },
  { code: 'RUBY_SAPPHIRE', section: 'CENTER', nameAddr: 'A71', rows: range(71, 85), methods: 'CDEF', shapes: CENTER_SHAPES },
  { code: 'EMERALD_TANZANITE', section: 'CENTER', nameAddr: 'A86', rows: range(86, 100), methods: 'CDEF', shapes: CENTER_SHAPES },
  { code: 'OPAL', section: 'CENTER', nameAddr: 'A101', rows: range(101, 106), methods: 'CDEF', shapes: CENTER_SHAPES, noteAddr: 'G101' }, // note merged G101:G106
];

// Stones named in each row block → ERP commodities (tbl_commodity names, or
// commodity groups as a fallback). Decisions confirmed with the user:
// Peridot and Green Garnet follow the Chinese text (Emerald/Tanzanite rates),
// and "Topaz" covers every ERP topaz commodity.
const chartCommodities = [
  { code: 'DIAMOND', name: 'Diamond', nameZh: '钻石', rateGroups: ['DIAMOND_ROUND', 'DIAMOND_FANCY'],
    match: { groups: ['DIAMOND', 'CERTIFIED DIAMOND', 'DIAMOND FANCY', 'COL-DIA', 'MULTI-DIA'] } },
  { code: 'RUBELLITE', name: 'Rubellite (RBL)', nameZh: '碧玺', rateGroups: ['SEMI_PRECIOUS'], match: { contains: ['RUBELITE', 'RUBELLITE'] } },
  { code: 'KYANITE', name: 'Kyanite', nameZh: '天然蓝晶', rateGroups: ['SEMI_PRECIOUS'], match: { names: ['KYNITE', 'KYANITE'] } },
  { code: 'MORGANITE', name: 'Morganite', nameZh: '摩根石', rateGroups: ['SEMI_PRECIOUS'], match: { contains: ['MORGANITE'] } },
  { code: 'AQUAMARINE', name: 'Aquamarine', nameZh: '海蓝宝', rateGroups: ['SEMI_PRECIOUS'], match: { contains: ['AQUAMARINE'] } },
  { code: 'GARNET', name: 'Garnet', nameZh: '加力', rateGroups: ['SEMI_PRECIOUS'], match: { contains: ['GARNET'], groups: ['GARNET'], exclude: ['GREEN GARNET'] } },
  { code: 'TOPAZ', name: 'Topaz', nameZh: '瑞士蓝', rateGroups: ['SEMI_PRECIOUS'], match: { contains: ['TOPAZ'] } },
  { code: 'BLUE_ZIRCON', name: 'Blue Zircon', nameZh: '天然蓝锆', rateGroups: ['SEMI_PRECIOUS'], match: { names: ['BLUE ZIRCON'] } },
  { code: 'OTHER_SEMI_PRECIOUS', name: 'Other semi-precious', nameZh: '其他天然晶石', rateGroups: ['SEMI_PRECIOUS'], match: { groups: ['SEMI PRECIOUS STONE'] } },
  { code: 'RUBY', name: 'Ruby', nameZh: '红宝', rateGroups: ['RUBY_SAPPHIRE'], match: { groups: ['RUBY'] } },
  { code: 'SAPPHIRE', name: 'Sapphire', nameZh: '蓝宝', rateGroups: ['RUBY_SAPPHIRE'], match: { names: ['SAPPHIRE', 'BLUE SAPPHIRE', 'CELYON SAPPHIRE'] } },
  { code: 'FANCY_SAPPHIRE', name: 'Fancy Sapphire', nameZh: '彩蓝宝', rateGroups: ['RUBY_SAPPHIRE'], match: { groups: ['SAPPHIRE'], contains: ['SAPPHIRE', 'SAPPIRE'], exclude: ['LAB GROWN', 'LABGROWN', 'OREGON'] } },
  { code: 'EMERALD', name: 'Emerald', nameZh: '绿宝', rateGroups: ['EMERALD_TANZANITE'], match: { names: ['EMERALD'], groups: ['EMERALD'] } },
  { code: 'PERIDOT', name: 'Peridot', nameZh: '橄榄石', rateGroups: ['EMERALD_TANZANITE'], match: { names: ['PERIDOT'] } },
  { code: 'GREEN_GARNET', name: 'Green Garnet', nameZh: '绿加力', rateGroups: ['EMERALD_TANZANITE'], match: { names: ['GREEN GARNET'], contains: ['TSAVORITE', 'TASVORITE'] } },
  { code: 'TANZANITE', name: 'Tanzanite', nameZh: '坦桑', rateGroups: ['EMERALD_TANZANITE'], match: { contains: ['TANZANITE'], groups: ['TANZANITE'], exclude: ['CUBIC'] } },
  { code: 'OPAL', name: 'Opal', nameZh: '澳宝', rateGroups: ['OPAL'], match: { contains: ['OPAL'] } },
];
expect('A36', 'Diamond - Round');
expect('A47', 'Diamond - MQ');
expect('A56', 'RBL');
expect('A71', 'Ruby');
expect('A86', 'Emerald');
expect('A101', 'Opal');

const cuttingNote = text('H45'); // merged H45:H46 — the two largest round-diamond ranges
const rateGroups = [];
const sizeRanges = [];
const settingRates = [];
for (const g of stoneGroupDefs) {
  const raw = text(g.nameAddr);
  rateGroups.push({ code: g.code, section: g.section, name: en(raw), nameZh: zh(raw), shapes: g.shapes, note: g.noteAddr ? text(g.noteAddr) : null });
  g.rows.forEach((row, i) => {
    const label = text(`B${row}`);
    if (!label) throw new Error(`B${row}: missing size for ${g.code}`);
    // "…ct" (or a bare carat range like "45-49.9" in a carat block) is a weight
    // range; "7*5 //6mm(Rd,Tri,Cu)" style sizes stay as mm sizes.
    const isMm = /mm|\*/.test(label) && !/ct/.test(label.replace(/\(.*$/, ''));
    let wtFrom = null;
    let wtTo = null;
    if (!isMm) {
      const [from, to] = parseRange(label);
      wtFrom = from ?? 0; // "below 0.0155ct" starts at 0 ct
      wtTo = to;
    }
    // mm rows: "9*7,10*8mm/10mm(Rd,Tri,Cu)" → largest dimension before the
    // slash(es) = 10, round diameter after = 10.
    let mmMax = null;
    let mmMaxRound = null;
    if (isMm) {
      const [dims, round = ''] = label.split(/\/+/);
      mmMax = Math.max(...(dims.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
      mmMaxRound = Number(round.match(/\d+(?:\.\d+)?/)?.[0]) || null;
      if (!Number.isFinite(mmMax)) throw new Error(`B${row}: can't read mm size "${label}"`);
    }
    const size = {
      id: `${g.code}-${i + 1}`,
      rateGroup: g.code,
      wtFrom,
      wtTo,
      sizeMm: isMm ? label : parenthesis(label)?.replace(/mm$/i, '') ?? null,
      mmMax,
      mmMaxRound,
      note: g.code === 'DIAMOND_ROUND' && (row === 45 || row === 46) ? cuttingNote : null,
    };
    sizeRanges.push(size);
    for (const col of g.methods) {
      if (`${col}${row}` === 'H45') continue; // the cutting-charge note cell (merged H45:H46), not a rate
      const rate = number(`${col}${row}`);
      if (rate != null) settingRates.push({ rangeId: size.id, settingType: settingTypeCols.find((t) => t.col === col).code, rate });
    }
  });
}
for (const c of chartCommodities) {
  for (const g of c.rateGroups) if (!rateGroups.some((r) => r.code === g)) throw new Error(`${c.code}: unknown rate group ${g}`);
}

// ---------- write ----------

const chart = {
  code,
  name: `${en(text('A1'))} — Gold labor chart`,
  factoryLabel: text('A1').match(/\(([^)]*)\)/)?.[1] ?? '',
  metal: 'GOLD',
  currency: 'USD',
  effectiveDate,
  source: { file: basename(file), sheet: SHEET, importedAt: new Date().toISOString().slice(0, 10) },
  metalChart: {
    goldLoss,
    productTypes,
    chargeTypes: chargeTypes.map(({ col: _col, ...ct }) => ct),
    weightRanges,
    rates: metalRates,
    alloy,
    stamping,
    alloyNotes,
    modelMaking: { byStyle: modelByStyle, byWeight: modelByWeight },
  },
  settingChart: { settingTypes, rateGroups, commodities: chartCommodities, sizeRanges, rates: settingRates },
};

// Same place and backup rule as uploads (src/lib/priceChartStore.ts).
const chartDir = process.env.PRICE_CHART_DIR || fileURLToPath(new URL('../data/price-charts/', import.meta.url));
const out = join(chartDir, `${code}.json`);
mkdirSync(join(chartDir, 'backups'), { recursive: true });
if (existsSync(out)) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  copyFileSync(out, join(chartDir, 'backups', `${code}.${stamp}.json`));
  console.log(`Backed up the previous ${code}.json to backups/${code}.${stamp}.json`);
}
writeFileSync(out, JSON.stringify(chart, null, 2) + '\n');
console.log(`Wrote ${out}`);
console.log(`  metal: ${productTypes.length} product types, ${weightRanges.length} weight ranges, ${metalRates.length} rates`);
console.log(`  setting: ${chartCommodities.length} commodities, ${rateGroups.length} rate groups, ${sizeRanges.length} size ranges, ${settingRates.length} rates`);
