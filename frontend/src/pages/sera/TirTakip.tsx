import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage } from '@/utils/permissions';
import OnumcilikTab from './OnumcilikTab';
import TirlarTab from './TirlarTab';
import './sera.css';

/**
 * Tır Takip (Maşyn Yzarlamasy) — tab shell.
 *
 * A port of the `TirTakipPage` tab bar from `data/sera-butce-web`
 * (App.jsx:13360). The page carries that app's visual language rather than the
 * platform's antd theme, by owner request — see the containment rules at the
 * top of `sera.css`.
 *
 * Tab bodies arrive one at a time — the owner is supplying the contents tab by
 * tab, and each placeholder is replaced as its spec does. Three are filled:
 * `onumcilik` (a copy of the Weekly Plan grid), `tirlar` (a copy of the
 * Shipment Sheet page wrapper) and `datalar` (the Shipment Settings page); the
 * other six still render the placeholder.
 *
 * Whether a tab eventually stays a tab or becomes its own route is still open,
 * and costs nothing to decide later: `tir_takip.gaplama` gates the tab today
 * and would be that route's `pageCode` unchanged tomorrow.
 */

// Lazy, as in App.tsx: most roles only ever see Datalar's no-access panel, so
// they should not download the settings page. The local Suspense keeps a load
// from falling through to App's route-level boundary and blanking the layout.
const ShipmentSettingsPage = lazy(() => import('@/pages/admin/ShipmentSettingsPage'));

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

interface ISeraTabBody {
  /**
   * A SECOND page code the body's data needs, checked on top of the tab's own
   * code. Present when the body is a view of data that already has a home —
   * and therefore an audience — elsewhere in the platform.
   */
  requires?: string;
  node: ReactNode;
}

/**
 * Bodies for the tabs that have one. A key missing here falls through to the
 * placeholder, which is what the remaining tabs still want.
 *
 * Önümçilik needs `export.plan` on top of its own `tir_takip.onumcilik`.
 * The tab code is granted to all 15 roles (the owner asked for the page to be
 * open to everyone); `export.plan` is granted to 8. Without the second check,
 * copying the Weekly Plan grid in here would hand seven roles — accountant,
 * finansist, sales_rep, seller, transport, warehouse_chief, weight_master —
 * every block's planned/forecast/actual kg, the block-manager names and the
 * late-edit state, none of which they can reach on `/export/plan`.
 *
 * Copying a screen must not widen who can read it. Granting a role the data is
 * still an admin's checkbox (`export.plan` in the permission matrix), not a
 * deploy — which is the same promise the tab codes themselves make.
 */
const TAB_BODIES: Record<string, ISeraTabBody> = {
  onumcilik: { requires: 'export.plan', node: <OnumcilikTab /> },
  // Tirlar is the Shipment Sheet, so it carries the Sheet's own page code on
  // top of the tab code for the same reason Onumcilik carries `export.plan`:
  // the tab code is granted to all 15 roles, `export.shipments_sheet` is not.
  // Without this check the tab would hand every role every truck's customer,
  // firm splits, driver and document state. Cell-level rules still apply
  // underneath — SheetGrid is reused, not forked — but page-level reach is a
  // decision for the permission matrix, not for this copy.
  tirlar: { requires: 'export.shipments_sheet', node: <TirlarTab /> },
  // Datalar is the source app's reference-data table — here, the Shipment
  // Settings page, mounted as-is so its inner `canDo` write gates and the
  // conditional Row Access tab stay the admin page's own. Unlike the two
  // above, this body WRITES: statuses, border points, dropdown options, truck
  // split defaults and Sheet row access. The tab code is granted to all 15
  // roles, `admin.shipment_settings` to four by default (admin, boss,
  // export_manager, document_team).
  datalar: {
    requires: 'admin.shipment_settings',
    node: (
      <div className="sera-settings">
        <Suspense fallback={<Spin />}>
          <ShipmentSettingsPage />
        </Suspense>
      </div>
    ),
  },
};

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

  function renderBody(key: string) {
    const body = TAB_BODIES[key];
    if (!body) return <div className="sera-empty">{t('tir_takip.tab_pending')}</div>;
    if (body.requires && !canSeePage(user, body.requires)) {
      return <div className="sera-empty">{t('tir_takip.tab_no_access')}</div>;
    }
    return body.node;
  }

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
              {renderBody(activeTab)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
