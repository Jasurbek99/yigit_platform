import { Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';
import type { SaveState } from './DetailFieldRow.helpers';

const { Text } = Typography;

interface IDetailFieldRowStatusProps {
  saveState: SaveState;
  /** Re-commits the row's current draft. Wired to the error state's retry link. */
  onRetry: () => void;
}

/**
 * The four-state save indicator next to a DetailFieldRow's value: nothing
 * (idle), a spinner (pending), a green "Saved" label (saved), or a red error
 * message with a retry link (error). State derivation lives in
 * deriveSaveState (DetailFieldRow.helpers.ts) — this component only renders
 * the result.
 */
export function DetailFieldRowStatus({ saveState, onRetry }: IDetailFieldRowStatusProps) {
  const { t } = useTranslation();

  if (saveState === 'pending') {
    return <Spin size="small" />;
  }
  if (saveState === 'saved') {
    return <Text style={{ fontSize: 11, color: COLORS.success }}>{t('shipment.detail.saved')}</Text>;
  }
  if (saveState === 'error') {
    return (
      <Text style={{ fontSize: 11, color: COLORS.danger }}>
        {t('shipment.detail.save_failed')}{' '}
        <a onClick={onRetry}>{t('shipment.detail.retry')}</a>
      </Text>
    );
  }
  return null;
}
