import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/** Placeholder — the lots (trucks) list arrives in Part B. */
export default function HomeScreen(): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mk-empty">
      <h2 className="mk-empty-title">{t('market.shell.empty_title')}</h2>
      <p className="mk-empty-text">{t('market.shell.empty_text')}</p>
    </div>
  );
}
