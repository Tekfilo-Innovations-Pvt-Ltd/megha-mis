// Sets (or changes) the common MIS-only viewer login in .env — see src/lib/sharedLogin.ts.
//   npx tsx scripts/set-shared-login.ts <username> [password] [--name "Display name"]
// Without a password one is generated and printed once. Only the hash is
// stored. Restart the server afterwards (npm run start) to pick it up.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashSharedPassword } from '../src/lib/sharedLogin';

const args = process.argv.slice(2);
const nameAt = args.indexOf('--name');
const displayName = nameAt >= 0 ? args[nameAt + 1] : null;
const positional = args.filter((a, i) => a !== '--name' && i !== nameAt + 1);
const [username, given] = positional;
if (!username || !/^[A-Za-z0-9._@-]{3,64}$/.test(username)) {
  console.error('Usage: npx tsx scripts/set-shared-login.ts <username> [password] [--name "Display name"]  (username: 3-64 letters, digits, . _ @ -)');
  process.exit(1);
}
// A short password is the owner's call (2026-11-14: a simple internal one was
// asked for) — warned about, not refused; only an empty-ish one is refused.
if (given != null && given.length < 4) {
  console.error('Password must be at least 4 characters.');
  process.exit(1);
}
if (given != null && given.length < 10) {
  console.warn(`Note: a ${given.length}-character password is easy to guess — fine for internal use, but don't expose the server to the internet with it.`);
}
// Readable generated password: 4 groups of 4 from an alphabet without look-alikes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const generated = () =>
  Array.from({ length: 4 }, () => Array.from(randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('')).join('-');
const password = given ?? generated();

const envFile = path.join(process.cwd(), '.env');
let env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const eol = env.includes('\r\n') ? '\r\n' : '\n';
const set = (key: string, value: string) => {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, line) : `${env}${env && !env.endsWith(eol) ? eol : ''}${line}${eol}`;
};
set('MIS_SHARED_USERNAME', username);
set('MIS_SHARED_PASSWORD_HASH', hashSharedPassword(password));
if (displayName) set('MIS_SHARED_NAME', `'${displayName.replace(/'/g, '')}'`);
fs.writeFileSync(envFile, env);

console.log(`Shared MIS login saved to .env (view only, every company with factory invoices).`);
console.log(`  User ID : ${username}`);
console.log(given ? '  Password: (as given)' : `  Password: ${password}   <- shown once, store it safely`);
console.log('Restart the server (npm run start) for it to take effect.');
