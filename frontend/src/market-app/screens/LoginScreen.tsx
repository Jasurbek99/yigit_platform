import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { EXTERNAL_ROLES } from '@/constants/roles';
import { safeNextPath } from '@/utils/loginRedirect';
import type { UserRole } from '@/types';

/** `?next=/m/team` → `/team` for the router (basename `/m`); anything outside the market app → null. */
function marketNext(next: string | null): string | null {
  const safe = safeNextPath(next);
  if (!safe || !safe.startsWith('/m/') || safe.startsWith('/m/login')) return null;
  return safe.slice(2);
}

function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

export default function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t('market.login.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ role: UserRole }>('/auth/login/', { username: username.trim(), password });
      if (EXTERNAL_ROLES.includes(data.role)) {
        navigate(marketNext(params.get('next')) ?? '/', { replace: true });
      } else {
        // Staff belong in the main app.
        window.location.replace('/');
      }
    } catch (err) {
      setError(errorStatus(err) === 401 ? t('market.login.bad_credentials') : t('market.login.error'));
      setBusy(false);
    }
  };

  return (
    <div className="mk-app">
      <form className="mk-login" onSubmit={submit} noValidate>
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
