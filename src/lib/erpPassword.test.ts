import { describe, expect, it } from 'vitest';
import { pbkdf2Sync } from 'crypto';
import { verifyErpPassword } from './erpPassword';

// Builds a stored value the same way the ERP's SSOUtil.generateStrongPasswordHash does.
function erpHash(password: string, saltHex: string, iterations = 1000) {
  const hash = pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iterations, 64, 'sha1');
  return `${iterations}:${saltHex}:${hash.toString('hex')}`;
}

describe('verifyErpPassword', () => {
  const stored = erpHash('secret123', '0123456789abcdef0123456789abcdef');

  it('accepts the right password', () => {
    expect(verifyErpPassword('secret123', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(verifyErpPassword('secret124', stored)).toBe(false);
  });

  it('rejects malformed stored values', () => {
    expect(verifyErpPassword('secret123', 'not-a-hash')).toBe(false);
    expect(verifyErpPassword('secret123', '')).toBe(false);
  });
});
