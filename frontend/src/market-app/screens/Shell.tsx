import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useMarketMe, useMarketUserName } from '../hooks/useMarketMe';

async function logout() {
  try {
    await api.post('/auth/logout/');
  } finally {
    window.location.replace('/m/login');
  }
}

const tabClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'mk-tab mk-tab--on' : 'mk-tab');

/** Header + (agent) bottom bar around every screen except login. A 401 is redirected by the api client. */
export default function Shell() {
  const { t } = useTranslation();
  const me = useMarketMe();
  const userName = useMarketUserName();

  if (me.isLoading) {
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
            {userName.data && <span>{userName.data}</span>}
            <button type="button" className="mk-small" onClick={logout}>
              {t('market.shell.logout')}
            </button>
          </div>
        </header>
        <Outlet />
      </div>
      {me.data.role === 'agent' && (
        <nav className="mk-tabbar">
          <NavLink to="/" end className={tabClass}>{t('market.shell.nav_lots')}</NavLink>
          <NavLink to="/team" className={tabClass}>{t('market.shell.nav_team')}</NavLink>
        </nav>
      )}
    </>
  );
}
