import { afterEach, describe, expect, it } from 'vitest';
import { hashSharedPassword, sharedLoginFor, verifySharedPassword } from './sharedLogin';

describe('shared MIS login', () => {
  afterEach(() => {
    delete process.env.MIS_SHARED_USERNAME;
    delete process.env.MIS_SHARED_PASSWORD_HASH;
    delete process.env.MIS_SHARED_NAME;
  });

  it('verifies only the right password, and never stores it in clear', () => {
    const stored = hashSharedPassword('Tq7m-K2xa-9Pwr');
    expect(stored).toMatch(/^scrypt:16384:8:1:[^:$]+:[^:$]+$/); // no '$': safe in .env
    expect(stored).not.toContain('Tq7m');
    expect(verifySharedPassword('Tq7m-K2xa-9Pwr', stored)).toBe(true);
    expect(verifySharedPassword('tq7m-k2xa-9pwr', stored)).toBe(false);
    expect(verifySharedPassword('', stored)).toBe(false);
    expect(verifySharedPassword('Tq7m-K2xa-9Pwr', 'garbage')).toBe(false);
  });

  it('applies only to its own user ID, and only when configured', () => {
    expect(sharedLoginFor('mis-viewer')).toBeNull();
    process.env.MIS_SHARED_USERNAME = 'mis-viewer';
    process.env.MIS_SHARED_PASSWORD_HASH = hashSharedPassword('Tq7m-K2xa-9Pwr');
    expect(sharedLoginFor(' MIS-Viewer ')).toMatchObject({ username: 'mis-viewer', name: 'MIS Viewer' });
    expect(sharedLoginFor('rajesh')).toBeNull();
  });
});
