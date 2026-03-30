import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Dropdown, Typography, Segmented, Badge, Popover, List } from 'antd';
import {
  DashboardOutlined,
  CarOutlined,
  AppstoreOutlined,
  PieChartOutlined,
  CalendarOutlined,
  DollarOutlined,
  BankOutlined,
  LogoutOutlined,
  UserOutlined,
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

  const NAV_ITEMS = [
    { key: '/', icon: <DashboardOutlined />, label: t('nav.dashboard') },
    { key: '/export/shipments', icon: <CarOutlined />, label: t('nav.shipments') },
    { key: '/export/kanban', icon: <AppstoreOutlined />, label: t('nav.kanban') },
    { key: '/export/overdue', icon: <WarningOutlined />, label: t('nav.overdue') },
    { key: '/export/advances', icon: <BankOutlined />, label: t('nav.advances') },
    { key: '/export/plan', icon: <CalendarOutlined />, label: t('nav.plan') },
    { key: '/export/quota', icon: <PieChartOutlined />, label: t('nav.quota') },
    { key: '/export/prices', icon: <DollarOutlined />, label: t('nav.prices') },
    { key: '/export/trucks', icon: <TruckOutlined />, label: t('nav.trucks') },
    { key: '/export/blocks', icon: <BarChartOutlined />, label: t('nav.blocks') },
    { key: '/export/domestic-sales', icon: <ShopOutlined />, label: t('nav.domestic_sales') },
    ...(user?.role === 'director'
      ? [
          { key: '/admin/users', icon: <TeamOutlined />, label: t('nav.admin_users') },
          { key: '/admin/seasons', icon: <CalendarOutlined />, label: t('nav.admin_seasons') },
          { key: '/admin/firms', icon: <BankOutlined />, label: t('nav.admin_firms') },
        ]
      : []),
  ];

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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Overlay mask for mobile — closes sidebar when clicking outside */}
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
          height: isMobile ? '100vh' : undefined,
          zIndex: isMobile ? 100 : undefined,
          top: 0,
          left: 0,
        }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: '0 16px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <Typography.Text style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
            YGT Platform
          </Typography.Text>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={NAV_ITEMS}
          onClick={({ key }) => {
            navigate(key);
            // Auto-close sidebar on mobile after navigation
            if (isMobile) setCollapsed(true);
          }}
          style={{ borderRight: 0 }}
        />
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
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Segmented
              size="small"
              value={currentLang}
              options={[
                { label: 'ТМ', value: 'tk' },
                { label: 'RU', value: 'ru' },
                { label: 'EN', value: 'en' },
              ]}
              onChange={(lang) => i18n.changeLanguage(lang as string)}
            />

            <NotificationBell />

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar icon={<UserOutlined />} size="small" />
                {user && !isMobile && (
                  <Typography.Text>
                    {user.first_name || user.username}
                  </Typography.Text>
                )}
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content style={{ margin: isMobile ? '12px 8px' : '16px', overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
