import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { SheetButtons } from '../../components/SheetButtons';
import { useSaveSeller, type ISeller } from '../../hooks/useSellers';
import { sellerLabel, teamFormErrors, type FieldErrors } from './teamForm';

interface IPasswordSheetProps {
  readonly seller: ISeller;
  readonly onClose: () => void;
}

/** «Сменить пароль» of one seller login. */
export function PasswordSheet({ seller, onClose }: IPasswordSheetProps): ReactElement {
  const { t } = useTranslation();
  const save = useSaveSeller();
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!password) {
      setErrors({ password: t('market.team.required') });
      return;
    }
    try {
      await save.mutateAsync({ id: seller.id, password });
      onClose();
    } catch (err) {
      setErrors(teamFormErrors(err, t('market.team.save_error')));
    }
  };

  return (
    <Sheet title={t('market.team.change_password')} onClose={onClose}>
      <p className="mk-note">{sellerLabel(seller)}</p>
      <form onSubmit={handleSubmit} noValidate>
        <Field id="mk-seller-new-password" label={t('market.team.new_password')} error={errors.password} first>
          {(p) => <input {...p} type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus />}
        </Field>
        <p className="mk-note">{t('market.team.password_hint')}</p>
        <SheetButtons busy={save.isPending} onClose={onClose} formError={errors._} />
      </form>
    </Sheet>
  );
}
