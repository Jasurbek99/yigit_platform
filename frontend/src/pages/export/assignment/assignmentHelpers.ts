import { COLORS } from '@/constants/styles';

export const FRESHNESS_BORDER: Record<'today' | 'yesterday' | 'aged', string> = {
  today: COLORS.success,
  yesterday: COLORS.warning,
  aged: COLORS.danger,
};
