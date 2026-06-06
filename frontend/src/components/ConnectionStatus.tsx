import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useRealtimeStore } from '@/stores/realtimeStore';
import { COLORS } from '@/constants/styles';

/**
 * Combined connectivity indicator.
 *
 *   green  = browser online + WS open
 *   yellow = browser online + WS connecting (reconnecting after a drop)
 *   red    = browser offline
 *
 * Tooltip text reflects the most-restrictive condition.
 */
export function ConnectionStatus() {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const wsStatus = useRealtimeStore((s) => s.status);

  let color: string = COLORS.success;
  let label = t('connection.online');
  if (!isOnline) {
    color = COLORS.danger;
    label = t('connection.offline');
  } else if (wsStatus === 'connecting' || wsStatus === 'closed') {
    color = '#facc15'; // yellow
    label = wsStatus === 'connecting' ? t('connection.ws_connecting') : t('connection.ws_closed');
  } else {
    label = t('connection.ws_open');
  }

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
