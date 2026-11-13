// Production build on a Windows PC:  npm run build:local   (then: npm run start)
//
// Why not plain `npm run build`:
//  - The Prisma client is generated into src/generated/erp, so webpack bundles its
//    runtime, which contains dotenv's "~" expansion (os.homedir()). With
//    output: 'standalone', Next's file tracer turns that into a glob of the whole
//    home folder, C:/Users/<you>/**/*, and fails on Windows' protected links
//    ("Application Data", "Cookies" → EPERM). Docker/Linux homes are small, so
//    the Docker build is unaffected. Here the build sees an empty home folder.
//  - `prisma generate` takes ~10 minutes on this PC; it is skipped when the
//    client already exists. Pass --generate after changing prisma/schema.prisma.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const run = (cmd, args, env = process.env) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const clientExists = fs.existsSync(path.join(root, 'src', 'generated', 'erp', 'index.js'));
if (process.argv.includes('--generate') || !clientExists) run(bin('prisma'), ['generate']);

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-build-home-'));
try {
  run(bin('next'), ['build'], { ...process.env, USERPROFILE: home, HOME: home });
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
