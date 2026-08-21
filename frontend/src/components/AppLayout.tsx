import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Badge, Typography, Segmented, Flex, Tooltip, Modal, Tag } from 'antd';
import {
  IconLayoutDashboard,
  IconTruck,
  IconLayoutKanban,
  IconAlertTriangle,
  IconBuildingBank,
  IconCalendar,
  IconChartPie,
  IconChartBar,
  IconTrendingUp,
  IconUsers,
  IconLogout,
  IconMenu2,
  IconClock,
  IconShield,
  IconBuildingWarehouse,
  IconLayoutGrid,
  IconUser,
  IconFileText,
  IconMessageCircle,
  IconInbox,
  IconClipboardList,
  IconPlant2,
  IconMapPin,
  IconReportAnalytics,
  IconRoute,
  IconScale,
  IconTrophy,
} from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { MenuProps } from 'antd';
import api from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import { useSeasonParam } from '@/hooks/useSeasonParam';
import { useFeedbackAdminUnreadCount } from '@/hooks/useFeedback';
import { useMyTasks } from '@/hooks/useMyTasks';
import { useRealtime } from '@/hooks/useRealtime';
import { realtime } from '@/services/realtime';
import { useRealtimeStore } from '@/stores/realtimeStore';
import { useUiStore } from '@/stores/uiStore';
import { useSeasonStore } from '@/stores/seasonStore';
import { useWorklogHeartbeat } from '@/hooks/useWorklogHeartbeat';
import { canSeePage } from '@/utils/permissions';
import { pickMenuComposition } from '@/utils/menuComposition';
import { clearCachedPrefs } from '@/cache/userPrefsCache';
import { useProcessTour } from '@/hooks/useProcessTour';
import { FeedbackFAB } from '@/components/feedback/FeedbackFAB';
import { NotificationBell } from '@/components/NotificationBell';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { WorklogChip } from '@/components/WorklogChip';
import { SeasonSwitcher } from '@/components/SeasonSwitcher';
import { ClosedSeasonBanner } from '@/components/ClosedSeasonBanner';
import { COLORS } from '@/constants/styles';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

