import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Badge, Popover, Typography, Segmented, Flex } from 'antd';
import {
  IconLayoutDashboard,
  IconTruck,
  IconLayoutKanban,
  IconAlertTriangle,
  IconBuildingBank,
  IconCalendar,
  IconChartPie,
  IconCurrencyDollar,
  IconChartBar,
  IconShoppingCart,
  IconUsers,
  IconLogout,
  IconBell,
  IconMenu2,
  IconShield,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { MenuProps } from 'antd';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications, useMarkAllRead } from '@/hooks/useNotifications';
import type { INotification } from '@/types';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

// ─── Constants ────────────────────────────────────────────────────────────────

const KIND_COLOR: Record<INotification['kind'], string> = {
  quota_80: '#faad14',
  quota_90: '#fa8c16',
  quota_95: '#ff4d4f',
  quota_100: '#cf1322',
  overdue: '#ff4d4f',
};

// ─── NotificationBell ─────────────────────────────────────────────────────────

function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
            <Text style={{ fontSize: 12, lineHeight: 1.4, display: 'block' }}>{n.message}</Text>
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
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      content={content}
      trigger="click"
      overlayInnerStyle={{ padding: 12 }}
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

// ─── AppLayout ────────────────────────────────────────────────────────────────

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const { t, i18n } = useTranslation();

  const currentLang = i18n.language.startsWith('tk')
    ? 'tk'
    : i18n.language.startsWith('ru')
      ? 'ru'
      : 'en';

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout/'),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['auth', 'me'] });
      queryClient.clear();
      navigate('/login');
    },
  });

  const ROUTE_LABELS: Record<string, string> = {
    '/': t('nav.dashboard'),
    '/export/shipments': t('nav.shipments'),
    '/export/kanban': t('nav.kanban'),
    '/export/overdue': t('nav.overdue'),
    '/export/advances': t('nav.advances'),
    '/export/plan': t('nav.plan'),
    '/export/quota': t('nav.quota'),
    '/export/prices': t('nav.prices'),
    '/export/trucks': t('nav.trucks'),
    '/export/blocks': t('nav.blocks'),
    '/export/domestic-sales': t('nav.domestic_sales'),
    '/admin/users': t('nav.admin_users'),
    '/admin/seasons': t('nav.admin_seasons'),
    '/admin/firms': t('nav.admin_firms'),
    '/admin/permissions': t('nav.admin_permissions'),
  };

  const currentPageLabel = location.pathname.startsWith('/shipments/')
    ? t('nav.shipment_detail')
    : ROUTE_LABELS[location.pathname] ?? '';

  const userInitial = user
    ? (user.first_name?.[0] || user.username?.[0] || 'U').toUpperCase()
    : 'U';

  // ─── Build menu items ─────────────────────────────────────────────────────

  const menuItems: MenuProps['items'] = [
    { type: 'group', label: 'Esasy', children: [
      { key: '/', icon: <IconLayoutDashboard size={15} />, label: t('nav.dashboard') },
    ]},
    { type: 'group', label: 'Eksport', children: [
      { key: '/export/shipments', icon: <IconTruck size={15} />, label: t('nav.shipments') },
      { key: '/export/kanban', icon: <IconLayoutKanban size={15} />, label: t('nav.kanban') },
      { key: '/export/overdue', icon: <IconAlertTriangle size={15} />, label: t('nav.overdue') },
      { key: '/export/advances', icon: <IconBuildingBank size={15} />, label: t('nav.advances') },
    ]},
    { type: 'group', label: 'Dolandyryş', children: [
      { key: '/export/plan', icon: <IconCalendar size={15} />, label: t('nav.plan') },
      { key: '/export/quota', icon: <IconChartPie size={15} />, label: t('nav.quota') },
      { key: '/export/prices', icon: <IconCurrencyDollar size={15} />, label: t('nav.prices') },
      { key: '/export/trucks', icon: <IconTruck size={15} />, label: t('nav.trucks') },
      { key: '/export/blocks', icon: <IconChartBar size={15} />, label: t('nav.blocks') },
      { key: '/export/domestic-sales', icon: <IconShoppingCart size={15} />, label: t('nav.domestic_sales') },
    ]},
    ...(user?.role === 'director' || user?.is_superuser ? [{
      type: 'group' as const, label: 'Ulgam', children: [
        { key: '/admin/users', icon: <IconUsers size={15} />, label: t('nav.admin_users') },
        { key: '/admin/seasons', icon: <IconCalendar size={15} />, label: t('nav.admin_seasons') },
        { key: '/admin/firms', icon: <IconBuildingBank size={15} />, label: t('nav.admin_firms') },
        { key: '/admin/permissions', icon: <IconShield size={15} />, label: t('nav.admin_permissions') },
      ],
    }] : []),
  ];

  const selectedKey = location.pathname.startsWith('/shipments/')
    ? '/export/shipments'
    : location.pathname;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ── Sider ─────────────────────────────────────────────────────── */}
      <Sider
        width={220}
        collapsible
        collapsed={collapsed}
        trigger={null}
        breakpoint="lg"
        collapsedWidth={0}
        onBreakpoint={(broken) => setCollapsed(broken)}
        style={{
          background: '#001529',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Logo */}
        <div
          style={{
            height: 56,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 20px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              background: '#1677ff',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 14,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            Y
          </div>
          {!collapsed && (
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 15, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                YGT Platform
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
                Operasiýalar
              </div>
            </div>
          )}
        </div>

        {/* Nav menu */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin' }}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ background: 'transparent', border: 'none', fontSize: 13 }}
          />
        </div>

        {/* User footer */}
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '12px 16px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#389e0d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {userInitial}
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user?.first_name || user?.username}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{user?.role}</div>
            </div>
          )}
          <Button
            type="text"
            icon={<IconLogout size={15} />}
            style={{ color: 'rgba(255,255,255,0.45)', padding: 4, minWidth: 'auto', height: 'auto' }}
            onClick={() => logoutMutation.mutate()}
            loading={logoutMutation.isPending}
            aria-label={t('nav.sign_out')}
          />
        </div>
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 0 : 220, transition: 'margin-left 0.2s' }}>
        {/* ── Header ──────────────────────────────────────────────────── */}
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 16px',
            height: 56,
            lineHeight: '56px',
            position: 'sticky',
            top: 0,
            zIndex: 99,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Left: burger + breadcrumb */}
          <Flex align="center" gap={8}>
            <Button
              type="text"
              icon={<IconMenu2 size={18} />}
              onClick={() => setCollapsed((c) => !c)}
              style={{ color: '#595959', display: 'flex', alignItems: 'center' }}
              aria-label="Toggle navigation"
            />
            <Flex align="center" gap={6} style={{ fontSize: 13 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>YGT</Text>
              {currentPageLabel && (
                <>
                  <Text type="secondary" style={{ fontSize: 13 }}>/</Text>
                  <Text style={{ fontSize: 13, color: '#1f1f1f' }}>{currentPageLabel}</Text>
                </>
              )}
            </Flex>
          </Flex>

          {/* Right: lang switcher + notifications */}
          <Flex align="center" gap={12}>
            <Segmented
              size="small"
              value={currentLang}
              options={[
                { label: 'TM', value: 'tk' },
                { label: 'RU', value: 'ru' },
                { label: 'EN', value: 'en' },
              ]}
              onChange={(lang) => i18n.changeLanguage(lang as string)}
            />
            <NotificationBell />
          </Flex>
        </Header>

        {/* ── Content ─────────────────────────────────────────────────── */}
        <Content style={{ background: '#f5f5f5', padding: 24, minHeight: 'calc(100vh - 56px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
