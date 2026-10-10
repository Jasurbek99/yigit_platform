import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ILot } from '../../types';
import { AssignSellerSheet } from './AssignSellerSheet';
import { ReceiptSheet } from './ReceiptSheet';

interface IAgentLotControlsProps {
  readonly lot: ILot;
}

type OpenSheet = 'receipt' | 'seller' | null;

/**
 * The agent's part of the lot screen: the amber «Укажите, сколько ящиков пришло» while the box
 * count is a placeholder, «Приёмка» and «Продавец: …». Shown on a closed lot too: raising the
 * box count is how an undercounted truck is reopened.
 */
export function AgentLotControls({ lot }: IAgentLotControlsProps): ReactElement {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = (): void => setSheet(null);

  return (
    <div className="mk-agent">
      {lot.needs_receipt && <p className="mk-banner" role="status">{t('market.agent.needs_receipt')}</p>}
      <button type="button" className={lot.needs_receipt ? 'mk-btn mk-btn--tomato' : 'mk-btn'}
        onClick={() => setSheet('receipt')}>
        {t('market.agent.receipt')}
      </button>
      <button type="button" className="mk-btn mk-btn--quiet" onClick={() => setSheet('seller')}>
        {t('market.agent.seller', { name: lot.seller?.name ?? t('market.agent.seller_none') })}
      </button>
      {sheet === 'receipt' && <ReceiptSheet lot={lot} onClose={close} />}
      {sheet === 'seller' && <AssignSellerSheet lot={lot} onClose={close} />}
    </div>
  );
}
