import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage } from '@/utils/permissions';
import GaplamaTab from './GaplamaTab';
import './sera.css';

/**
 * Standalone Gaplama page — the second of the two entry points the design specifies
 * (design spec §8). Same page code as the tab (`tir_takip.gaplama`), same second gate
 * (`export.plan`) checked here instead of via TirTakip.tsx's TAB_BODIES.
 */
export default function GaplamaPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (!canSeePage(user, 'export.plan')) {
    return (
      <div className="sera-page">
        <div className="sera-empty">{t('tir_takip.tab_no_access')}</div>
      </div>
    );
  }

  return (
    <div className="sera-page">
      <GaplamaTab />
    </div>
  );
}
