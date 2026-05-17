import dayjs from 'dayjs';

export function computeExpiry(issueDate: string, validity: string): dayjs.Dayjs {
  const d = dayjs(issueDate);
  if (validity === 'this_month') return d.endOf('month');
  if (validity === 'next_month') return d.add(1, 'month').endOf('month');
  if (validity === 'this_and_next') return d.add(1, 'month').endOf('month');
  return d.endOf('month'); // safe fallback
}
