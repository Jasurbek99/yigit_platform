import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { EXTERNAL_ROLES } from '@/constants/roles';

/** Agents and their sellers use the separate market app at /m/; the internal AppLayout must never mount for them. */
export function ExternalRoleGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const external = Boolean(user && EXTERNAL_ROLES.includes(user.role));
  useEffect(() => {
    if (external) window.location.replace('/m/');
  }, [external]);
  if (external) return null;
  return <>{children}</>;
}
