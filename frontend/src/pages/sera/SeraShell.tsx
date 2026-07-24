import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { SERA } from './seraTheme';
import { SERA_TOP_NAV } from './seraNav';

/**
 * Layout wrapper for the Sera Bütçe prototype module. Renders the source
 * app's horizontal top-nav then the active sub-page via <Outlet/>. Mounted
 * at `/sera` inside the main YGT app shell.
 */
export default function SeraShell() {
  const navigate = useNavigate();
  const location = useLocation();

  // Active tab: match the deepest top-nav path that prefixes the current URL.
  const rel = location.pathname.replace(/^\/sera\/?/, '');
  const activePath = [...SERA_TOP_NAV]
    .sort((a, b) => b.path.length - a.path.length)
    .find((n) => (n.path === '' ? rel === '' : rel.startsWith(n.path)))?.path ?? '';

  return (
    <div style={{ background: SERA.bg, margin: -24, padding: 20, minHeight: 'calc(100vh - 56px)' }}>
      {/* Internal top nav */}
      <nav
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 18,
          padding: 6,
          background: SERA.card,
          border: `1px solid ${SERA.line}`,
          borderRadius: 12,
        }}
      >
        {SERA_TOP_NAV.map((n) => {
          const active = n.path === activePath;
          return (
            <button
              key={n.path || 'index'}
              type="button"
              onClick={() => navigate(`/sera${n.path ? `/${n.path}` : ''}`)}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                border: 'none',
                background: active ? SERA.green : 'transparent',
                color: active ? '#fff' : SERA.ink,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.12s ease',
              }}
            >
              {n.label}
            </button>
          );
        })}
      </nav>

      <Outlet />
    </div>
  );
}
