import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { SheetButtons } from '../../components/SheetButtons';
import { useSaveBazaar } from '../../hooks/useBazaars';
import { teamFormErrors, type FieldErrors } from './teamForm';

interface IBazaarSheetProps {
  readonly onClose: () => void;
}

/** «Добавить базар»: a name, saved for the agent's own customer. */
export function BazaarSheet({ onClose }: IBazaarSheetProps): ReactElement {
  const { t } = useTranslation();
  const save = useSaveBazaar();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: t('market.team.required') });
      return;
    }
    try {
      await save.mutateAsync({ name: name.trim() });
      onClose();
    } catch (err) {
      setErrors(teamFormErrors(err, t('market.team.save_error')));
    }
  };

  return (
    <Sheet title={t('market.team.add_bazaar')} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <Field id="mk-bazaar-name" label={t('market.team.bazaar_name')} error={errors.name} first>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <SheetButtons busy={save.isPending} onClose={onClose} formError={errors._} />
      </form>
    </Sheet>
  );
}
