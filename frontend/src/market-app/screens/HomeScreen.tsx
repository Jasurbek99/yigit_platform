import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AGENT_ROLE } from '@/constants/roles';
import { useLots } from '../hooks/useLots';
import { useMarketMe } from '../hooks/useMarketMe';
import { ClosedLotsList } from './home/ClosedLotsList';
import { EmptyLots } from './home/EmptyLots';
import { InTransitList } from './home/InTransitList';
import { OpenLotsList } from './home/OpenLotsList';

/**
 * The trucks (study §3.1): open lots as cards, then (agent only — the endpoint refuses sellers)
 * the trucks still to open, then the closed ones.
 */
export default function HomeScreen(): ReactElement {
  const { t } = useTranslation();
  const me = useMarketMe();
  const open = useLots('open');
  const closed = useLots('closed');
  const isAgent = me.data?.role === AGENT_ROLE;

  if (open.isLoading) {
    return <div className="mk-loading"><i className="mk-loading-dot" />{t('market.shell.loading')}</div>;
  }
  if (!open.data) return <p className="mk-err" role="alert">{t('market.shell.load_error')}</p>;
  const empty = open.data.length === 0 ? <EmptyLots /> : null;

  return (
    <>
      {open.data.length > 0 && <OpenLotsList lots={open.data} showSeller={isAgent} />}
      {isAgent ? <InTransitList fallback={empty} /> : empty}
      <ClosedLotsList lots={closed.data ?? []} />
    </>
  );
}
