import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { applyStoneCorrections, canonicalMm, majoritySize, normMm, normShape, parseCorrectionWorkbook } from '@/lib/stoneCorrections';
import type { LineInput, StoneInput } from '@/lib/labourComparison';

const stone = (s: Partial<StoneInput>): StoneInput => ({
  componentId: 1, lotCode: 'L1', commodity: 'TANZANITE', commodityGroup: 'TANZANITE', shape: 'OVAL', mmSize: null,
  carats: 1, pieces: 1, settingType: null, settingAmount: 0, ...s,
});
const line = (stones: StoneInput[]): LineInput => ({ invDetId: 7, qty: 1, productType: 'RING', currency: 'USD', metal: [], labour: [], stones });

async function workbook() {
  const wb = new ExcelJS.Workbook();
  const reg = wb.addWorksheet('JW Inv'); // no Shape column → skipped
  reg.addRow(['Inv No', 'Job No', 'Lotcode', 'MM']);
  reg.addRow(['JW-1', 'J1', 'D1', '9']);
  const dia = wb.addWorksheet('Diamond');
  dia.addRow(['Inv No', 'Factory', 'Job No', 'Lotcode', 'Shape', 'MM', 'Con. Wt', 'Con. Pcs']);
  dia.addRow(['JW-1', 'AAA', 'J1', 'D1', 'BG', '2.3', 0.19, 4]);
  dia.addRow(['JW-1', 'AAA', 'J1', 'D1', null, null, 0.2, 4]); // nothing to correct
  const col = wb.addWorksheet('Color Stones');
  col.addRow(['LOT', 'Shape', 'STONE', 'SIZE.']);
  col.addRow(['T1', 'CUSHION', 'TANZANITE', '8x6']);
  col.addRow(['T1', 'cushion', 'TANZANITE', '8X6']);
  col.addRow(['MIX', 'OVAL', 'OPAL', '7x5']);
  col.addRow(['MIX', 'OVAL', 'OPAL', '9x7']); // several sizes → size not corrected
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('customer stone corrections', () => {
  it('normalises shapes and sizes', () => {
    expect(normShape(' mq ')).toBe('MARQUISE');
    expect(normMm('8 x 6')).toBe('8X6');
    expect(normMm('11.00')).toBe('11');
    expect(normMm('9.23*7.84')).toBe('9.23X7.84');
  });

  it('reads stone rows and lot rows by their headers', async () => {
    const c = await parseCorrectionWorkbook(await workbook());
    expect(c.stoneRows).toEqual([{ invNo: 'JW-1', jewNo: 'J1', lotCode: 'D1', pcs: 4, wt: 0.19, shape: 'BAGUETTE', mmSize: '2.3' }]);
    expect(c.lots).toEqual([
      { lotCode: 'T1', shape: 'CUSHION', mmSize: '8X6' },
      { lotCode: 'MIX', shape: 'OVAL', mmSize: null },
    ]);
  });

  it('replaces shape / MM on matching stones and keeps the ERP value', async () => {
    const c = await parseCorrectionWorkbook(await workbook());
    const l = line([
      stone({ componentId: 1, lotCode: 'D1', commodity: 'DIAMOND', shape: 'TAPER', mmSize: '2.30', carats: 0.19, pieces: 4 }),
      stone({ componentId: 2, lotCode: 't1', shape: 'OVAL', mmSize: '8X6' }),
      stone({ componentId: 3, lotCode: 'MIX', shape: 'OVAL', mmSize: '16X12' }),
      stone({ componentId: 4, lotCode: 'OTHER' }),
    ]);
    expect(applyStoneCorrections([l], () => ({ invNo: 'JW-1', jewNo: 'J1' }), c)).toBe(2);
    expect(l.stones[0]).toMatchObject({ shape: 'BAGUETTE', mmSize: '2.30', corrected: { source: 'STONE', shape: { erp: 'TAPER', customer: 'BAGUETTE' } } });
    expect(l.stones[0].corrected?.mmSize).toBeUndefined(); // 2.30 = 2.3
    expect(l.stones[1]).toMatchObject({ shape: 'CUSHION', corrected: { source: 'LOT', shape: { erp: 'OVAL', customer: 'CUSHION' } } });
    expect(l.stones[2].corrected).toBeUndefined();
    expect(l.stones[3].corrected).toBeUndefined();
  });

  it('rejects a workbook with no correction sheet', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['a', 'b']);
    await expect(parseCorrectionWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer)).rejects.toThrow('No corrections found');
  });
});

describe('lot sizes from the Color Stones sheet', () => {
  it('writes the same size one way', () => {
    expect(canonicalMm('4X4')).toBe('4');
    expect(canonicalMm('8X10')).toBe('10X8');
    expect(canonicalMm('10X8')).toBe('10X8');
    expect(canonicalMm('9.82X7.8X5.03')).toBe('9.82X7.8X5.03');
    expect(canonicalMm('7.5C5.5')).toBe('7.5C5.5'); // typos are left alone
  });

  it("takes the size given on more than half of a lot's rows", () => {
    expect(majoritySize(new Map([['9X7', 118], ['8X6', 2]]))).toBe('9X7');
    expect(majoritySize(new Map([['4', 3]]))).toBe('4');
    expect(majoritySize(new Map([['10X8', 5], ['11X9', 5]]))).toBeNull();
    expect(majoritySize(new Map())).toBeNull();
  });
});
