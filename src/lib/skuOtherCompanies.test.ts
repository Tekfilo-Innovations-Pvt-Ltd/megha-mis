import { describe, expect, it } from 'vitest';
import { baseSku, skuVariants } from '@/lib/skuOtherCompanies';

describe('SKU -A clones', () => {
  it('treats an AAA "-A" clone as the RTPHK SKU', () => {
    expect(baseSku('NR132911RP75-A')).toBe('NR132911RP75');
    expect(baseSku('nr132911rp75-a ')).toBe('nr132911rp75');
    expect(baseSku('NR132910R-R6')).toBe('NR132910R-R6'); // a hyphen inside the SKU stays
    expect(skuVariants('RT1235-A')).toEqual(['RT1235', 'RT1235-A']);
    expect(skuVariants('RT1235')).toEqual(['RT1235', 'RT1235-A']);
  });
});
