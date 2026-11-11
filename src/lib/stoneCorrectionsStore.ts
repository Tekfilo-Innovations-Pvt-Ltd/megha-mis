import { promises as fs } from 'fs';
import path from 'path';
import type { StoneCorrections } from '@/lib/stoneCorrections';

// Customer stone corrections live as JSON files on the server, one per company
// (invoice numbers repeat across companies). A replace keeps the previous file
// under backups/ first, like the price charts.
//   STONE_CORRECTION_DIR (default ./data/stone-corrections)
//     company-<id>.json
//     backups/company-<id>.<yyyymmdd-hhmmss>.json

const DIR = process.env.STONE_CORRECTION_DIR || path.join(process.cwd(), 'data', 'stone-corrections');
const BACKUP_DIR = path.join(DIR, 'backups');
const file = (companyId: number) => path.join(DIR, `company-${Math.trunc(companyId)}.json`);

// Reports read the file on every request; cache it until the file changes.
const cache = new Map<number, { mtimeMs: number; data: StoneCorrections }>();

export async function getStoneCorrections(companyId: number): Promise<StoneCorrections | null> {
  try {
    const stat = await fs.stat(file(companyId));
    const hit = cache.get(companyId);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.data;
    const data = JSON.parse(await fs.readFile(file(companyId), 'utf8')) as StoneCorrections;
    cache.set(companyId, { mtimeMs: stat.mtimeMs, data });
    return data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function backup(companyId: number): Promise<string | null> {
  try {
    await fs.access(file(companyId));
  } catch {
    return null;
  }
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const target = path.join(BACKUP_DIR, `company-${Math.trunc(companyId)}.${stamp}.json`);
  await fs.copyFile(file(companyId), target);
  return path.relative(DIR, target);
}

export async function replaceStoneCorrections(companyId: number, data: StoneCorrections): Promise<{ backup: string | null }> {
  await fs.mkdir(DIR, { recursive: true });
  const saved = await backup(companyId);
  const tmp = `${file(companyId)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data) + '\n');
  await fs.rename(tmp, file(companyId));
  cache.delete(companyId);
  return { backup: saved };
}

export async function removeStoneCorrections(companyId: number): Promise<{ backup: string | null }> {
  const saved = await backup(companyId);
  if (saved) await fs.unlink(file(companyId));
  cache.delete(companyId);
  return { backup: saved };
}
