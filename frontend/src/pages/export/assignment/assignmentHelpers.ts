import type { IDemandItem } from '@/types';

export const FRESHNESS_BORDER: Record<'today' | 'yesterday' | 'aged', string> = {
  today: '#52c41a',
  yesterday: '#faad14',
  aged: '#ff4d4f',
};

export function getDemandGroups(
  items: IDemandItem[],
  t: (key: string) => string,
): { label: string; items: IDemandItem[] }[] {
  return [
    { label: t('assign.group_contracts'), items: items.filter((d) => d.type === 'contract') },
    { label: t('assign.group_quota'), items: items.filter((d) => d.type === 'quota') },
    { label: t('assign.group_queue'), items: items.filter((d) => d.type === 'queue') },
  ].filter((g) => g.items.length > 0);
}
