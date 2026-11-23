import { classifyProcess, type LabourClass } from '@/lib/labourComparison';

// Labour types as people read them — the chart's charge classes grouped. Used
// to set two factories' labour side by side when they name their processes
// differently ("Basic" at AAA, "Basic 胚底" at RTPHK). Pure: server and browser.

export const LABOUR_TYPE: Record<LabourClass, string> = {
  BASIC: 'Basic / CPF',
  RHODIUM: 'Plating / rhodium',
  PLATING: 'Plating / rhodium',
  LASER_STAMPING: 'Laser stamping',
  COVER_BACK: 'Cover back / J-back',
  J_BACK: 'Cover back / J-back',
  SOLDERING: 'Soldering',
  TWO_TONE: 'Two tone',
  SETTING: 'Stone setting',
};

// A labour row's type; a process the chart has no class for keeps its own name.
// Rows the report adds for setting recorded on the stones ("Side Stone Setting")
// are stone setting too.
export function labourTypeOf(process: string): string {
  const cls = classifyProcess(process.trim());
  if (cls) return LABOUR_TYPE[cls];
  if (/setting/i.test(process)) return LABOUR_TYPE.SETTING;
  return process.trim();
}
