import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

interface ISlotCardProps {
  readonly text: string;
  /** The seller may still record costs here (closed truck, receipt pending); absent for anyone else. */
  readonly onCosts?: () => void;
}

/** The card in place of the sell form: «Машина закрыта…» / «Пусть агент укажет…», and «Расходы по машине». */
export function SlotCard({ text, onCosts }: ISlotCardProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mk-closed">
      <p>{text}</p>
      {onCosts && <button type="button" className="mk-btn" onClick={onCosts}>{t('market.costs.button')}</button>}
    </div>
  );
}
