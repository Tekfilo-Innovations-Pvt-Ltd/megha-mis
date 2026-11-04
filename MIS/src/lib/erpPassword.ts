import { pbkdf2Sync, timingSafeEqual } from 'crypto';

// Verifies a password against tbl_user.password, matching the ERP's own
// SSOUtil.validatePassword (jew-trade-service): PBKDF2WithHmacSHA1, stored as
// "<iterations>:<hex salt>:<hex hash>".
export function verifyErpPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3) return false;

  const iterations = parseInt(parts[0], 10);
  const salt = Buffer.from(parts[1], 'hex');
  const hash = Buffer.from(parts[2], 'hex');
  if (!iterations || salt.length === 0 || hash.length === 0) return false;

  const candidate = pbkdf2Sync(password, salt, iterations, hash.length, 'sha1');
  return timingSafeEqual(candidate, hash);
}
