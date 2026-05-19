import type { IDemandItem } from '@/types';
import { COLORS } from '@/constants/styles';

export const FRESHNESS_BORDER: Record<'today' | 'yesterday' | 'aged', string> = {
  today: COLORS.success,
  yesterday: COLORS.warning,
  aged: COLORS.danger,
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
