import { describe, expect, it } from 'vitest';
import { goldColours, metalTypeOf } from '@/lib/metalType';

const gold = (lotCode: string) => ({ commodity: 'GOLD', lotCode });

describe('goldColours', () => {
  it.each([
    ['14KW', ['W'], false],
    ['14KY 585', ['Y'], false],
    ['4_14KW 587', ['W'], false],
    ['10KYG', ['Y'], false],
    ['BFLY14 KW 585', ['W'], false],
    ['14KY_K02167R02_REPAIR', ['Y'], false],
    ['14KW-1354-WG0LG57DZ3', ['W'], false],
    ['14KWY', ['W', 'Y'], true],
    ['18KWYR', ['W', 'Y', 'R'], true],
    ['14KTT', [], true],
    ['14KTT- 1354-VP0FA69D25', [], true],
    ['14K TT', [], true],
    ['14KTTT', [], true],
    ['14K 3T', [], true],
    ['14K-MOUNTING', [], false],
    ['1C4P', [], false],
  ])('%s', (code, colours, multiTone) => {
    expect(goldColours(code)).toEqual({ colours, multiTone });
  });
});

describe('metalTypeOf', () => {
  it('one gold colour is Gold', () => {
    expect(metalTypeOf([gold('14KW'), gold('14KW 585')])).toBe('GOLD');
    expect(metalTypeOf([gold('14K-MOUNTING')])).toBe('GOLD');
  });
  it('two-tone gold lots, or gold lots of two colours, are Gold 2 Tone', () => {
    expect(metalTypeOf([gold('14KTT')])).toBe('GOLD_2_TONE');
    expect(metalTypeOf([gold('14KWY')])).toBe('GOLD_2_TONE');
    expect(metalTypeOf([gold('14KW'), gold('14KY')])).toBe('GOLD_2_TONE');
    expect(metalTypeOf([gold('14KTTT')])).toBe('GOLD_2_TONE');
  });
  it('solder and findings do not make a line two-tone', () => {
    expect(metalTypeOf([gold('14KW'), gold('14KY SOLDER')])).toBe('GOLD');
    expect(metalTypeOf([gold('14KW'), { commodity: 'GOLD FINDING', lotCode: '14KY LEVER BACK' }])).toBe('GOLD');
  });
  it('silver, platinum and their gold mixes', () => {
    expect(metalTypeOf([{ commodity: 'SILVER', lotCode: '925' }])).toBe('SILVER');
    expect(metalTypeOf([{ commodity: 'SILVER', lotCode: '925' }, { commodity: 'STEEL', lotCode: 'SSW-0.25' }])).toBe('SILVER');
    expect(metalTypeOf([{ commodity: 'SILVER + GOLD', lotCode: '925+14KY' }])).toBe('GOLD_SILVER_2_TONE');
    expect(metalTypeOf([gold('14KY'), { commodity: 'SILVER', lotCode: '925' }])).toBe('GOLD_SILVER_2_TONE');
    expect(metalTypeOf([{ commodity: 'PLATINUM', lotCode: 'PT950' }])).toBe('PLATINUM');
    expect(metalTypeOf([gold('18KY'), { commodity: 'PLATINUM', lotCode: 'PT950' }])).toBe('GOLD_PLATINUM_2_TONE');
  });
  it('a gold finding on platinum or silver does not make it two-tone', () => {
    expect(metalTypeOf([{ commodity: 'PLATINUM', lotCode: 'PT950' }, { commodity: 'GOLD FINDING', lotCode: 'PST14KW 585' }])).toBe('PLATINUM');
    expect(metalTypeOf([{ commodity: 'GOLD FINDING', lotCode: 'PST14KW 585' }])).toBe('GOLD');
  });
  it('anything else is Other', () => {
    expect(metalTypeOf([{ commodity: 'MODERN GOLD', lotCode: 'MODERN GOLD' }])).toBe('OTHER');
    expect(metalTypeOf([])).toBe('OTHER');
  });
});
