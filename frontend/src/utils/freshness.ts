import dayjs from 'dayjs';

export type Freshness = 'today' | 'yesterday' | 'old';

export function getFreshness(createdAt: string): Freshness {
  const hours = dayjs().diff(dayjs(createdAt), 'hour');
  if (hours < 24) return 'today';
  if (hours < 48) return 'yesterday';
  return 'old';
}
