import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

interface ISheetButtonsProps {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly formError?: string;
}

/** A sheet form's error line and its Save / Cancel buttons. */
export function SheetButtons({ busy, onClose, formError }: ISheetButtonsProps): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {formError && <p className="mk-err" role="alert">{formError}</p>}
      <div className="mk-sheet-btns">
        <button type="submit" className="mk-btn mk-btn--tomato" disabled={busy}>{t('market.team.save')}</button>
        <button type="button" className="mk-btn mk-btn--quiet" onClick={onClose}>{t('market.team.cancel')}</button>
      </div>
    </>
  );
}
