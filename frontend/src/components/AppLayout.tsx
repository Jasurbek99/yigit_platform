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
  IconBuildingWarehouse,
  IconLayoutGrid,
  IconUser,
  IconFileText,
  IconArrowsSort,
  IconMessageCircle,
  IconInbox,
  IconClipboardList,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { MenuProps } from 'antd';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications, useMarkAllRead } from '@/hooks/useNotifications';
import { useFeedbackAdminUnreadCount } from '@/hooks/useFeedback';
import { useMyTasks } from '@/hooks/useMyTasks';
import { canSeePage } from '@/utils/permissions';
import { clearCachedPrefs } from '@/cache/userPrefsCache';
import { FeedbackFAB } from '@/components/feedback/FeedbackFAB';
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
  action_required: '#1677ff',
  plan_submitted: '#1677ff',
  plan_approved: '#52c41a',
  plan_rejected: '#ff4d4f',
  mention: '#1677ff',
  task_assigned: '#fa8c16',
  task_done: '#52c41a',
};

// ─── NotificationBell ─────────────────────────────────────────────────────────

function NotificationBell() {
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

// ─── AppLayout ────────────────────────────────────────────────────────────────

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const { data: feedbackUnreadCount = 0 } = useFeedbackAdminUnreadCount();
  const { data: myTasksData } = useMyTasks({ enabled: !!user });
  const myOpenCount = (myTasksData?.results ?? []).filter(
    (task) => task.state === 'open',
  ).length;

  const { t, i18n } = useTranslation();

  const currentLang = i18n.language.startsWith('tk')
    ? 'tk'
    : i18n.language.startsWith('ru')
      ? 'ru'
      : 'en';

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout/'),
    onSuccess: async () => {
      // Drop the IDB-cached sheet prefs for this user before tearing down auth.
      // Shared-machine hygiene — the next user gets their own keyed entry, but
      // we don't want stale data sitting around indefinitely (Phase 2b).
      if (user?.id) {
        await clearCachedPrefs(user.id);
      }
      queryClient.removeQueries({ queryKey: ['auth', 'me'] });
      queryClient.clear();
      navigate('/login');
    },
  });

  const ROUTE_LABELS: Record<string, string> = {
    '/': t('nav.dashboard'),
    '/boss/dashboard': t('nav.boss_dashboard'),
    '/director/stuck-shipments': t('nav.stuck_shipments'),
    '/export/shipments': t('nav.shipments'),
    '/export/shipments/sheet': t('nav.shipment_sheet'),
    '/export/shipments/dashboard': t('nav.shipment_dashboard'),
    '/export/shipments/board': t('nav.shipment_board'),
    '/export/kanban': t('nav.kanban'),
    '/export/drafts': t('nav.drafts'),
    '/export/assign': t('nav.assign'),
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
    '/admin/import-firms': t('nav.admin_import_firms'),
    '/admin/permissions': t('nav.admin_permissions'),
    '/admin/blocks': t('nav.admin_blocks'),
    '/admin/customers': t('nav.admin_customers'),
    '/admin/truck-destinations': t('nav.admin_truck_dest'),
    '/admin/shipment-settings': t('nav.admin_shipment_settings'),
    '/me/board': t('me.nav.board'),
  };

  const currentPageLabel = location.pathname.startsWith('/shipments/')
    ? t('nav.shipment_detail')
    : /^\/admin\/firms\/\w+/.test(location.pathname)
    ? t('firms_admin.detail_title')
    : /^\/admin\/import-firms\/\w+/.test(location.pathname)
    ? t('import_firms_admin.detail_title')
    : ROUTE_LABELS[location.pathname] ?? '';

  const userInitial = user
    ? (user.first_name?.[0] || user.username?.[0] || 'U').toUpperCase()
    : 'U';

  // ─── Build menu items (filtered by dynamic page permissions) ────────────
  // Items are filtered via canSeePage() which reads page_permissions from
  // /auth/me/. A small minority of routes are role-gated instead (no
  // page_permissions entry — see /director/stuck-shipments for an example);
  // those carry an explicit `roles` array and bypass canSeePage.
  type MenuItem = {
    key: string;
    icon: React.ReactNode;
    label: string;
    roles?: import('@/types').UserRole[];
  };

  const allMenuGroups: { label: string; items: MenuItem[] }[] = [
    { label: t('nav.group_main'), items: [
      { key: '/', icon: <IconLayoutDashboard size={15} />, label: t('nav.dashboard') },
      { key: '/boss/dashboard', icon: <IconChartPie size={15} />, label: t('nav.boss_dashboard') },
      {
        key: '/director/stuck-shipments',
        icon: <IconAlertTriangle size={15} />,
        label: t('nav.stuck_shipments'),
        roles: ['admin', 'director', 'boss'],
      },
    ]},
    { label: t('nav.group_export'), items: [
      { key: '/export/shipments', icon: <IconTruck size={15} />, label: t('nav.shipments') },
      { key: '/export/shipments/sheet', icon: <IconLayoutGrid size={15} />, label: t('nav.shipment_sheet') },
      { key: '/export/shipments/dashboard', icon: <IconLayoutDashboard size={15} />, label: t('nav.shipment_dashboard') },
      { key: '/export/shipments/board', icon: <IconLayoutKanban size={15} />, label: t('nav.shipment_board') },
      { key: '/export/kanban', icon: <IconLayoutKanban size={15} />, label: t('nav.kanban') },
      { key: '/export/drafts', icon: <IconFileText size={15} />, label: t('nav.drafts') },
      { key: '/export/assign', icon: <IconArrowsSort size={15} />, label: t('nav.assign') },
      { key: '/export/overdue', icon: <IconAlertTriangle size={15} />, label: t('nav.overdue') },
      { key: '/export/advances', icon: <IconBuildingBank size={15} />, label: t('nav.advances') },
    ]},
    { label: t('nav.group_management'), items: [
      { key: '/export/plan', icon: <IconCalendar size={15} />, label: t('nav.plan') },
      { key: '/export/quota', icon: <IconChartPie size={15} />, label: t('nav.quota') },
      { key: '/export/prices', icon: <IconCurrencyDollar size={15} />, label: t('nav.prices') },
      { key: '/export/trucks', icon: <IconTruck size={15} />, label: t('nav.trucks') },
      { key: '/export/blocks', icon: <IconChartBar size={15} />, label: t('nav.blocks') },
      { key: '/export/domestic-sales', icon: <IconShoppingCart size={15} />, label: t('nav.domestic_sales') },
    ]},
    { label: t('nav.group_system'), items: [
      { key: '/admin/users', icon: <IconUsers size={15} />, label: t('nav.admin_users') },
      { key: '/admin/seasons', icon: <IconCalendar size={15} />, label: t('nav.admin_seasons') },
      { key: '/admin/firms', icon: <IconBuildingBank size={15} />, label: t('nav.admin_firms') },
      { key: '/admin/import-firms', icon: <IconBuildingBank size={15} />, label: t('nav.admin_import_firms') },
      { key: '/admin/customers', icon: <IconUser size={15} />, label: t('nav.admin_customers') },
      { key: '/admin/blocks', icon: <IconBuildingWarehouse size={15} />, label: t('nav.admin_blocks') },
      { key: '/admin/truck-destinations', icon: <IconTruck size={15} />, label: t('nav.admin_truck_dest') },
      { key: '/admin/shipment-settings', icon: <IconLayoutGrid size={15} />, label: t('nav.admin_shipment_settings') },
      { key: '/admin/permissions', icon: <IconShield size={15} />, label: t('nav.admin_permissions') },
    ]},
    { label: t('me.nav.label'), items: [
      {
        key: '/me/board',
        icon: (
          <Badge count={myOpenCount} size="small" offset={[8, -2]}>
            <IconClipboardList size={15} />
          </Badge>
        ),
        label: t('me.nav.board'),
        // Visible to all authenticated users — no role restriction needed.
        // The roles array lists every role so the canSeePage shortcut is bypassed
        // and the item is always visible regardless of page_permissions entries.
        roles: [
          'admin', 'export_manager', 'loading_dept_head', 'warehouse_chief',
          'weight_master', 'document_team', 'transport', 'sales_rep',
          'finansist', 'director', 'accountant', 'greenhouse_manager',
          'seller', 'boss',
        ] as import('@/types').UserRole[],
      },
    ]},
    { label: t('nav.group_feedback'), items: [
      {
        key: '/feedback/submit',
        icon: <IconMessageCircle size={15} />,
        label: t('nav.feedback_submit'),
        roles: ['admin', 'export_manager', 'loading_dept_head', 'warehouse_chief', 'weight_master',
          'document_team', 'transport', 'sales_rep', 'finansist', 'director',
          'accountant', 'greenhouse_manager', 'seller', 'boss'],
      },
      {
        key: '/feedback/my-tickets',
        icon: <IconFileText size={15} />,
        label: t('nav.feedback_my_tickets'),
        roles: ['admin', 'export_manager', 'loading_dept_head', 'warehouse_chief', 'weight_master',
          'document_team', 'transport', 'sales_rep', 'finansist', 'director',
          'accountant', 'greenhouse_manager', 'seller', 'boss'],
      },
      {
        key: '/feedback/public',
        icon: <IconChartPie size={15} />,
        label: t('nav.feedback_public'),
        roles: ['admin', 'export_manager', 'loading_dept_head', 'warehouse_chief', 'weight_master',
          'document_team', 'transport', 'sales_rep', 'finansist', 'director',
          'accountant', 'greenhouse_manager', 'seller', 'boss'],
      },
      {
        key: '/admin/feedback',
        icon: (
          <Badge count={feedbackUnreadCount} size="small" offset={[6, 0]}>
            <IconInbox size={15} />
          </Badge>
        ),
        label: t('nav.feedback_admin_inbox'),
        roles: ['admin'],
      },
    ]},
  ];

  // Filter: keep only items the user has permission to see
  const menuItems: MenuProps['items'] = allMenuGroups
    .map((group) => {
      const visibleChildren = group.items.filter((item) => {
        // Feedback admin inbox requires role === 'admin' exactly.
        // is_superuser alone is NOT sufficient — this check must run before
        // the shared is_superuser shortcut below so that a superuser whose
        // actual role is not 'admin' cannot see the inbox entry.
        if (item.key === '/admin/feedback') {
          return user?.role === 'admin';
        }
        // Role-gated items (no page_permissions entry) — use the inline list.
        if (item.roles) {
          if (!user) return false;
          if (user.is_superuser) return true;
          return item.roles.includes(user.role);
        }
        // Default: dynamic page permissions from /auth/me/
        return canSeePage(user, item.key);
      });
      if (visibleChildren.length === 0) return null;
      return {
        type: 'group' as const,
        label: group.label,
        children: visibleChildren,
      };
    })
    .filter(Boolean);

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
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
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
                {t('nav.sidebar_tagline')}
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
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{user?.role ? t(`roles.${user.role}`) : ''}</div>
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
              aria-label={t('nav.toggle_menu')}
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
        {/* Content is the scroll boundary: body never scrolls. Wide tables
            opt into their own horizontal scrollbar via scroll={{x:'max-content'}};
            full-height grid pages opt out via the .page-fullheight-grid class
            (see SheetStyles.css). */}
        <Content
          style={{
            background: '#f5f5f5',
            padding: 24,
            height: 'calc(100vh - 56px)',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
      <FeedbackFAB />
    </Layout>
  );
}
