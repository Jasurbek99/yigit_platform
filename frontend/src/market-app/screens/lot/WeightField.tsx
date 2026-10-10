import type { ChangeEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { groupThousands } from '../../format';
import type { IHint } from './sellFormState';

interface IWeightFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** «Чистый вес: …» or the amber «Вес меньше…»; hidden while an error stands. */
  readonly hint: IHint | null;
  readonly error?: string;
  /** Another form on the screen (the spoilage sheet) needs its own id. */
  readonly id?: string;
}

/** «Вес с ящиками, кг» — the scale weight, thousands spaced as typed, two decimals like the API. */
export function WeightField({ value, onChange, hint, error, id = 'mk-sell-kg' }: IWeightFieldProps): ReactElement {
  const { t } = useTranslation();
  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => onChange(groupThousands(e.target.value, 2));
  const shown = error ? null : hint;
  return (
    <div>
      <Field id={id} label={t('market.sell.weight')} error={error}>
        {(p) => (
          <input {...p} className={`${p.className} mk-field--num mk-num`} type="text" inputMode="decimal"
            autoComplete="off" placeholder="0" value={value} onChange={handleChange}
            aria-describedby={p['aria-describedby'] ?? (shown ? `${id}-hint` : undefined)} />
        )}
      </Field>
      {shown && <p className={shown.warn ? 'mk-hint mk-hint--warn' : 'mk-hint'} id={`${id}-hint`}>{shown.text}</p>}
    </div>
  );
}
