import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, Spin } from 'antd';
import { Toaster } from 'sonner';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import AppLayout from '@/components/AppLayout';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const ShipmentList = lazy(() => import('@/pages/export/ShipmentList'));
const ShipmentDetail = lazy(() => import('@/pages/export/ShipmentDetail'));
const KanbanBoard = lazy(() => import('@/pages/export/KanbanBoard'));
const WeeklyPlanGrid = lazy(() => import('@/pages/export/WeeklyPlanGrid'));
const QuotaDashboard = lazy(() => import('@/pages/export/QuotaDashboard'));
const PricePanel = lazy(() => import('@/pages/export/PricePanel'));
const OverdueReports = lazy(() => import('@/pages/export/OverdueReports'));
const AdvancesTracker = lazy(() => import('@/pages/export/AdvancesTracker'));
const TruckForecast = lazy(() => import('@/pages/export/TruckForecast'));
const BlockSummary = lazy(() => import('@/pages/export/BlockSummary'));
const DomesticSales = lazy(() => import('@/pages/export/DomesticSales'));
const SeasonsPage = lazy(() => import('@/pages/admin/SeasonsPage'));
const ExportFirmsPage = lazy(() => import('@/pages/admin/ExportFirmsPage'));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const PageLoader = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <Spin size="large" />
  </div>
);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#1677ff',
          },
        }}
      >
        <Toaster position="top-right" richColors expand closeButton />
        <BrowserRouter>
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
                <Route index element={<Navigate to="/export/shipments" replace />} />
                <Route path="export/shipments" element={<ShipmentList />} />
                <Route path="shipments/:id" element={<ShipmentDetail />} />
                <Route path="export/kanban" element={<KanbanBoard />} />
                <Route path="export/plan" element={<WeeklyPlanGrid />} />
                <Route path="export/quota" element={<QuotaDashboard />} />
                <Route path="export/prices" element={<PricePanel />} />
                <Route path="export/overdue" element={<OverdueReports />} />
                <Route path="export/advances" element={<AdvancesTracker />} />
                <Route path="export/trucks" element={<TruckForecast />} />
                <Route path="export/blocks" element={<BlockSummary />} />
                <Route path="export/domestic-sales" element={<DomesticSales />} />
                <Route path="admin/seasons" element={
                  <ProtectedRoute roles={['director']}><SeasonsPage /></ProtectedRoute>
                } />
                <Route path="admin/firms" element={
                  <ProtectedRoute roles={['director']}><ExportFirmsPage /></ProtectedRoute>
                } />
                <Route path="admin/users" element={
                  <ProtectedRoute roles={['director']}><UsersPage /></ProtectedRoute>
                } />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
