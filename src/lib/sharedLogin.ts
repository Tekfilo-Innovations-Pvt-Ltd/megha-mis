import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// A common, MIS-only login (user's request 2026-11-14): one user ID and
// password for people who have no ERP account, VIEW ONLY. It lives in the
// server's .env — never in git, never in the ERP (MIS stays read-only):
//   MIS_SHARED_USERNAME=mis-viewer
//   MIS_SHARED_PASSWORD_HASH=scrypt:16384:8:1:<salt>:<hash>
//   MIS_SHARED_NAME=MIS Viewer           (optional, shown in the app)
// The hash uses ':' separators because .env values expand "$NAME".
// Set or change it with:  npx tsx scripts/set-shared-login.ts <username> [password]
// It gets every company that has factory invoices and no role, so the
// permission checks (src/lib/rbac.ts) refuse uploads, AI settings and Ask MIS.

const KEY_LENGTH = 32;

export function hashSharedPassword(password: string): string {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join(':');
}

export function verifySharedPassword(password: string, stored: string): boolean {
  const [kind, N, r, p, salt, hash] = stored.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// The shared login's settings when `login` is its user ID (case-insensitive)
// and it is configured; null otherwise, so ERP users sign in as before.
export function sharedLoginFor(login: string): { username: string; passwordHash: string; name: string } | null {
  const username = process.env.MIS_SHARED_USERNAME?.trim();
  const passwordHash = process.env.MIS_SHARED_PASSWORD_HASH?.trim();
  if (!username || !passwordHash || login.trim().toLowerCase() !== username.toLowerCase()) return null;
  return { username, passwordHash, name: process.env.MIS_SHARED_NAME?.trim() || 'MIS Viewer' };
}