// ─── AppLayout ────────────────────────────────────────────────────────────────

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Mounted exactly once, here — every routed page is a descendant of this
  // layout, so the URL <-> selectedSeasonId sync runs app-wide without a
  // second writer competing for the `?season=` search param.
  useSeasonParam();
  const [collapsed, setCollapsed] = useState(false);
  const bossEditMode = useUiStore((s) => s.bossEditMode);
  const setBossEditMode = useUiStore((s) => s.setBossEditMode);
  const isBoss = user?.role === 'boss';
  useRealtime({ enabled: !!user });
  useWorklogHeartbeat({ enabled: !!user });
  const { data: feedbackUnreadCount = 0 } = useFeedbackAdminUnreadCount();
  const { data: myTasksData } = useMyTasks({ enabled: !!user });
  const myOpenCount = (myTasksData?.results ?? []).filter(
    (task) => task.state === 'open',
  ).length;

  const { t, i18n } = useTranslation();
  const startTour = useProcessTour();

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
      // Tear down the realtime socket so the next login opens a fresh
      // connection under the new user's session. Without this, the singleton
      // stays open as the previous user — connect() short-circuits on the
      // still-open socket — so presence keeps showing the old account until a
      // manual page refresh fires beforeunload → close().
      realtime.close();
      useRealtimeStore.setState({ sheetRoster: [], status: 'closed' });
      // Shared-terminal hygiene: navigate('/login') is an SPA transition, so
      // the season selection would otherwise survive into the next user's
      // session — 403s app-wide if they lack `closed_season.can_view`, or a
      // silent archive read if they hold it. Safe to reset here: the URL->store
      // effect in useSeasonParam() is gated on `urlSeason` having changed, so
      // it will not write the stale `?season=` back, and the store->URL effect
      // early-returns on null.
      useSeasonStore.setState({ selectedSeasonId: null });
      // Same shared-terminal reasoning for the boss's view/edit toggle. It is
      // deliberately not persisted so every session starts in view mode — but
      // logout is an SPA transition, not a reload, so without this the store
      // survives and the next boss to log in on this tab lands straight in
      // Edit mode, past the confirmation dialog that is the whole point of the
      // opt-in.
      useUiStore.setState({ bossEditMode: false });
      queryClient.removeQueries({ queryKey: ['auth', 'me'] });
      queryClient.clear();
      navigate('/login');
    },
  });

  const handleBossModeChange = (value: string | number) => {
    if (value === 'view') {
      setBossEditMode(false);
      return;
    }
    Modal.confirm({
      title: t('boss_mode.confirm_title'),
      content: t('boss_mode.confirm_body'),
      okText: t('boss_mode.confirm_ok'),
      cancelText: t('common.cancel'),
      onOk: () => setBossEditMode(true),
    });
  };

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
    '/export/blocks': t('nav.block_summary'),
    '/export/pomidor-dukany': t('nav.pomidor_dukany'),
    '/export/domestic-sales': t('nav.domestic_sales'),
    '/admin/users': t('nav.admin_users'),
    '/admin/seasons': t('nav.admin_seasons'),
    '/admin/firms': t('nav.admin_firms'),
    '/admin/import-firms': t('nav.admin_import_firms'),
    '/admin/permissions': t('nav.admin_permissions'),
    '/admin/blocks': t('nav.admin_blocks'),
    '/admin/customers': t('nav.admin_customers'),
    '/admin/truck-destinations': t('nav.admin_truck_dest'),
    '/admin/fleet': t('nav.admin_fleet'),
    '/admin/shipment-settings': t('nav.admin_shipment_settings'),
    '/admin/audit-log': t('nav.admin_audit_log'),
    '/admin/staff-access': t('nav.admin_staff_access'),
    '/admin/process-links': t('nav.admin_process_links'),
    '/me/board': t('me.nav.board'),
    '/contracts': t('nav.contracts.list'),
    '/sales': t('nav.sales.list'),
    '/documents': t('nav.documents'),
    '/export/my-reports': t('nav.sales_reports'),
    '/admin/sales-rep-coverage': t('nav.sales_rep_coverage'),
    '/admin/expense-template': t('nav.admin_expense_template'),
    '/admin/packing-templates': t('nav.admin_packing_templates'),
    '/transport/map': t('nav.fleet_map'),
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
  interface IMenuGroup {
    label: string;
    items: MenuItem[];
  }

  // Every route's menu item is defined exactly once here, keyed by its route
  // path. BOSS_MENU_GROUPS and STAFF_MENU_GROUPS below only choose *which*
  // keys go in *which* group and in *what order* — they never redefine an
  // item. This lives inside the component body because items close over t,
  // myOpenCount, and feedbackUnreadCount.
  //
  // `satisfies Record<string, MenuItem>` (rather than an explicit type
  // annotation) is deliberate: it checks every value against MenuItem while
  // preserving the literal string-union type of the keys, so `keyof typeof
  // ITEMS` below is the exact set of 45 route keys rather than plain
  // `string`. That makes a typo'd/missing key in a group's key list a
  // compile-time error instead of a silent `undefined` in the rendered menu.
  const ITEMS = {
    '/': { key: '/', icon: <IconLayoutDashboard size={15} />, label: t('nav.dashboard') },
    '/boss/dashboard': { key: '/boss/dashboard', icon: <IconChartPie size={15} />, label: t('nav.boss_dashboard') },
    '/me/board': {
      key: '/me/board',
      icon: (
        <Badge count={myOpenCount} size="small" offset={[8, -2]}>
          <IconClipboardList size={15} />
        </Badge>
      ),
      label: t('me.nav.board'),
    },
    '/director/stuck-shipments': {
      key: '/director/stuck-shipments',
      icon: <IconAlertTriangle size={15} />,
      label: t('nav.stuck_shipments'),
    },
    '/export/plan': { key: '/export/plan', icon: <IconCalendar size={15} />, label: t('nav.plan') },
    '/export/harvest-board': { key: '/export/harvest-board', icon: <IconPlant2 size={15} />, label: t('nav.harvest_board') },
    '/export/trucks': { key: '/export/trucks', icon: <IconTruck size={15} />, label: t('nav.trucks') },
    '/export/quota': { key: '/export/quota', icon: <IconChartPie size={15} />, label: t('nav.quota') },
    '/export/blocks': { key: '/export/blocks', icon: <IconChartBar size={15} />, label: t('nav.block_summary') },
    '/export/pomidor-dukany': { key: '/export/pomidor-dukany', icon: <IconTrendingUp size={15} />, label: t('nav.pomidor_dukany') },
    '/export/drafts': { key: '/export/drafts', icon: <IconLayoutGrid size={15} />, label: t('nav.drafts') },
    '/export/assign': { key: '/export/assign', icon: <IconLayoutKanban size={15} />, label: t('nav.assign') },
    '/export/weightmaster': { key: '/export/weightmaster', icon: <IconScale size={15} />, label: t('nav.weightmaster') },
    '/export/shipments': { key: '/export/shipments', icon: <IconTruck size={15} />, label: t('nav.shipments') },
    '/export/shipments/sheet': { key: '/export/shipments/sheet', icon: <IconLayoutGrid size={15} />, label: t('nav.shipment_sheet') },
    '/export/shipments/board': { key: '/export/shipments/board', icon: <IconLayoutKanban size={15} />, label: t('nav.shipment_board') },
    '/export/shipments/dashboard': { key: '/export/shipments/dashboard', icon: <IconLayoutDashboard size={15} />, label: t('nav.shipment_dashboard') },
    '/documents': { key: '/documents', icon: <IconFileText size={15} />, label: t('nav.documents') },
    '/admin/packing-templates': { key: '/admin/packing-templates', icon: <IconFileText size={15} />, label: t('nav.admin_packing_templates') },
    '/contracts': { key: '/contracts', icon: <IconFileText size={15} />, label: t('nav.contracts.list') },
    '/sales': { key: '/sales', icon: <IconFileText size={15} />, label: t('nav.sales.list') },
    '/export/my-reports': { key: '/export/my-reports', icon: <IconReportAnalytics size={15} />, label: t('nav.sales_reports') },
    '/export/domestic-sales': { key: '/export/domestic-sales', icon: <IconBuildingWarehouse size={15} />, label: t('nav.domestic_sales') },
    '/export/prices': { key: '/export/prices', icon: <IconChartBar size={15} />, label: t('nav.prices') },
    '/export/advances': { key: '/export/advances', icon: <IconBuildingBank size={15} />, label: t('nav.advances') },
    '/export/overdue': { key: '/export/overdue', icon: <IconAlertTriangle size={15} />, label: t('nav.overdue') },
    '/admin/expense-template': { key: '/admin/expense-template', icon: <IconFileText size={15} />, label: t('nav.admin_expense_template') },
    '/analytics/clients-report': { key: '/analytics/clients-report', icon: <IconUsers size={15} />, label: t('nav.clients_report') },
    '/team/kpi': {
      key: '/team/kpi',
      icon: <IconTrophy size={15} />,
      label: t('nav.team_kpi'),
      roles: [
        'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief',
        'weight_master', 'document_team', 'transport', 'sales_rep', 'finansist',
        'director', 'accountant', 'greenhouse_manager', 'seller', 'boss',
      ] as import('@/types').UserRole[],
    },
    '/worklog': {
      key: '/worklog',
      icon: <IconClock size={15} />,
      label: t('nav.worklog'),
      // Radical transparency: every authenticated user sees this page. No
      // page_code is registered for it, so it is surfaced via an explicit
      // roles list that bypasses canSeePage.
      roles: [
        'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief',
        'weight_master', 'document_team', 'transport', 'sales_rep', 'finansist',
        'director', 'accountant', 'greenhouse_manager', 'seller', 'boss',
      ] as import('@/types').UserRole[],
    },
    '/admin/seasons': { key: '/admin/seasons', icon: <IconCalendar size={15} />, label: t('nav.admin_seasons') },
    '/admin/firms': { key: '/admin/firms', icon: <IconBuildingBank size={15} />, label: t('nav.admin_firms') },
    '/admin/import-firms': { key: '/admin/import-firms', icon: <IconBuildingBank size={15} />, label: t('nav.admin_import_firms') },
    '/admin/customers': { key: '/admin/customers', icon: <IconUser size={15} />, label: t('nav.admin_customers') },
    '/admin/blocks': { key: '/admin/blocks', icon: <IconBuildingWarehouse size={15} />, label: t('nav.admin_blocks') },
    '/admin/truck-destinations': { key: '/admin/truck-destinations', icon: <IconTruck size={15} />, label: t('nav.admin_truck_dest') },
    '/admin/fleet': {
      key: '/admin/fleet',
      icon: <IconTruck size={15} />,
      label: t('nav.admin_fleet'),
      // No page_code registered yet — role-gated the same way the route
      // itself is (see App.tsx's admin/fleet ProtectedRoute).
      roles: ['admin', 'director', 'export_manager', 'boss', 'warehouse_chief', 'loading_dept_head', 'loading_dept_head_deputy'] as import('@/types').UserRole[],
    },
    '/admin/users': { key: '/admin/users', icon: <IconUsers size={15} />, label: t('nav.admin_users') },
    '/admin/permissions': { key: '/admin/permissions', icon: <IconShield size={15} />, label: t('nav.admin_permissions') },
    '/admin/staff-access': { key: '/admin/staff-access', icon: <IconUsers size={15} />, label: t('nav.admin_staff_access') },
    '/admin/process-links': {
      key: '/admin/process-links',
      icon: <IconRoute size={15} />,
      label: t('nav.admin_process_links'),
      // Role-gated, not page_code-gated — mirrors the backend's inline
      // _is_full_admin check (admin role or superuser), which deliberately
      // bypasses the page_permissions matrix. See ProtectedRoute below.
      roles: ['admin'] as import('@/types').UserRole[],
    },
    '/admin/shipment-settings': { key: '/admin/shipment-settings', icon: <IconLayoutGrid size={15} />, label: t('nav.admin_shipment_settings') },
    '/admin/sales-rep-coverage': { key: '/admin/sales-rep-coverage', icon: <IconMapPin size={15} />, label: t('nav.sales_rep_coverage') },
    '/admin/audit-log': {
      key: '/admin/audit-log',
      icon: <IconClipboardList size={15} />,
      label: t('nav.admin_audit_log'),
    },
    '/transport/map': {
      key: '/transport/map',
      icon: <IconMapPin size={15} />,
      label: t('nav.fleet_map'),
      // No page_code is registered for this page, so it is surfaced via an
      // explicit roles list that bypasses canSeePage — the same bypass
      // /worklog and /team/kpi use. Came in from main with the Fleet Map
      // feature (PR #11).
      roles: [
        'admin', 'export_manager', 'loading_dept_head', 'loading_dept_head_deputy', 'warehouse_chief',
        'weight_master', 'document_team', 'transport', 'sales_rep', 'finansist',
        'director', 'accountant', 'greenhouse_manager', 'seller', 'boss',
      ] as import('@/types').UserRole[],
    },
    '/feedback/submit': { key: '/feedback/submit', icon: <IconMessageCircle size={15} />, label: t('nav.feedback_submit') },
    '/feedback/my-tickets': { key: '/feedback/my-tickets', icon: <IconFileText size={15} />, label: t('nav.feedback_my_tickets') },
    '/feedback/public': { key: '/feedback/public', icon: <IconChartPie size={15} />, label: t('nav.feedback_public') },
    '/admin/feedback': {
      key: '/admin/feedback',
      icon: (
        <Badge count={feedbackUnreadCount} size="small" offset={[6, 0]}>
          <IconInbox size={15} />
        </Badge>
      ),
      label: t('nav.feedback_admin_inbox'),
    },
  } satisfies Record<string, MenuItem>;

  // Builds one menu group from a label key and an ordered list of ITEMS
  // keys. Typing `keys` against `keyof typeof ITEMS` makes referencing a
  // route that isn't in ITEMS a compile error, not a rendered `undefined`.
  const group = (labelKey: string, keys: (keyof typeof ITEMS)[]): IMenuGroup => ({
    label: t(labelKey),
    items: keys.map((key) => ITEMS[key]),
  });

  // The boss's menu — process-lifecycle order. Edit this list to change what
  // the boss sees — it affects nobody else.
  const BOSS_MENU_GROUPS: IMenuGroup[] = [
    group('nav.group_overview', ['/', '/boss/dashboard', '/me/board', '/director/stuck-shipments']),
    group('nav.group_planning', ['/export/plan', '/export/pomidor-dukany', '/export/harvest-board', '/export/trucks', '/export/quota', '/export/blocks']),
    // `/export/drafts` and `/export/assign` are deliberately withheld from the
    // boss sidebar (owner request, 2026-08-20). The pages still exist and the
    // boss's page permissions are untouched — he is meant to reach them through
    // the process page, not a top-level nav entry. Do NOT re-add them by
    // sweeping for "orphaned routes" — that sweep (421068f) is how they got here.
    group('nav.group_prep', ['/export/weightmaster']),
    group('nav.group_shipping', [
      '/export/shipments', '/export/shipments/sheet', '/export/shipments/board',
      '/export/shipments/dashboard', '/transport/map',
    ]),
    group('nav.group_docs', ['/documents', '/admin/packing-templates']),
    group('nav.group_sales', ['/contracts', '/sales', '/export/my-reports', '/export/domestic-sales', '/export/prices']),
    group('nav.group_finance', ['/export/advances', '/export/overdue', '/admin/expense-template']),
    group('nav.group_analytics', ['/analytics/clients-report', '/team/kpi', '/worklog']),
    group('nav.group_reference', ['/admin/seasons', '/admin/firms', '/admin/import-firms', '/admin/customers', '/admin/blocks', '/admin/truck-destinations', '/admin/fleet']),
    group('nav.group_system', ['/admin/users', '/admin/permissions', '/admin/staff-access', '/admin/shipment-settings', '/admin/sales-rep-coverage', '/admin/audit-log', '/admin/process-links']),
    group('nav.group_feedback', ['/feedback/submit', '/feedback/my-tickets', '/feedback/public', '/admin/feedback']),
  ];
  // Every other role's menu — the original module grouping (restored
  // verbatim from commit d6f1a02, plus 5 previously orphaned routes appended
  // to nav.group_export: /export/trucks, /export/drafts, /export/assign,
  // /export/domestic-sales, /export/prices).
  const STAFF_MENU_GROUPS: IMenuGroup[] = [
    group('nav.group_main', ['/', '/boss/dashboard', '/director/stuck-shipments']),
    group('nav.group_analytics', ['/analytics/clients-report', '/export/blocks', '/export/pomidor-dukany']),
    group('nav.group_export', [
      '/export/shipments/dashboard', '/export/shipments', '/export/shipments/sheet', '/me/board',
      '/export/shipments/board', '/export/harvest-board', '/export/weightmaster', '/export/overdue',
      '/export/my-reports', '/export/advances', '/transport/map',
      '/export/trucks', '/export/drafts', '/export/assign', '/export/domestic-sales', '/export/prices',
    ]),
    group('nav.group_contracts', ['/contracts', '/sales', '/documents']),
    group('nav.group_management', ['/export/plan', '/export/quota', '/admin/seasons', '/admin/firms', '/admin/import-firms', '/admin/customers', '/admin/blocks']),
    group('nav.group_system', ['/admin/users', '/admin/truck-destinations', '/admin/fleet', '/admin/shipment-settings', '/admin/permissions', '/admin/staff-access', '/admin/sales-rep-coverage', '/admin/expense-template', '/admin/packing-templates', '/admin/audit-log', '/admin/process-links']),
    group('nav.group_team', ['/worklog', '/team/kpi']),
    group('nav.group_feedback', ['/feedback/submit', '/feedback/my-tickets', '/feedback/public', '/admin/feedback']),
  ];

  const allMenuGroups: IMenuGroup[] = pickMenuComposition(
    isBoss,
    BOSS_MENU_GROUPS,
    STAFF_MENU_GROUPS,
  );

  // Filter: keep only items the user has permission to see
  const menuItems: MenuProps['items'] = allMenuGroups
    .map((menuGroup) => {
      const visibleChildren = menuGroup.items.filter((item) => {
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
        label: menuGroup.label,
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

          {/* Right: connection dot + worklog chip + season switcher + lang switcher + notifications */}
          <Flex align="center" gap={12}>
            {isBoss && (
              <Flex align="center" gap={8}>
                <Segmented
                  size="small"
                  value={bossEditMode ? 'edit' : 'view'}
                  options={[
                    { label: t('boss_mode.view'), value: 'view' },
                    { label: t('boss_mode.edit'), value: 'edit' },
                  ]}
                  onChange={handleBossModeChange}
                />
                {bossEditMode && (
                  <Tag color="orange" style={{ margin: 0 }}>
                    {t('boss_mode.active')}
                  </Tag>
                )}
              </Flex>
            )}
            <ConnectionStatus />
            <WorklogChip />
            <SeasonSwitcher />
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
            <Tooltip title={t('tour.start')}>
              <Button
                type="text"
                icon={<IconRoute size={17} />}
                onClick={startTour}
                style={{ display: 'flex', alignItems: 'center', color: COLORS.textTertiary }}
                aria-label={t('tour.start')}
              />
            </Tooltip>
            <NotificationBell />
          </Flex>
        </Header>

        {/* ── Content ─────────────────────────────────────────────────── */}
        {/* Content is the scroll boundary: body never scrolls. Wide tables
            opt into their own horizontal scrollbar via scroll={{x:'max-content'}};
            full-height grid pages opt out via the .page-fullheight-grid class
            (see SheetStyles.css). */}
        <Content
          data-tour="page"
          style={{
            background: COLORS.bgLight,
            padding: 24,
            height: 'calc(100vh - 56px)',
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <ClosedSeasonBanner />
          <Outlet />
        </Content>
      </Layout>
      <FeedbackFAB />
    </Layout>
  );
}
