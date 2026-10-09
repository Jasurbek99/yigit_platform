import { useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '../../components/Field';
import { Sheet } from '../../components/Sheet';
import { SheetButtons } from '../../components/SheetButtons';
import { useBazaars } from '../../hooks/useBazaars';
import { useSaveSeller } from '../../hooks/useSellers';
import { teamFormErrors, type FieldErrors } from './teamForm';

interface ISellerSheetProps {
  readonly onClose: () => void;
}

interface ISellerForm {
  username: string;
  password: string;
  first_name: string;
  bazaar_id: string;
}

const EMPTY_FORM: ISellerForm = { username: '', password: '', first_name: '', bazaar_id: '' };

/** «Добавить продавца»: login, password, name and one of the agent's active bazaars. */
export function SellerSheet({ onClose }: ISellerSheetProps): ReactElement {
  const { t } = useTranslation();
  const bazaars = (useBazaars().data ?? []).filter((b) => b.is_active);
  const save = useSaveSeller();
  const [form, setForm] = useState<ISellerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});

  const handleChange = (key: keyof ISellerForm) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const missing: FieldErrors = {};
    if (!form.username.trim()) missing.username = t('market.team.required');
    if (!form.password) missing.password = t('market.team.required');
    if (!form.first_name.trim()) missing.first_name = t('market.team.required');
    if (!form.bazaar_id) missing.bazaar_id = t('market.team.required');
    if (Object.keys(missing).length) {
      setErrors(missing);
      return;
    }
    try {
      await save.mutateAsync({
        username: form.username.trim(),
        password: form.password,
        first_name: form.first_name.trim(),
        bazaar_id: Number(form.bazaar_id),
      });
      onClose();
    } catch (err) {
      setErrors(teamFormErrors(err, t('market.team.save_error')));
    }
  };

  return (
    <Sheet title={t('market.team.add_seller')} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <Field id="mk-seller-username" label={t('market.team.username')} error={errors.username} first>
          {(p) => <input {...p} value={form.username} onChange={handleChange('username')} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />}
        </Field>
        <Field id="mk-seller-password" label={t('market.team.password')} error={errors.password}>
          {(p) => <input {...p} type="text" value={form.password} onChange={handleChange('password')} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} />}
        </Field>
        <Field id="mk-seller-name" label={t('market.team.first_name')} error={errors.first_name}>
          {(p) => <input {...p} value={form.first_name} onChange={handleChange('first_name')} autoComplete="off" />}
        </Field>
        <Field id="mk-seller-bazaar" label={t('market.team.bazaar')} error={errors.bazaar_id}>
          {(p) => (
            <select {...p} className={`${p.className} mk-field--select`} value={form.bazaar_id} onChange={handleChange('bazaar_id')}>
              <option value="">{t('market.team.choose_bazaar')}</option>
              {bazaars.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </Field>
        <SheetButtons busy={save.isPending} onClose={onClose} formError={errors._} />
      </form>
    </Sheet>
  );
}
