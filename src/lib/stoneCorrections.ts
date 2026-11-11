import ExcelJS from 'exceljs';
import type { LineInput, StoneInput } from '@/lib/labourComparison';

// Customer-corrected stone details (shape / MM size) used by Labour vs Chart in
// place of what the ERP records. The ERP stays untouched; the corrections are
// uploaded as the customer's workbook (e.g. "2026.11.06 For Labour Rate- Stone
// Details.xlsx") and kept per company by src/lib/stoneCorrectionsStore.ts.
//
// Two kinds of sheet are read, found by their headers (sheet names don't matter):
//   stone rows  Inv No · Job No · Lotcode · Shape · MM · Con. Wt · Con. Pcs
//               one row per invoice stone component ("Diamond" sheet). A sheet
//               without a Shape column (the plain JW register) is skipped.
//   lot rows    LOT · Shape · SIZE ("Color Stones" sheet) — applies to every
//               stone of the lot that has no stone row of its own. A lot listed
//               with several shapes / sizes keeps the ERP value for that field.
// Blank cells mean "no correction".

export interface StoneRowCorrection {
  invNo: string; // as shown, upper case, e.g. JW-800349
  jewNo: string; // job / jewellery no., e.g. RJ800518
  lotCode: string;
  pcs: number | null;
  wt: number | null;
  shape: string | null;
  mmSize: string | null;
}

export interface LotCorrection {
  lotCode: string;
  shape: string | null; // null when blank or the lot has several
  mmSize: string | null;
}

export interface StoneCorrections {
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
  stoneRows: StoneRowCorrection[];
  lots: LotCorrection[];
}

export class CorrectionWorkbookError extends Error {}

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.result !== undefined) return text(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text !== undefined) return String(o.text);
  }
  return String(v).trim();
};
const up = (v: unknown) => text(v).toUpperCase();
const numOrNull = (v: unknown) => {
  const t = text(v);
  const n = Number(t);
  return t === '' || !Number.isFinite(n) ? null : n;
};

// Pure abbreviations to the ERP / chart shape name — no re-mapping between shapes.
const SHAPE_ALIAS: Record<string, string> = { MQ: 'MARQUISE', BG: 'BAGUETTE', RD: 'ROUND', OV: 'OVAL', PS: 'PEAR', CU: 'CUSHION' };
export const normShape = (s: string | null | undefined) => {
  const u = (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return u ? (SHAPE_ALIAS[u] ?? u) : null;
};
// "8x6", "8 * 6", "11.00" → "8X6", "11"
export const normMm = (s: string | null | undefined) => {
  const u = (s ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/\*/g, 'X');
  return u ? u.replace(/\d+(?:\.\d+)?/g, (n) => String(Number(n))) : null;
};

const headerKey = (h: string) => h.toUpperCase().replace(/[^A-Z]/g, '');

function findHeader(ws: ExcelJS.Worksheet, required: string[]): { row: number; col: Map<string, number> } | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 12); r++) {
    const col = new Map<string, number>();
    ws.getRow(r).eachCell((cell, c) => {
      const k = headerKey(text(cell.value));
      if (k && !col.has(k)) col.set(k, c);
    });
    if (required.every((k) => col.has(k))) return { row: r, col };
  }
  return null;
}

