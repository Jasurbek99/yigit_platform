import { useEffect, type ReactElement, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { EXTERNAL_ROLES } from '@/constants/roles';

interface IExternalRoleGateProps {
  readonly children: ReactNode;
}

/** Agents and their sellers use the separate market app at /m/; the internal AppLayout must never mount for them. */
export function ExternalRoleGate({ children }: IExternalRoleGateProps): ReactElement | null {
  const { user } = useAuth();
  const external = Boolean(user && EXTERNAL_ROLES.includes(user.role));
  useEffect(() => {
    if (external) window.location.replace('/m/');
  }, [external]);
  if (external) return null;
  return <>{children}</>;
}
