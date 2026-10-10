import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { SheetButtons } from '../../components/SheetButtons';
import { useSaveBazaar, type IBazaar } from '../../hooks/useBazaars';
import { useSubmitLock } from '../lot/useSubmitLock';
import { teamFormErrors, type FieldErrors } from './teamForm';

interface IBazaarEditSheetProps {
  readonly bazaar: IBazaar;
  readonly onClose: () => void;
}

/** «Изменить базар»: rename it, or turn it off (no new sellers there) and back on. */
export function BazaarEditSheet({ bazaar, onClose }: IBazaarEditSheetProps): ReactElement {
  const { t } = useTranslation();
  const save = useSaveBazaar();
  const lock = useSubmitLock();
  const [name, setName] = useState(bazaar.name);
  const [active, setActive] = useState(bazaar.is_active);
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: t('market.team.required') });
      return;
    }
    void lock.run(async () => {
      try {
        await save.mutateAsync({ id: bazaar.id, name: name.trim(), is_active: active });
        onClose();
        return true;
      } catch (err) {
        setErrors(teamFormErrors(err, t('market.team.save_error')));
        return false;
      }
    });
  };

  return (
    <Sheet title={t('market.team.edit_bazaar')} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <Field id="mk-bazaar-edit-name" label={t('market.team.bazaar_name')} error={errors.name} first>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
        </Field>
        <label className="mk-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('market.team.bazaar_active')}
        </label>
        <SheetButtons busy={lock.busy} onClose={onClose} formError={errors._ ?? errors.is_active} />
      </form>
    </Sheet>
  );
}
