import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MantineProvider,
  createTheme,
  Card,
  Button,
  Modal,
  NavLink,
} from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { ConfigProvider, Spin } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import enUS from 'antd/locale/en_US';
import { Toaster } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import AppLayout from '@/components/AppLayout';
import { useAuth } from '@/hooks/useAuth';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const UnauthorizedPage = lazy(() => import('@/pages/auth/UnauthorizedPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ShipmentList = lazy(() => import('@/pages/export/ShipmentList'));
const ShipmentDetail = lazy(() => import('@/pages/export/ShipmentDetail'));
const KanbanBoard = lazy(() => import('@/pages/export/KanbanBoard'));
const WeeklyPlanGrid = lazy(() => import('@/pages/export/WeeklyPlanGrid'));
const QuotaDashboard = lazy(() => import('@/pages/export/QuotaDashboard'));
const AddQuotaIssuance = lazy(() => import('@/pages/export/AddQuotaIssuance'));
const PricePanel = lazy(() => import('@/pages/export/PricePanel'));
const OverdueReports = lazy(() => import('@/pages/export/OverdueReports'));
const AdvancesTracker = lazy(() => import('@/pages/export/AdvancesTracker'));
const TruckForecast = lazy(() => import('@/pages/export/TruckForecast'));
const BlockSummary = lazy(() => import('@/pages/export/BlockSummary'));
const DomesticSales = lazy(() => import('@/pages/export/DomesticSales'));
const SeasonsPage = lazy(() => import('@/pages/admin/SeasonsPage'));
const ExportFirmsPage = lazy(() => import('@/pages/admin/ExportFirmsPage'));
const ExportFirmDetailPage = lazy(() => import('@/pages/admin/ExportFirmDetailPage'));
const ImportFirmsPage = lazy(() => import('@/pages/admin/ImportFirmsPage'));
const ImportFirmDetailPage = lazy(() => import('@/pages/admin/ImportFirmDetailPage'));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));
const PermissionsPage = lazy(() => import('@/pages/admin/PermissionsPage'));
const BlocksPage = lazy(() => import('@/pages/admin/BlocksPage'));
const BlockDetailPage = lazy(() => import('@/pages/admin/BlockDetailPage'));
const TruckDestinationsPage = lazy(() => import('@/pages/admin/TruckDestinationsPage'));
const CustomersPage = lazy(() => import('@/pages/admin/CustomersPage'));
const ShipmentSettingsPage = lazy(() => import('@/pages/admin/ShipmentSettingsPage'));
const ShipmentSheet = lazy(() => import('@/pages/export/ShipmentSheet'));
const ShipmentDashboard = lazy(() => import('@/pages/export/ShipmentDashboard'));
const DraftPool = lazy(() => import('@/pages/export/DraftPool'));
const AssignmentBoard = lazy(() => import('@/pages/export/AssignmentBoard'));
const PalletManifest = lazy(() => import('@/pages/export/PalletManifest'));
const BossDashboard = lazy(() => import('@/pages/boss/BossDashboard'));
const FallbackForecastView = lazy(() => import('@/pages/export/FallbackForecastView'));
const StuckShipments = lazy(() => import('@/pages/director/StuckShipments'));
const ShipmentActivityLog = lazy(() => import('@/pages/export/ShipmentActivityLog'));
const SubmitFeedbackPage = lazy(() => import('@/pages/feedback/SubmitFeedbackPage'));
const MyTicketsPage = lazy(() => import('@/pages/feedback/MyTicketsPage'));
const PublicFeedPage = lazy(() => import('@/pages/feedback/PublicFeedPage'));
const AdminInboxPage = lazy(() => import('@/pages/feedback/AdminInboxPage'));
const SelfBoard = lazy(() => import('@/pages/me/SelfBoard'));
const ShipmentBoard = lazy(() => import('@/pages/export/ShipmentBoard'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const theme = createTheme({
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', monospace",
  fontSizes: { xs: '11px', sm: '13px', md: '14px', lg: '16px', xl: '20px' },
  primaryColor: 'blue',
  primaryShade: { light: 5, dark: 5 } as const,
  colors: {
    blue: ['#e6f4ff', '#bae0ff', '#91caff', '#69b1ff', '#4096ff', '#1677ff', '#0958d9', '#003eb3', '#002c8c', '#001d6c'] as unknown as [string, string, string, string, string, string, string, string, string, string],
  },
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  defaultRadius: 'sm',
  shadows: {
    xs: '0 1px 2px rgba(0,0,0,0.03)',
    sm: '0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px 0 rgba(0,0,0,0.02)',
    md: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
  },
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  breakpoints: { xs: '36em', sm: '48em', md: '62em', lg: '75em', xl: '88em' },
  components: {
    Card: Card.extend({ defaultProps: { radius: 'lg', shadow: 'sm', padding: 20 } }),
    Button: Button.extend({ styles: { root: { fontWeight: 500 } } }),
    Modal: Modal.extend({ defaultProps: { radius: 'md', centered: true } }),
    NavLink: NavLink.extend({
      styles: {
        root: {
          borderRadius: 6,
          margin: '1px 8px',
          padding: '8px 12px',
          color: 'rgba(255,255,255,0.65)',
          fontSize: 14,
          '&:hover': { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)' },
          '&[data-active]': { background: '#1677ff', color: '#fff', fontWeight: 500 },
        },
      },
    }),
  },
});

const PageLoader = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
);

/**
 * Strict role guard for the Feedback Admin Inbox.
 * Checks user.role === 'admin' exclusively — does NOT honour is_superuser.
 * This is intentional: the feedback admin identity is the 'admin' role enum
 * value, not Django superuser status.
 * RequireAuth / ProtectedRoute higher up already handles unauthenticated users.
 */
function FeedbackAdminGate({ children }: { children: React.ReactNode }): React.ReactElement | null {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { i18n } = useTranslation();
  const antdLocale = i18n.language.startsWith('ru') ? ruRU : enUS;

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={antdLocale}
        theme={{
          token: {
            colorPrimary: '#1677ff',
            borderRadius: 6,
            fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          },
        }}
      >
      <MantineProvider theme={theme} forceColorScheme="light">
        <DatesProvider settings={{ locale: i18n.language.startsWith('ru') ? 'ru' : 'en', firstDayOfWeek: 1 }}>
          <Toaster position="top-right" richColors expand closeButton />
          <BrowserRouter future={{ v7_relativeSplatPath: true }}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="boss/dashboard" element={
                    <ProtectedRoute pageCode="analytics.boss"><BossDashboard /></ProtectedRoute>
                  } />
                  <Route path="director/stuck-shipments" element={
                    <ProtectedRoute roles={['admin', 'director', 'boss']}><StuckShipments /></ProtectedRoute>
                  } />
                  <Route path="export/shipments" element={
                    <ProtectedRoute pageCode="export.shipments"><ShipmentList /></ProtectedRoute>
                  } />
                  <Route path="shipments/:id" element={
                    <ProtectedRoute pageCode="export.shipments"><ShipmentDetail /></ProtectedRoute>
                  } />
                  <Route path="export/shipments/sheet" element={
                    <ProtectedRoute pageCode="export.shipments"><ShipmentSheet /></ProtectedRoute>
                  } />
                  <Route path="export/shipments/dashboard" element={
                    <ProtectedRoute pageCode="export.shipments"><ShipmentDashboard /></ProtectedRoute>
                  } />
                  <Route path="export/shipments/board" element={
                    <ProtectedRoute pageCode="export.shipments"><ShipmentBoard /></ProtectedRoute>
                  } />
                  <Route path="export/kanban" element={
                    <ProtectedRoute pageCode="export.kanban"><KanbanBoard /></ProtectedRoute>
                  } />
                  <Route path="export/plan" element={
                    <ProtectedRoute pageCode="export.plan"><WeeklyPlanGrid /></ProtectedRoute>
                  } />
                  <Route path="greenhouse/fallback-forecast" element={
                    <ProtectedRoute pageCode="export.plan"><FallbackForecastView /></ProtectedRoute>
                  } />
                  <Route path="export/quota" element={
                    <ProtectedRoute pageCode={['export.quota', 'export.quota.local_sell']}><QuotaDashboard /></ProtectedRoute>
                  } />
                  <Route path="export/quota/add-issuance" element={
                    <ProtectedRoute pageCode="export.quota"><AddQuotaIssuance /></ProtectedRoute>
                  } />
                  <Route path="export/prices" element={
                    <ProtectedRoute pageCode="export.prices"><PricePanel /></ProtectedRoute>
                  } />
                  <Route path="export/overdue" element={
                    <ProtectedRoute pageCode="export.overdue"><OverdueReports /></ProtectedRoute>
                  } />
                  <Route path="export/advances" element={
                    <ProtectedRoute pageCode="export.advances"><AdvancesTracker /></ProtectedRoute>
                  } />
                  <Route path="export/trucks" element={
                    <ProtectedRoute pageCode="export.trucks"><TruckForecast /></ProtectedRoute>
                  } />
                  <Route path="export/blocks" element={
                    <ProtectedRoute pageCode="export.blocks"><BlockSummary /></ProtectedRoute>
                  } />
                  <Route path="export/domestic-sales" element={
                    <ProtectedRoute pageCode="export.domestic_sales"><DomesticSales /></ProtectedRoute>
                  } />
                  <Route path="export/drafts" element={
                    <ProtectedRoute pageCode="export.drafts"><DraftPool /></ProtectedRoute>
                  } />
                  <Route path="export/assign" element={
                    <ProtectedRoute pageCode="export.assign"><AssignmentBoard /></ProtectedRoute>
                  } />
                  <Route path="shipments/:id/manifest" element={
                    <ProtectedRoute pageCode="export.pallet_manifest"><PalletManifest /></ProtectedRoute>
                  } />
                  <Route path="shipments/:id/activity" element={
                    <ProtectedRoute pageCode="export.shipments"><ShipmentActivityLog /></ProtectedRoute>
                  } />
                  <Route path="admin/seasons" element={
                    <ProtectedRoute pageCode="admin.seasons"><SeasonsPage /></ProtectedRoute>
                  } />
                  <Route path="admin/firms" element={
                    <ProtectedRoute pageCode="admin.firms"><ExportFirmsPage /></ProtectedRoute>
                  } />
                  <Route path="admin/firms/:id" element={
                    <ProtectedRoute pageCode="admin.firms"><ExportFirmDetailPage /></ProtectedRoute>
                  } />
                  <Route path="admin/import-firms" element={
                    <ProtectedRoute pageCode="admin.import_firms"><ImportFirmsPage /></ProtectedRoute>
                  } />
                  <Route path="admin/import-firms/:id" element={
                    <ProtectedRoute pageCode="admin.import_firms"><ImportFirmDetailPage /></ProtectedRoute>
                  } />
                  <Route path="admin/users" element={
                    <ProtectedRoute pageCode="admin.users"><UsersPage /></ProtectedRoute>
                  } />
                  <Route path="admin/permissions" element={
                    <ProtectedRoute pageCode="admin.permissions"><PermissionsPage /></ProtectedRoute>
                  } />
                  <Route path="admin/blocks" element={
                    <ProtectedRoute pageCode="admin.blocks"><BlocksPage /></ProtectedRoute>
                  } />
                  <Route path="admin/blocks/:id" element={
                    <ProtectedRoute pageCode="admin.blocks"><BlockDetailPage /></ProtectedRoute>
                  } />
                  <Route path="admin/truck-destinations" element={
                    <ProtectedRoute pageCode="admin.truck_dest"><TruckDestinationsPage /></ProtectedRoute>
                  } />
                  <Route path="admin/customers" element={
                    <ProtectedRoute pageCode="admin.customers"><CustomersPage /></ProtectedRoute>
                  } />
                  <Route path="admin/shipment-settings" element={
                    <ProtectedRoute pageCode="admin.shipment_settings"><ShipmentSettingsPage /></ProtectedRoute>
                  } />
                  {/* Me / Self board */}
                  <Route path="me/board" element={
                    <ProtectedRoute><SelfBoard /></ProtectedRoute>
                  } />
                  {/* Feedback module */}
                  <Route path="feedback/submit" element={<SubmitFeedbackPage />} />
                  <Route path="feedback/my-tickets" element={<MyTicketsPage />} />
                  <Route path="feedback/public" element={<PublicFeedPage />} />
                  <Route path="admin/feedback" element={
                    <FeedbackAdminGate><AdminInboxPage /></FeedbackAdminGate>
                  } />
                </Route>
                <Route path="/unauthorized" element={<UnauthorizedPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </DatesProvider>
      </MantineProvider>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
