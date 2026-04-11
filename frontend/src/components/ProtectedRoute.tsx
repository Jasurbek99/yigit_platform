import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage } from '@/utils/permissions';
import type { UserRole } from '@/types';

interface IProtectedRouteProps {
  children: React.ReactNode;
  /** Legacy: restrict to specific roles. Prefer pageCode for dynamic permissions. */
  roles?: UserRole[];
  /** Dynamic: check page_permissions from /auth/me/. Multiple codes = OR logic (any match grants access). */
  pageCode?: string | string[];
}

export function ProtectedRoute({ children, roles, pageCode }: IProtectedRouteProps) {
  const { user, isLoading, isError } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (isError || !user) {
    return <Navigate to="/login" replace />;
  }

  // Dynamic page permission check (takes precedence when pageCode is provided)
  if (pageCode) {
    const codes = Array.isArray(pageCode) ? pageCode : [pageCode];
    const hasAccess = codes.some((code) => canSeePage(user, code));
    if (!hasAccess) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  // Legacy role-based check (backward compatible)
  if (roles && !user.is_superuser && !roles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}
