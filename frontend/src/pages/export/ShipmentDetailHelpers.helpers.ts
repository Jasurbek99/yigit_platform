import dayjs from 'dayjs';

export function fmt(val: string | null | undefined): string {
  if (!val) return '—';
  return dayjs(val).format('DD.MM.YYYY HH:mm');
}

export function fmtDate(val: string | null | undefined): string {
  if (!val) return '—';
  return dayjs(val).format('DD.MM.YYYY');
}

export function fmtNum(val: number | null | undefined): string {
  if (val == null) return '—';
  return Number(val).toLocaleString();
}
