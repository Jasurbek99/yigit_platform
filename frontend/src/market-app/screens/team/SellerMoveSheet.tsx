import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { SheetButtons } from '../../components/SheetButtons';
import { useBazaars } from '../../hooks/useBazaars';
import { useSaveSeller, type ISeller } from '../../hooks/useSellers';
import { useSubmitLock } from '../lot/useSubmitLock';
import { sellerLabel, teamFormErrors, type FieldErrors } from './teamForm';

interface ISellerMoveSheetProps {
  readonly seller: ISeller;
  readonly onClose: () => void;
}

/** «Сменить базар»: move one seller to another of the agent's active bazaars. */
export function SellerMoveSheet({ seller, onClose }: ISellerMoveSheetProps): ReactElement {
  const { t } = useTranslation();
  const bazaars = (useBazaars().data ?? []).filter((b) => b.is_active);
  const save = useSaveSeller();
  const lock = useSubmitLock();
  const current = seller.bazaar && bazaars.some((b) => b.id === seller.bazaar?.id) ? String(seller.bazaar.id) : '';
  const [bazaarId, setBazaarId] = useState(current);
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!bazaarId) {
      setErrors({ bazaar_id: t('market.team.required') });
      return;
    }
    if (bazaarId === current) {
      onClose();
      return;
    }
    void lock.run(async () => {
      try {
        await save.mutateAsync({ id: seller.id, bazaar_id: Number(bazaarId) });
        onClose();
        return true;
      } catch (err) {
        setErrors(teamFormErrors(err, t('market.team.save_error')));
        return false;
      }
    });
  };

  return (
    <Sheet title={t('market.team.move')} onClose={onClose}>
      <p className="mk-note">{sellerLabel(seller)}</p>
      <form onSubmit={handleSubmit} noValidate>
        <Field id="mk-seller-move-bazaar" label={t('market.team.bazaar')} error={errors.bazaar_id} first>
          {(p) => (
            <select {...p} className={`${p.className} mk-field--select`} value={bazaarId}
              onChange={(e) => setBazaarId(e.target.value)}>
              {!current && <option value="">{t('market.team.choose_bazaar')}</option>}
              {bazaars.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </Field>
        <SheetButtons busy={lock.busy} onClose={onClose} formError={errors._} />
      </form>
    </Sheet>
  );
}
