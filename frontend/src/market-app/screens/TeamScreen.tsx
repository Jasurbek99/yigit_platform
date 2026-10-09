import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Sheet from '../components/Sheet';
import {
  useBazaars, useSaveBazaar, useSaveSeller, useSellers, type ISeller,
} from '../hooks/useMarketTeam';

type FieldErrors = Record<string, string>;

/** DRF `{field: [msg]}` → first message per field; anything else lands under `_` (the form). */
function serverErrors(err: unknown, t: TFunction): FieldErrors {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  if (!data || typeof data !== 'object') return { _: t('market.team.save_error') };
  const out: FieldErrors = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const msg = Array.isArray(value) ? String(value[0]) : String(value);
    out[key === 'detail' || key === 'non_field_errors' || key === 'error' ? '_' : key] = msg;
  }
  return out;
}

function sellerLabel(s: ISeller): string {
  const name = [s.first_name, s.last_name].filter(Boolean).join(' ') || s.username;
  return s.bazaar ? `${name}, ${s.bazaar.name}` : name;
}

interface IFieldProps {
  id: string;
  label: string;
  error?: string;
  first?: boolean;
  children: (props: { id: string; className: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}

function Field({ id, label, error, first, children }: IFieldProps) {
  return (
    <>
      <label className={first ? 'mk-label mk-label--first' : 'mk-label'} htmlFor={id}>{label}</label>
      {children({
        id,
        className: error ? 'mk-field mk-field--bad' : 'mk-field',
        'aria-invalid': Boolean(error),
        'aria-describedby': error ? `${id}-err` : undefined,
      })}
      {error && <p className="mk-err" id={`${id}-err`}>{error}</p>}
    </>
  );
}

function SheetButtons({ busy, onClose, formError }: { busy: boolean; onClose: () => void; formError?: string }) {
  const { t } = useTranslation();
  return (
    <>
      {formError && <p className="mk-err" role="alert">{formError}</p>}
      <div className="mk-sheet-btns">
        <button type="submit" className="mk-btn mk-btn--tomato" disabled={busy}>{t('market.team.save')}</button>
        <button type="button" className="mk-btn mk-btn--quiet" onClick={onClose}>{t('market.team.cancel')}</button>
      </div>
    </>
  );
}

function BazaarSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const save = useSaveBazaar();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrors({ name: t('market.team.required') });
    try {
      await save.mutateAsync({ name: name.trim() });
      onClose();
    } catch (err) {
      setErrors(serverErrors(err, t));
    }
  };

