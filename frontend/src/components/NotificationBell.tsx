import { useState } from 'react';
import { Badge, Button, Popover, Typography } from 'antd';
import { IconBell } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNotifications, useMarkAllRead } from '@/hooks/useNotifications';
import type { INotification } from '@/types';

const { Text } = Typography;

const KIND_COLOR: Record<INotification['kind'], string> = {
  quota_80: '#faad14',
  quota_90: '#fa8c16',
  quota_95: '#ff4d4f',
  quota_100: '#cf1322',
  overdue: '#ff4d4f',
  action_required: '#1677ff',
  plan_submitted: '#1677ff',
  plan_approved: '#52c41a',
  plan_rejected: '#ff4d4f',
  mention: '#1677ff',
  task_assigned: '#fa8c16',
  task_done: '#52c41a',
};

export function NotificationBell() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { data: notifications = [] } = useNotifications();
  const markAllRead = useMarkAllRead();

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const content = (
    <div style={{ width: 320, maxHeight: 400, overflowY: 'auto', margin: '-12px -16px' }}>
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text strong style={{ fontSize: 13 }}>{t('notifications.title')}</Text>
        {unreadCount > 0 && (
          <Button
            size="small"
            type="link"
            onClick={() => markAllRead.mutate()}
            loading={markAllRead.isPending}
            style={{ fontSize: 12, padding: 0, height: 'auto' }}
          >
            {t('notifications.mark_all_read')}
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div style={{ padding: 16 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>{t('notifications.empty')}</Text>
        </div>
      ) : (
        notifications.slice(0, 30).map((n) => (
          <div
            key={n.id}
            style={{
              padding: '8px 16px',
              background: n.read_at ? undefined : '#f0f5ff',
              borderLeft: n.read_at ? undefined : `3px solid ${KIND_COLOR[n.kind]}`,
              borderBottom: '1px solid #f5f5f5',
            }}
          >
            <Text style={{ fontSize: 12, lineHeight: 1.4, display: 'block' }}>
              {n.kind === 'action_required'
                ? t('notifications.action_required', { cargo_code: n.message })
                : n.message}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {new Date(n.created_at).toLocaleString()}
            </Text>
          </div>
        ))
      )}
    </div>
  );

  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}
      placement="bottomRight"
      content={content}
      trigger="click"
      styles={{ container: { padding: 12 } }}
    >
      <Badge count={unreadCount > 99 ? '99+' : unreadCount} size="small" offset={[-4, 4]}>
        <Button
          type="text"
          icon={<IconBell size={18} />}
          style={{ color: '#595959', display: 'flex', alignItems: 'center' }}
          aria-label={t('notifications.title')}
        />
      </Badge>
    </Popover>
  );
}
