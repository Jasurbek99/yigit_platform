import type { ReactElement } from 'react';
import { LotCard } from '../../components/LotCard';
import type { ILot } from '../../types';

interface IOpenLotsListProps {
  /** Newest first, as the API sends them. */
  lots: ILot[];
  showSeller: boolean;
}

/** The open trucks as cards, 1 / 2 / 3 columns. */
export function OpenLotsList({ lots, showSeller }: IOpenLotsListProps): ReactElement {
  return (
    <div className="mk-list">
      {lots.map((lot) => <LotCard key={lot.id} lot={lot} showSeller={showSeller} />)}
    </div>
  );
}
