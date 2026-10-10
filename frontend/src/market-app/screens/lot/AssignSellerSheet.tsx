import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { SheetButtons } from '../../components/SheetButtons';
import { useUpdateLot } from '../../hooks/useLot';
import { useSellers } from '../../hooks/useSellers';
import type { ILot } from '../../types';
import { sellerLabel } from '../team/teamForm';
import { readableBody, readableError } from './saleBody';
import { useSubmitLock } from './useSubmitLock';

interface IAssignSellerSheetProps {
  readonly lot: ILot;
  readonly onClose: () => void;
}

interface IPickErrors {
  seller?: string;
  form?: string;
}

/**
 * «Кто продаёт эту машину?»: the customer's active sellers and «Без продавца». A seller who was
 * turned off stays listed while he holds the lot, so Save never unassigns him by accident.
 */
export function AssignSellerSheet({ lot, onClose }: IAssignSellerSheetProps): ReactElement {
  const { t } = useTranslation();
  const sellers = useSellers();
  const update = useUpdateLot(lot.id);
  const lock = useSubmitLock();
  const current = lot.seller ? String(lot.seller.id) : '';
  const [value, setValue] = useState(current);
  const [errors, setErrors] = useState<IPickErrors>({});
  const active = (sellers.data ?? []).filter((s) => s.is_active);
  const keepCurrent = lot.seller !== null && !active.some((s) => s.id === lot.seller?.id) ? lot.seller : null;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (value === current) {
      onClose();
      return;
    }
    void lock.run(async () => {
      try {
        await update.mutateAsync({ seller_id: value ? Number(value) : null });
        onClose();
        return true;
      } catch (err) {
        const seller = readableBody(err)?.seller_id?.[0];
        setErrors(seller ? { seller } : { form: readableError(err) ?? t('market.agent.save_error') });
        return false;
      }
    });
  };

  let picker: ReactElement;
  if (sellers.isLoading) picker = <p className="mk-note">{t('market.shell.loading')}</p>;
  else if (sellers.isError) picker = <p className="mk-err" role="alert">{t('market.shell.load_error')}</p>;
  else {
    picker = (
      <Field id="mk-lot-seller" label={t('market.agent.seller_label')} error={errors.seller} first>
        {(p) => (
          <select {...p} className={`${p.className} mk-field--select`} value={value}
            onChange={(e) => setValue(e.target.value)}>
            <option value="">{t('market.agent.no_seller')}</option>
            {keepCurrent && <option value={keepCurrent.id}>{keepCurrent.name}</option>}
            {active.map((s) => <option key={s.id} value={s.id}>{sellerLabel(s)}</option>)}
          </select>
        )}
      </Field>
    );
  }

  return (
    <Sheet title={t('market.agent.seller_title')} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        {picker}
        <SheetButtons busy={lock.busy || !sellers.isSuccess} onClose={onClose} formError={errors.form} />
      </form>
    </Sheet>
  );
}
