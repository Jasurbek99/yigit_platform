import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { money } from '../format';
import { useDebts } from '../hooks/useDebts';

/**
 * Home tile «Долги клиентов» → /debts: «1 250 000 ₸ + 40 000 ₽» or «Долгов нет».
 * Nothing while loading or on error: the home screen has its own loading and error lines.
 */
export function DebtsTile(): ReactElement | null {
  const { t } = useTranslation();
  const debts = useDebts();
  if (!debts.data) return null;
  const parts = Object.entries(debts.data.totals).map(([currency, due]) => money(due, currency));
  return (
    <Link to="/debts" className="mk-debtbtn">
      <span>{t('market.debts.title')}</span>
      {parts.length ? <b>{parts.join(' + ')}</b> : <em>{t('market.debts.none')}</em>}
    </Link>
  );
}
