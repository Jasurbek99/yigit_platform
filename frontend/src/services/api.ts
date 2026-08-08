import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { toast } from 'sonner';
import i18n from '@/i18n';

const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  withCredentials: true, // send httpOnly cookies automatically
  headers: { 'Content-Type': 'application/json' },
});

// Attach CSRF token on mutating requests; remove Content-Type for FormData (Axios sets it with boundary)
api.interceptors.request.use((config) => {
  if (['post', 'put', 'patch', 'delete'].includes(config.method ?? '')) {
    const csrfToken = document.cookie
      .split('; ')
      .find((row) => row.startsWith('csrftoken='))
      ?.split('=')[1];
    if (csrfToken) {
      config.headers['X-CSRFToken'] = csrfToken;
    }
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
  }
  return config;
});

interface ISeasonClosedError {
  error: 'season_closed';
  season: string;
  closed_at: string;
}

function isSeasonClosedError(data: unknown): data is ISeasonClosedError {
  return typeof data === 'object' && data !== null && 'error' in data && data.error === 'season_closed';
}

// Redirect to login on 401 — but NOT for the login endpoint itself,
// otherwise bad-credential errors trigger a redirect and the page's
// onError toast never renders.
//
// Also: any write rejected with 409 `{"error": "season_closed", ...}` gets a
// toast here, app-wide, regardless of which page or mutation hook fired it.
// This is the safety NET, not the mechanism — every create/edit/delete
// control that can target a closed season is meant to be disabled by
// `useSeasonReadOnly()` before the request ever fires. But disabling is a
// per-page effort and this task didn't reach every page, and a control could
// always be missed — so if a 409 season_closed does land, the user sees an
// intelligible message here instead of whatever generic "failed" toast (or
// none at all) the calling mutation's own onError happens to show.
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const url = error.config?.url ?? '';
    const isLoginRequest = url.includes('/auth/login');
    if (error.response?.status === 401 && !isLoginRequest) {
      window.location.href = '/login';
    }
    if (error.response?.status === 409 && isSeasonClosedError(error.response.data)) {
      toast.error(i18n.t('season.closed_error'));
    }
    return Promise.reject(error);
  },
);

export default api;
