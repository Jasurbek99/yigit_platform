import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const DashboardPage = lazy(() => import('@/pages/DashboardPage'));

/** `/` — the dashboard, except for a gate guard: the gate screen is his whole job. */
export default function IndexRoute() {
  const { user } = useAuth();
  if (user?.role === 'garawul') return <Navigate to="/export/gate" replace />;
  return <DashboardPage />;
}
