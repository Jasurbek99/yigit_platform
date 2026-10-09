import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { EXTERNAL_ROLES } from '@/constants/roles';
import { httpStatus } from '@/utils/drfErrors';
import { safeNextPath } from '@/utils/loginRedirect';
import type { UserRole } from '@/types';

interface ILoginResponse {
  role: UserRole;
}

/** `?next=/m/team` → `/team` for the router (basename `/m`); anything outside the market app → null. */
function marketNext(next: string | null): string | null {
  const safe = safeNextPath(next);
  if (!safe || !safe.startsWith('/m/') || safe.startsWith('/m/login')) return null;
  return safe.slice(2);
}

/** 400 / 401 = wrong login or password; no answer at all = no connection. */
function loginErrorKey(status: number | undefined): string {
  if (status === 400 || status === 401) return 'market.login.bad_credentials';
  if (status === undefined) return 'market.login.offline';
  return 'market.login.error';
}

export default function LoginScreen(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t('market.login.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<ILoginResponse>('/auth/login/', { username: username.trim(), password });
      if (EXTERNAL_ROLES.includes(data.role)) {
        navigate(marketNext(params.get('next')) ?? '/', { replace: true });
      } else {
        // Staff belong in the main app.
        window.location.replace('/');
      }
    } catch (err) {
      setError(t(loginErrorKey(httpStatus(err))));
      setBusy(false);
    }
  };

  return (
    <div className="mk-app">
      <form className="mk-login" onSubmit={handleSubmit} noValidate>
        <h1 className="mk-brand">{t('market.login.title')}</h1>
        <p className="mk-note">{t('market.login.subtitle')}</p>
        <label className="mk-label" htmlFor="mk-login-username">{t('market.login.username')}</label>
        <input
          id="mk-login-username"
          className="mk-field"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label className="mk-label" htmlFor="mk-login-password">{t('market.login.password')}</label>
        <input
          id="mk-login-password"
          className="mk-field"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="mk-err" role="alert">{error}</p>}
        <button type="submit" className="mk-btn mk-btn--tomato" disabled={busy}>
          {t('market.login.submit')}
        </button>
      </form>
    </div>
  );
}
