import dayjs from 'dayjs';

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null) return '—';
  return value.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtDate(value: string | null | undefined): string {
  return value ? dayjs(value).format('DD-MMM-YYYY') : '—';
}
