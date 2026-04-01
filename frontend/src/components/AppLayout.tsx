import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout, Menu, Button, Dropdown, Typography, Segmented, Badge, Popover, List, Breadcrumb } from 'antd';
import {
  DashboardOutlined,
  CarOutlined,
  AppstoreOutlined,
  PieChartOutlined,
  CalendarOutlined,
  DollarOutlined,
  BankOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  WarningOutlined,
  TruckOutlined,
  BarChartOutlined,
  ShopOutlined,
  TeamOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications, useMarkAllRead } from '@/hooks/useNotifications';
import type { INotification } from '@/types';

const { Sider, Header, Content } = Layout;

const KIND_COLOR: Record<INotification['kind'], string> = {
  quota_80: '#faad14',
  quota_90: '#fa8c16',
  quota_95: '#ff4d4f',
  quota_100: '#cf1322',
  overdue: '#ff4d4f',
};

function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: notifications = [] } = useNotifications();
  const markAllRead = useMarkAllRead();

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const content = (
    <div style={{ width: 320, maxHeight: 400, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8 }}>
        <Typography.Text strong>{t('notifications.title')}</Typography.Text>
        {unreadCount > 0 && (
          <Button size="small" type="link" onClick={() => markAllRead.mutate()}>
            {t('notifications.mark_all_read')}
          </Button>
        )}
      </div>
      {notifications.length === 0 ? (
        <Typography.Text type="secondary">{t('notifications.empty')}</Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={notifications.slice(0, 30)}
          renderItem={(n) => (
            <List.Item
              style={{
                background: n.read_at ? undefined : '#f0f5ff',
                padding: '6px 0',
                borderLeft: n.read_at ? undefined : `3px solid ${KIND_COLOR[n.kind]}`,
                paddingLeft: n.read_at ? 0 : 8,
              }}
            >
              <List.Item.Meta
                title={<Typography.Text style={{ fontSize: 13 }}>{n.message}</Typography.Text>}
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {new Date(n.created_at).toLocaleString()}
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
    >
      <Badge count={unreadCount} size="small" offset={[-2, 2]}>
        <Button type="text" icon={<BellOutlined />} />
      </Badge>
    </Popover>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 768);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    function handleResize() {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setCollapsed(mobile);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('nav.sign_out'),
      onClick: () => logoutMutation.mutate(),
    },
  ];

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
  };

  const currentPageLabel = location.pathname.startsWith('/shipments/')
    ? t('nav.shipment_detail')
    : ROUTE_LABELS[location.pathname] ?? '';

  const menuItems = [
    {
      type: 'group' as const,
      label: 'Esasy',
      children: [
        { key: '/', icon: <DashboardOutlined />, label: t('nav.dashboard') },
      ],
    },
    {
      type: 'group' as const,
      label: 'Eksport',
      children: [
        { key: '/export/shipments', icon: <CarOutlined />, label: t('nav.shipments') },
        { key: '/export/kanban', icon: <AppstoreOutlined />, label: t('nav.kanban') },
        { key: '/export/overdue', icon: <WarningOutlined />, label: t('nav.overdue') },
        { key: '/export/advances', icon: <BankOutlined />, label: t('nav.advances') },
      ],
    },
    {
      type: 'group' as const,
      label: 'Dolandyryş',
      children: [
        { key: '/export/plan', icon: <CalendarOutlined />, label: t('nav.plan') },
        { key: '/export/quota', icon: <PieChartOutlined />, label: t('nav.quota') },
        { key: '/export/prices', icon: <DollarOutlined />, label: t('nav.prices') },
        { key: '/export/trucks', icon: <TruckOutlined />, label: t('nav.trucks') },
        { key: '/export/blocks', icon: <BarChartOutlined />, label: t('nav.blocks') },
        { key: '/export/domestic-sales', icon: <ShopOutlined />, label: t('nav.domestic_sales') },
      ],
    },
    ...(user?.role === 'director'
      ? [
          {
            type: 'group' as const,
            label: 'Ulgam',
            children: [
              { key: '/admin/users', icon: <TeamOutlined />, label: t('nav.admin_users') },
              { key: '/admin/seasons', icon: <CalendarOutlined />, label: t('nav.admin_seasons') },
              { key: '/admin/firms', icon: <BankOutlined />, label: t('nav.admin_firms') },
            ],
          },
        ]
      : []),
  ];

  const userInitial = user
    ? (user.first_name?.[0] || user.username?.[0] || 'U').toUpperCase()
    : 'U';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Overlay mask for mobile */}
      {isMobile && !collapsed && (
        <div
          onClick={() => setCollapsed(true)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 99,
          }}
        />
      )}

      <Sider
        breakpoint="lg"
        collapsedWidth={0}
        collapsed={collapsed}
        onBreakpoint={(broken) => {
          setCollapsed(broken);
          setIsMobile(broken);
        }}
        trigger={null}
        zeroWidthTriggerStyle={{ display: 'none' }}
        width={220}
        style={{
          background: '#001529',
          position: isMobile ? 'fixed' : 'relative',
          height: isMobile ? '100vh' : '100vh',
          zIndex: isMobile ? 100 : undefined,
          top: 0,
          left: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Logo header */}
        <div
          style={{
            padding: '0 20px',
            height: 56,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
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
              <div
                style={{
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 15,
                  lineHeight: '1.2',
                  letterSpacing: '-0.01em',
                }}
              >
                YGT Platform
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
                Operasiýalar
              </div>
            </div>
          )}
        </div>

        {/* Nav menu — fills remaining space and scrolls if needed */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => {
              navigate(key);
              if (isMobile) setCollapsed(true);
            }}
            style={{ borderRight: 0 }}
          />
        </div>

        {/* User profile pinned to bottom */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
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
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#fff',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user?.first_name || user?.username}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                {user?.role}
              </div>
            </div>
          )}
          <Dropdown menu={{ items: userMenuItems }} placement="topRight">
            <Button
              type="text"
              size="small"
              icon={<LogoutOutlined />}
              style={{ color: 'rgba(255,255,255,0.45)' }}
            />
          </Dropdown>
        </div>
      </Sider>

      <Layout style={{ marginLeft: isMobile ? 0 : undefined }}>
        <Header
          style={{
            background: '#fff',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            height: 56,
            position: 'sticky',
            top: 0,
            zIndex: 98,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            {!isMobile && (
              <Breadcrumb
                items={[
                  { title: <Link to="/">YGT</Link> },
                  ...(currentPageLabel ? [{ title: currentPageLabel }] : []),
                ]}
                style={{ fontSize: 13 }}
              />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
          </div>
        </Header>

        <Content style={{ padding: isMobile ? '12px 8px' : '24px', overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
