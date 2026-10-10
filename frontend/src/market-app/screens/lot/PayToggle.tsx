import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

interface IPayToggleProps {
  readonly paid: boolean;
  readonly onChange: (paid: boolean) => void;
}

/** «✓ Оплачено» (green, the default) / «В долг» (amber). */
export function PayToggle({ paid, onChange }: IPayToggleProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mk-pay">
      <button type="button" className="mk-pay-paid" aria-pressed={paid} onClick={() => onChange(true)}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 17l7 7L26 9" /></svg>
        {t('market.sell.paid')}
      </button>
      <button type="button" className="mk-pay-due" aria-pressed={!paid} onClick={() => onChange(false)}>
        {t('market.sell.debt')}
      </button>
    </div>
  );
}
