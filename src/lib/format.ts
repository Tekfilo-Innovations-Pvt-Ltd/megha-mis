import dayjs from 'dayjs';

// One Intl formatter per digits setting — toLocaleString builds a new one on
// every call, which adds up over the report tables' thousands of cells.
const formatters = new Map<number, Intl.NumberFormat>();

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null) return '—';
  let f = formatters.get(digits);
  if (!f) formatters.set(digits, (f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(value);
}

export function fmtDate(value: string | null | undefined): string {
  return value ? dayjs(value).format('DD-MMM-YYYY') : '—';
}
