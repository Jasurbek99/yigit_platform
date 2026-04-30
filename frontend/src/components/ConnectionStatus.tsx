import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export function ConnectionStatus() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const color = isOnline ? '#52c41a' : '#ff4d4f';
  const label = isOnline ? t('connection.online') : t('connection.offline');

  return (
    <Tooltip title={label} placement="bottom">
      <div
        role="status"
        aria-label={label}
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            boxShadow: `0 0 0 3px ${color}22`,
          }}
        />
      </div>
    </Tooltip>
  );
}
