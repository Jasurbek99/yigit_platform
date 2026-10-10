import { useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';
import type { EntryKind } from '../../types';

interface IConfirmDeleteSheetProps {
  readonly kind: EntryKind;
  /** The row as one line: «12 ящиков, 80,5 кг, 3 622,5 ₸» / «Расход: Комиссия, 1 000 ₸». */
  readonly text: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

/** «Удалить эту продажу?» / «Удалить эту запись?» with the row's text (artifact `confirmSheet`). */
export function ConfirmDeleteSheet({ kind, text, onConfirm, onClose }: IConfirmDeleteSheetProps): ReactElement {
  const { t } = useTranslation();
  // A double tap lands twice before the sheet unmounts; delete once.
  const done = useRef(false);
  const confirm = (): void => {
    if (done.current) return;
    done.current = true;
    onConfirm();
  };

  return (
    <Sheet title={t(kind === 'sale' ? 'market.del.sale_q' : 'market.del.entry_q')} onClose={onClose}>
      <p className="mk-sheet-text">{text}</p>
      <div className="mk-sheet-btns">
        <button type="button" className="mk-btn mk-btn--tomato" onClick={confirm}>{t('market.del.yes')}</button>
        <button type="button" className="mk-btn mk-btn--quiet" onClick={onClose}>{t('market.team.cancel')}</button>
      </div>
    </Sheet>
  );
}
