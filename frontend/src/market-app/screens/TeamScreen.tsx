import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useBazaars, type IBazaar } from '../hooks/useBazaars';
import { useSaveSeller, useSellers, type ISeller } from '../hooks/useSellers';
import { BazaarEditSheet } from './team/BazaarEditSheet';
import { BazaarSheet } from './team/BazaarSheet';
import { PasswordSheet } from './team/PasswordSheet';
import { SellerMoveSheet } from './team/SellerMoveSheet';
import { SellerSheet } from './team/SellerSheet';
import { sellerLabel } from './team/teamForm';

type OpenSheet =
  | { kind: 'bazaar' } | { kind: 'edit-bazaar'; bazaar: IBazaar }
  | { kind: 'seller' } | { kind: 'password'; seller: ISeller } | { kind: 'move'; seller: ISeller }
  | null;

/** Agent only: its bazaars and the seller logins that work on them. */
export default function TeamScreen(): ReactElement {
  const { t } = useTranslation();
  const bazaars = useBazaars();
  const sellers = useSellers();
  const saveSeller = useSaveSeller();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const hasActiveBazaar = (bazaars.data ?? []).some((b) => b.is_active);
  const handleClose = (): void => setSheet(null);

  if (bazaars.isLoading || sellers.isLoading) {
    return <div className="mk-loading"><i className="mk-loading-dot" />{t('market.shell.loading')}</div>;
  }
  if (bazaars.isError || sellers.isError) {
    return <p className="mk-err" role="alert">{t('market.shell.load_error')}</p>;
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
              <div className="mk-card-btns">
                <button type="button" className="mk-small" onClick={() => setSheet({ kind: 'edit-bazaar', bazaar: b })}>
                  {t('market.team.edit')}
                </button>
              </div>
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
                <button type="button" className="mk-small" onClick={() => setSheet({ kind: 'move', seller: s })}>
                  {t('market.team.move')}
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

      {sheet?.kind === 'bazaar' && <BazaarSheet onClose={handleClose} />}
      {sheet?.kind === 'edit-bazaar' && <BazaarEditSheet bazaar={sheet.bazaar} onClose={handleClose} />}
      {sheet?.kind === 'seller' && <SellerSheet onClose={handleClose} />}
      {sheet?.kind === 'password' && <PasswordSheet seller={sheet.seller} onClose={handleClose} />}
      {sheet?.kind === 'move' && <SellerMoveSheet seller={sheet.seller} onClose={handleClose} />}
    </>
  );
}
