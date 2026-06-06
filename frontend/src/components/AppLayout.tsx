import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Badge, Typography, Segmented, Flex } from 'antd';
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
  IconPlant2,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { MenuProps } from 'antd';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import { useFeedbackAdminUnreadCount } from '@/hooks/useFeedback';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useRealtime } from '@/hooks/useRealtime';
import { canSeePage } from '@/utils/permissions';
import { clearCachedPrefs } from '@/cache/userPrefsCache';
import { FeedbackFAB } from '@/components/feedback/FeedbackFAB';
import { NotificationBell } from '@/components/NotificationBell';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { COLORS } from '@/constants/styles';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

// ─── AppLayout ────────────────────────────────────────────────────────────────

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  useRealtime({ enabled: !!user });
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
    '/export/harvest-board': t('nav.harvest_board'),
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
    '/admin/audit-log': t('nav.admin_audit_log'),
    '/me/board': t('me.nav.board'),
    '/contracts': t('nav.contracts.list'),
    '/invoices': t('nav.invoices.list'),
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
      },
    ]},
    { label: t('nav.group_export'), items: [
      { key: '/export/shipments/dashboard', icon: <IconLayoutDashboard size={15} />, label: t('nav.shipment_dashboard') },
      { key: '/export/shipments', icon: <IconTruck size={15} />, label: t('nav.shipments') },
      { key: '/export/shipments/sheet', icon: <IconLayoutGrid size={15} />, label: t('nav.shipment_sheet') },
      {
        key: '/me/board',
        icon: (
          <Badge count={myOpenCount} size="small" offset={[8, -2]}>
            <IconClipboardList size={15} />
          </Badge>
        ),
        label: t('me.nav.board'),
        // Matrix-driven via page_code 'me.board' (seeded visible for every role).
      },
      { key: '/export/shipments/board', icon: <IconLayoutKanban size={15} />, label: t('nav.shipment_board') },
      { key: '/export/harvest-board', icon: <IconPlant2 size={15} />, label: t('nav.harvest_board') },
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
      {
        key: '/admin/audit-log',
        icon: <IconClipboardList size={15} />,
        label: t('nav.admin_audit_log'),
      },
    ]},
    { label: t('nav.group_contracts'), items: [
      {
        key: '/contracts',
        icon: <IconFileText size={15} />,
        label: t('nav.contracts.list'),
        // TODO: register page_code 'contracts.list' in backend seed_page_codes.py and
        // remove the roles bypass below. Until that migration runs on the server,
        // canSeePage() returns false for non-superusers (no page_permissions entry).
        // Using roles: ALL_ROLES to temporarily surface the entry to every authenticated user.
        roles: [
          'admin', 'export_manager', 'loading_dept_head', 'warehouse_chief',
          'weight_master', 'document_team', 'transport', 'sales_rep', 'finansist',
          'director', 'accountant', 'greenhouse_manager', 'seller', 'boss',
        ] as import('@/types').UserRole[],
      },
      {
        key: '/invoices',
        icon: <IconFileText size={15} />,
        label: t('nav.invoices.list'),
        // TODO: register page_code 'contracts.invoices' in backend seed_page_codes.py and
        // remove the roles bypass below. Until that migration runs on the server,
        // canSeePage() returns false for non-superusers (no page_permissions entry).
        // Using roles: ALL_ROLES to temporarily surface the entry to every authenticated user.
        roles: [
          'admin', 'export_manager', 'loading_dept_head', 'warehouse_chief',
          'weight_master', 'document_team', 'transport', 'sales_rep', 'finansist',
          'director', 'accountant', 'greenhouse_manager', 'seller', 'boss',
        ] as import('@/types').UserRole[],
      },
    ]},
    { label: t('nav.group_feedback'), items: [
      {
        key: '/feedback/submit',
        icon: <IconMessageCircle size={15} />,
        label: t('nav.feedback_submit'),
      },
      {
        key: '/feedback/my-tickets',
        icon: <IconFileText size={15} />,
        label: t('nav.feedback_my_tickets'),
      },
      {
        key: '/feedback/public',
        icon: <IconChartPie size={15} />,
        label: t('nav.feedback_public'),
      },
      {
        key: '/admin/feedback',
        icon: (
          <Badge count={feedbackUnreadCount} size="small" offset={[6, 0]}>
            <IconInbox size={15} />
          </Badge>
        ),
        label: t('nav.feedback_admin_inbox'),
      },
    ]},
  ];

  // Filter: keep only items the user has permission to see
  const menuItems: MenuProps['items'] = allMenuGroups
    .map((group) => {
      const visibleChildren = group.items.filter((item) => {
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
              background: COLORS.primary,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 14,
              color: COLORS.white,
              flexShrink: 0,
            }}
          >
            Y
          </div>
          {!collapsed && (
            <div>
              <div style={{ color: COLORS.white, fontWeight: 600, fontSize: 15, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                {t('nav.brand_name')}
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
              color: COLORS.white,
              flexShrink: 0,
            }}
          >
            {userInitial}
          </div>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: COLORS.white,
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
            background: COLORS.white,
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
              style={{ color: COLORS.textTertiary, display: 'flex', alignItems: 'center' }}
              aria-label={t('nav.toggle_menu')}
            />
            <Flex align="center" gap={6} style={{ fontSize: 13 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>YGT</Text>
              {currentPageLabel && (
                <>
                  <Text type="secondary" style={{ fontSize: 13 }}>/</Text>
                  <Text style={{ fontSize: 13, color: COLORS.textDark }}>{currentPageLabel}</Text>
                </>
              )}
            </Flex>
          </Flex>

          {/* Right: connection dot + lang switcher + notifications */}
          <Flex align="center" gap={12}>
            <ConnectionStatus />
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
            background: COLORS.bgLight,
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
