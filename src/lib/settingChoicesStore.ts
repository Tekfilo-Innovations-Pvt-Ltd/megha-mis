import { promises as fs } from 'fs';
import path from 'path';
import type { SettingChoices } from '@/lib/settingChoices';

// Setting type choices live next to the customer stone corrections (same
// folder, so the same Docker volume keeps them), one file per company holding
// each chart's choices. A save keeps the previous file under backups/.
//   STONE_CORRECTION_DIR (default ./data/stone-corrections)
//     setting-types-company-<id>.json   { [chartCode]: SettingChoices }
//     backups/setting-types-company-<id>.<yyyymmdd-hhmmss>.json

const DIR = process.env.STONE_CORRECTION_DIR || path.join(process.cwd(), 'data', 'stone-corrections');
const BACKUP_DIR = path.join(DIR, 'backups');
const name = (companyId: number) => `setting-types-company-${Math.trunc(companyId)}`;
const file = (companyId: number) => path.join(DIR, `${name(companyId)}.json`);

type CompanyFile = Record<string, SettingChoices>;

// Read on every report request; cached until the file changes.
const cache = new Map<number, { mtimeMs: number; data: CompanyFile }>();

async function read(companyId: number): Promise<CompanyFile> {
  try {
    const stat = await fs.stat(file(companyId));
    const hit = cache.get(companyId);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.data;
    const data = JSON.parse(await fs.readFile(file(companyId), 'utf8')) as CompanyFile;
    cache.set(companyId, { mtimeMs: stat.mtimeMs, data });
    return data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}

export async function getSettingChoices(companyId: number, chartCode: string): Promise<SettingChoices | null> {
  return (await read(companyId))[chartCode] ?? null;
}

export async function saveSettingChoices(companyId: number, chartCode: string, choices: SettingChoices): Promise<void> {
  const current = await read(companyId);
  await fs.mkdir(DIR, { recursive: true });
  try {
    await fs.access(file(companyId));
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    await fs.copyFile(file(companyId), path.join(BACKUP_DIR, `${name(companyId)}.${stamp}.json`));
  } catch {
    // nothing saved yet
  }
  const tmp = `${file(companyId)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ ...current, [chartCode]: choices }) + '\n');
  await fs.rename(tmp, file(companyId));
  cache.delete(companyId);
}