export async function parseCorrectionWorkbook(data: ArrayBuffer): Promise<Pick<StoneCorrections, 'stoneRows' | 'lots'>> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch {
    throw new CorrectionWorkbookError('The file could not be read as an .xlsx workbook');
  }

  const stoneRows: StoneRowCorrection[] = [];
  const lotValues = new Map<string, { shapes: Set<string>; sizes: Set<string> }>();

  for (const ws of wb.worksheets) {
    const stone = findHeader(ws, ['INVNO', 'JOBNO', 'LOTCODE', 'SHAPE', 'MM']);
    if (stone) {
      const c = (k: string) => stone.col.get(k);
      for (let r = stone.row + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const get = (k: string) => (c(k) ? row.getCell(c(k)!).value : null);
        const invNo = up(get('INVNO'));
        const lotCode = up(get('LOTCODE'));
        const shape = normShape(text(get('SHAPE')));
        const mmSize = normMm(text(get('MM')));
        if (!invNo || !lotCode || (!shape && !mmSize)) continue;
        stoneRows.push({
          invNo,
          jewNo: up(get('JOBNO')),
          lotCode,
          pcs: numOrNull(get('CONPCS')),
          wt: numOrNull(get('CONWT')),
          shape,
          mmSize,
        });
      }
      continue;
    }
    const lot = findHeader(ws, ['LOT', 'SHAPE', 'SIZE']);
    if (lot) {
      for (let r = lot.row + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const lotCode = up(row.getCell(lot.col.get('LOT')!).value);
        if (!lotCode) continue;
        const e = lotValues.get(lotCode) ?? { shapes: new Set(), sizes: new Set() };
        const shape = normShape(text(row.getCell(lot.col.get('SHAPE')!).value));
        const size = normMm(text(row.getCell(lot.col.get('SIZE')!).value));
        if (shape) e.shapes.add(shape);
        if (size) e.sizes.add(size);
        lotValues.set(lotCode, e);
      }
    }
  }

  const lots: LotCorrection[] = Array.from(lotValues, ([lotCode, e]) => ({
    lotCode,
    shape: e.shapes.size === 1 ? Array.from(e.shapes)[0] : null,
    mmSize: e.sizes.size === 1 ? Array.from(e.sizes)[0] : null,
  })).filter((l) => l.shape || l.mmSize);

  if (stoneRows.length === 0 && lots.length === 0) {
    throw new CorrectionWorkbookError(
      'No corrections found. Expected a sheet with Inv No, Job No, Lotcode, Shape and MM columns, and/or one with LOT, Shape and SIZE columns.',
    );
  }
  return { stoneRows, lots };
}

// ---------- applying ----------

export interface LineKey {
  invNo: string;
  jewNo: string;
}

// Replaces shape / MM size on the lines' stones with the customer's values,
// recording the ERP value in `corrected`. Stone rows are matched on invoice +
// job + lot, then the same pieces and nearest weight; each is used once.
// Returns the number of stones changed.
export function applyStoneCorrections(lines: LineInput[], keyOf: (invDetId: number) => LineKey | undefined, corrections: Pick<StoneCorrections, 'stoneRows' | 'lots'>): number {
  const byStone = new Map<string, (StoneRowCorrection & { used?: boolean })[]>();
  for (const r of corrections.stoneRows) {
    const k = `${r.invNo}|${r.jewNo}|${r.lotCode}`;
    byStone.set(k, [...(byStone.get(k) ?? []), { ...r }]);
  }
  const byLot = new Map(corrections.lots.map((l) => [l.lotCode, l]));
  let changed = 0;

  for (const line of lines) {
    const key = keyOf(line.invDetId);
    for (const s of line.stones) {
      const lot = (s.lotCode ?? '').toUpperCase();
      if (!lot) continue;
      let shape: string | null = null;
      let mmSize: string | null = null;
      let source: 'STONE' | 'LOT' | null = null;

      const cands = key ? (byStone.get(`${key.invNo.toUpperCase()}|${key.jewNo.toUpperCase()}|${lot}`) ?? []).filter((c) => !c.used) : [];
      if (cands.length > 0) {
        const best = cands.sort(
          (a, b) =>
            Number(a.pcs !== s.pieces) - Number(b.pcs !== s.pieces) ||
            Math.abs((a.wt ?? 0) - (s.carats ?? 0)) - Math.abs((b.wt ?? 0) - (s.carats ?? 0)),
        )[0];
        best.used = true;
        ({ shape, mmSize } = best);
        source = 'STONE';
      } else {
        const l = byLot.get(lot);
        if (l) {
          ({ shape, mmSize } = l);
          source = 'LOT';
        }
      }
      if (!source) continue;

      const corrected: NonNullable<StoneInput['corrected']> = { source };
      if (shape && shape !== normShape(s.shape)) {
        corrected.shape = { erp: s.shape, customer: shape };
        s.shape = shape;
      }
      if (mmSize && mmSize !== normMm(s.mmSize)) {
        corrected.mmSize = { erp: s.mmSize, customer: mmSize };
        s.mmSize = mmSize;
      }
      if (corrected.shape || corrected.mmSize) {
        s.corrected = corrected;
        changed++;
      }
    }
  }
  return changed;
}

export const correctionText = (c: StoneInput['corrected']) =>
  !c
    ? ''
    : [
        c.shape ? `shape ${c.shape.erp ?? '—'} → ${c.shape.customer}` : null,
        c.mmSize ? `MM ${c.mmSize.erp ?? '—'} → ${c.mmSize.customer}` : null,
      ]
        .filter(Boolean)
        .join(', ');
