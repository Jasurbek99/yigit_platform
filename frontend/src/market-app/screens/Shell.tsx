import { useEffect, type ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { AGENT_ROLE, EXTERNAL_ROLES } from '@/constants/roles';
import { useMarketMe } from '../hooks/useMarketMe';
import { ToastHost } from '../components/ToastHost';

async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout/');
  } finally {
    window.location.replace('/m/login');
  }
}

interface INavLinkState {
  isActive: boolean;
}

const tabClass = ({ isActive }: INavLinkState): string => (isActive ? 'mk-tab mk-tab--on' : 'mk-tab');

/** Header + bottom bar around every screen except login. A 401 is redirected by the api client. */
export default function Shell(): ReactElement {
  const { t } = useTranslation();
  const me = useMarketMe();
  // Staff belong in the main app.
  const isStaff = Boolean(me.data && !EXTERNAL_ROLES.includes(me.data.role));

  useEffect(() => {
    if (isStaff) window.location.replace('/');
  }, [isStaff]);

  if (me.isLoading || isStaff) {
    return (
      <div className="mk-loading">
        <i className="mk-loading-dot" />
        {t('market.shell.loading')}
      </div>
    );
  }
  if (!me.data) {
    return <div className="mk-loading">{t('market.shell.load_error')}</div>;
  }

  return (
    <>
      <div className="mk-app">
        <header className="mk-top">
          <h1 className="mk-brand">{t('market.shell.brand')}</h1>
          <div className="mk-who">
            {me.data.customer && <b className="mk-who-name">{me.data.customer.name}</b>}
            <span>{me.data.first_name || me.data.username}</span>
            <button type="button" className="mk-small" onClick={logout}>
              {t('market.shell.logout')}
            </button>
          </div>
        </header>
        <Outlet />
      </div>
      <ToastHost />
      <nav className="mk-tabbar">
        <NavLink to="/" end className={tabClass}>{t('market.shell.nav_lots')}</NavLink>
        <NavLink to="/debts" className={tabClass}>{t('market.shell.nav_debts')}</NavLink>
        {me.data.role === AGENT_ROLE && <NavLink to="/team" className={tabClass}>{t('market.shell.nav_team')}</NavLink>}
      </nav>
    </>
  );
}