  return (
    <Sheet title={t('market.team.add_bazaar')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="mk-bazaar-name" label={t('market.team.bazaar_name')} error={errors.name} first>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <SheetButtons busy={save.isPending} onClose={onClose} formError={errors._} />
      </form>
    </Sheet>
  );
}

function SellerSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const bazaars = (useBazaars().data ?? []).filter((b) => b.is_active);
  const save = useSaveSeller();
  const [form, setForm] = useState({ username: '', password: '', first_name: '', bazaar_id: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing: FieldErrors = {};
    if (!form.username.trim()) missing.username = t('market.team.required');
    if (!form.password) missing.password = t('market.team.required');
    if (!form.first_name.trim()) missing.first_name = t('market.team.required');
    if (!form.bazaar_id) missing.bazaar_id = t('market.team.required');
    if (Object.keys(missing).length) return setErrors(missing);
    try {
      await save.mutateAsync({
        username: form.username.trim(),
        password: form.password,
        first_name: form.first_name.trim(),
        bazaar_id: Number(form.bazaar_id),
      });
      onClose();
    } catch (err) {
      setErrors(serverErrors(err, t));
    }
  };

  return (
    <Sheet title={t('market.team.add_seller')} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="mk-seller-username" label={t('market.team.username')} error={errors.username} first>
          {(p) => <input {...p} value={form.username} onChange={set('username')} autoComplete="off" autoCapitalize="none" />}
        </Field>
        <Field id="mk-seller-password" label={t('market.team.password')} error={errors.password}>
          {(p) => <input {...p} type="text" value={form.password} onChange={set('password')} autoComplete="new-password" />}
        </Field>
        <Field id="mk-seller-name" label={t('market.team.first_name')} error={errors.first_name}>
          {(p) => <input {...p} value={form.first_name} onChange={set('first_name')} autoComplete="off" />}
        </Field>
        <Field id="mk-seller-bazaar" label={t('market.team.bazaar')} error={errors.bazaar_id}>
          {(p) => (
            <select {...p} className={`${p.className} mk-field--select`} value={form.bazaar_id} onChange={set('bazaar_id')}>
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

function PasswordSheet({ seller, onClose }: { seller: ISeller; onClose: () => void }) {
  const { t } = useTranslation();
  const save = useSaveSeller();
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setErrors({ password: t('market.team.required') });
    try {
      await save.mutateAsync({ id: seller.id, password });
      onClose();
    } catch (err) {
      setErrors(serverErrors(err, t));
    }
  };

  return (
    <Sheet title={t('market.team.change_password')} onClose={onClose}>
      <p className="mk-note">{sellerLabel(seller)}</p>
      <form onSubmit={submit} noValidate>
        <Field id="mk-seller-new-password" label={t('market.team.new_password')} error={errors.password} first>
          {(p) => <input {...p} type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />}
        </Field>
        <SheetButtons busy={save.isPending} onClose={onClose} formError={errors._} />
      </form>
    </Sheet>
  );
}

type OpenSheet = { kind: 'bazaar' } | { kind: 'seller' } | { kind: 'password'; seller: ISeller } | null;

/** Agent only: its bazaars and the seller logins that work on them. */
export default function TeamScreen() {
  const { t } = useTranslation();
  const bazaars = useBazaars();
  const sellers = useSellers();
  const saveSeller = useSaveSeller();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = () => setSheet(null);
  const hasActiveBazaar = (bazaars.data ?? []).some((b) => b.is_active);

  if (bazaars.isLoading || sellers.isLoading) {
    return <div className="mk-loading"><i className="mk-loading-dot" />{t('market.shell.loading')}</div>;
  }

  return (
    <>
      <h1 className="mk-title">{t('market.team.title')}</h1>

      <h2 className="mk-section">{t('market.team.bazaars')}</h2>
      {bazaars.data?.length ? (
        <div className="mk-list">
          {bazaars.data.map((b) => (
            <div key={b.id} className={b.is_active ? 'mk-card' : 'mk-card mk-card--off'}>
              <p className="mk-card-name">{b.name}</p>
              {!b.is_active && <p className="mk-card-sub"><span className="mk-tag">{t('market.team.inactive')}</span></p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="mk-note">{t('market.team.no_bazaars')}</p>
      )}
      <button type="button" className="mk-btn mk-btn--scan mk-add" onClick={() => setSheet({ kind: 'bazaar' })}>
        {t('market.team.add_bazaar')}
      </button>

      <h2 className="mk-section">{t('market.team.sellers')}</h2>
      {sellers.data?.length ? (
        <div className="mk-list">
          {sellers.data.map((s) => (
            <div key={s.id} className={s.is_active ? 'mk-card' : 'mk-card mk-card--off'}>
              <p className="mk-card-name">{sellerLabel(s)}</p>
              <p className="mk-card-sub">
                {s.username} · {s.is_active ? t('market.team.active') : t('market.team.inactive')}
              </p>
              <div className="mk-card-btns">
                <button type="button" className="mk-small" onClick={() => setSheet({ kind: 'password', seller: s })}>
                  {t('market.team.change_password')}
                </button>
                <button
                  type="button"
                  className={s.is_active ? 'mk-small mk-small--danger' : 'mk-small mk-small--ok'}
                  disabled={saveSeller.isPending}
                  onClick={() => saveSeller.mutate({ id: s.id, is_active: !s.is_active })}
                >
                  {s.is_active ? t('market.team.disable') : t('market.team.enable')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mk-note">{t('market.team.no_sellers')}</p>
      )}
      {saveSeller.isError && <p className="mk-err" role="alert">{t('market.team.save_error')}</p>}
      {!hasActiveBazaar && <p className="mk-note">{t('market.team.need_bazaar')}</p>}
      <button
        type="button"
        className="mk-btn mk-btn--tomato mk-add"
        disabled={!hasActiveBazaar}
        onClick={() => setSheet({ kind: 'seller' })}
      >
        {t('market.team.add_seller')}
      </button>

      {sheet?.kind === 'bazaar' && <BazaarSheet onClose={close} />}
      {sheet?.kind === 'seller' && <SellerSheet onClose={close} />}
      {sheet?.kind === 'password' && <PasswordSheet seller={sheet.seller} onClose={close} />}
    </>
  );
}
