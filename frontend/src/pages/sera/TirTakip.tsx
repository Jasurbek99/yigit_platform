import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage } from '@/utils/permissions';
import './sera.css';

/**
 * Tır Takip (Maşyn Yzarlamasy) — tab shell.
 *
 * A port of the `TirTakipPage` tab bar from `data/sera-butce-web`
 * (App.jsx:13360). The page carries that app's visual language rather than the
 * platform's antd theme, by owner request — see the containment rules at the
 * top of `sera.css`.
 *
 * Tab BODIES are deliberately empty. The owner is supplying the contents tab by
 * tab; each placeholder is replaced as its spec arrives.
 *
 * Whether a tab eventually stays a tab or becomes its own route is still open,
 * and costs nothing to decide later: `tir_takip.gaplama` gates the tab today
 * and would be that route's `pageCode` unchanged tomorrow.
 */

interface ISeraTab {
  /** Tab id; also the i18n key suffix. */
  key: string;
  /** Page code in the permission matrix — `tir_takip.<key>` by construction. */
  pageCode: string;
  /** Emoji prefix, kept from the source app's labels (📦 Export Raporu etc.). */
  emoji?: string;
}

const TABS: ISeraTab[] = [
  { key: 'onumcilik', pageCode: 'tir_takip.onumcilik' },
  { key: 'gaplama', pageCode: 'tir_takip.gaplama' },
  { key: 'tirlar', pageCode: 'tir_takip.tirlar' },
  { key: 'export_rapor', pageCode: 'tir_takip.export_rapor', emoji: '📦' },
  { key: 'hasabat', pageCode: 'tir_takip.hasabat', emoji: '📊' },
  { key: 'gumruk_ewrak', pageCode: 'tir_takip.gumruk_ewrak' },
  { key: 'kwota_takibi', pageCode: 'tir_takip.kwota_takibi' },
  { key: 'sertnamalar', pageCode: 'tir_takip.sertnamalar' },
  { key: 'datalar', pageCode: 'tir_takip.datalar' },
];

export default function TirTakip() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const visibleTabs = TABS.filter((tab) => canSeePage(user, tab.pageCode));

  // Not `visibleTabs[0].key` in a useState initialiser — an admin can revoke
  // the tab a user is sitting on, and `user` resolves after first paint. Track
  // the key, and fall back to the first visible tab whenever the stored one is
  // gone, so the shell never renders with nothing selected.
  const [requestedTab, setRequestedTab] = useState<string | null>(null);
  const activeTab =
    visibleTabs.find((tab) => tab.key === requestedTab)?.key ?? visibleTabs[0]?.key ?? null;

  return (
    <div className="sera-page">
      {/* Reachable via the `tir_takip` container code, which `canSeePage`
          grants whenever ANY child tab is visible — so zero visible tabs is a
          real state (container granted directly, every tab revoked). */}
      {visibleTabs.length === 0 ? (
        <div className="sera-empty">{t('tir_takip.no_tabs')}</div>
      ) : (
        <>
          <div className="sera-tabs" role="tablist" aria-label={t('tir_takip.title')}>
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`sera-tab-${tab.key}`}
                aria-selected={activeTab === tab.key}
                aria-controls={`sera-panel-${tab.key}`}
                className="sera-tab"
                onClick={() => setRequestedTab(tab.key)}
              >
                {tab.emoji ? `${tab.emoji} ` : ''}
                {t(`tir_takip.tabs.${tab.key}`)}
              </button>
            ))}
          </div>

          {activeTab && (
            <div
              role="tabpanel"
              id={`sera-panel-${activeTab}`}
              aria-labelledby={`sera-tab-${activeTab}`}
              className="sera-card"
            >
              <div className="sera-empty">{t('tir_takip.tab_pending')}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
