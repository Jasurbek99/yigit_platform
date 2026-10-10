import type { ChangeEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { useBuyers } from '../../hooks/useBuyers';

interface IBuyerFieldProps {
  readonly value: string;
  readonly onChange: (name: string) => void;
  readonly error?: string;
}

const ID = 'mk-sell-buyer';

/**
 * «Кто покупает?» on a debt sale: free text with the agent's known buyers as suggestions.
 * Mounted only on «В долг», so the suggestions are fetched only then; it takes the focus.
 */
export function BuyerField({ value, onChange, error }: IBuyerFieldProps): ReactElement {
  const { t } = useTranslation();
  const buyers = useBuyers(value).data ?? [];
  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => onChange(e.target.value);
  return (
    <div>
      <Field id={ID} label={t('market.sell.who')} error={error}>
        {(p) => (
          // autoFocus: pressing «В долг» moves straight to the name (study §3.5).
          <input {...p} type="text" autoComplete="off" maxLength={60} list={`${ID}-list`} autoFocus
            placeholder={t('market.sell.buyer_placeholder')} value={value} onChange={handleChange} />
        )}
      </Field>
      <datalist id={`${ID}-list`}>
        {buyers.map((b) => <option key={b.id} value={b.name} />)}
      </datalist>
    </div>
  );
}
