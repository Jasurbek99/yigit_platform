import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';
import { showToast } from '../../components/toastStore';
import { spoiledAmount } from '../../entryText';
import type { IDeleteEntryInput } from '../../hooks/useLotEntries';
import type { IEntryWrite, ILot, ISpoilage, ISpoilageInput } from '../../types';
import { QtyStepper } from './QtyStepper';
import { sellErrors, type SellErrors } from './saleBody';
import { stockOf } from './sellFormState';
import { boxesHint, canWriteOff, clampBoxes, spoilBody, spoilWeightHint, type ISpoilForm } from './spoilageState';
import { useSubmitLock } from './useSubmitLock';
import { WeightField } from './WeightField';

interface ISpoilageSheetProps {
  readonly lot: ILot;
  /** POST …/spoilage/ (the create hook lives above the sheet, so its key outlives a close). */
  readonly save: (body: ISpoilageInput) => Promise<IEntryWrite<ISpoilage>>;
  readonly onUndo: (entry: IDeleteEntryInput) => void;
  readonly onClose: () => void;
}

/** «Испорчено»: boxes (from 0) and an optional scale weight written off the truck, no money (study §3.7). */
export function SpoilageSheet({ lot, save, onUndo, onClose }: ISpoilageSheetProps): ReactElement {
  const { t } = useTranslation();
  const stock = stockOf(lot);
  const [form, setForm] = useState<ISpoilForm>({ boxes: '0', capped: false, gross: '' });
  const [errors, setErrors] = useState<SellErrors>({});
  const { busy, run } = useSubmitLock();

  const change = (patch: Partial<ISpoilForm>): void => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
  };
  const setBoxes = (raw: string): void => change(clampBoxes(raw, stock));
  const bump = (delta: number): void => setBoxes(String(Math.max(0, (Number(form.boxes) || 0) + delta)));
  const fixBoxes = (): void => {
    if (form.boxes === '') change({ boxes: '0', capped: false });
  };

  const submit = (): Promise<void> => run(async () => {
    try {
      const { entry, lot: after } = await save(spoilBody(form));
      const v = spoiledAmount(entry.boxes, entry.net_kg);
      showToast({
        text: t(after.closed_at ? 'market.spoil.saved_closed' : 'market.spoil.saved', { v }),
        actionLabel: t('market.sell.undo'),
        onAction: () => onUndo({ kind: 'spoilage', id: entry.id }),
      });
      onClose();
      return true;
    } catch (err) {
      setErrors(sellErrors(err, 'market.lot.maybe_saved'));
      return false;
    }
  });

  return (
    <Sheet title={t('market.spoil.title')} onClose={onClose}>
      <p className="mk-sheet-text">{lot.shipment.code}</p>
      <QtyStepper id="mk-spoil-qty" label={t('market.spoil.how')} unit="box" qty={form.boxes}
        hint={boxesHint(form, stock)} error={errors.qty} onQty={setBoxes} onBump={bump} onBlur={fixBoxes} />
      <WeightField id="mk-spoil-kg" value={form.gross} onChange={(gross) => change({ gross })}
        hint={spoilWeightHint(form, stock)} error={errors.gross_kg} />
      {errors._ && <p className="mk-err" role="alert">{errors._}</p>}
      <div className="mk-sheet-btns">
        <button type="button" className="mk-btn mk-btn--crate" disabled={busy || !canWriteOff(form, stock)}
          onClick={() => void submit()}>
          {t('market.spoil.save')}
        </button>
        <button type="button" className="mk-btn mk-btn--quiet" onClick={onClose}>{t('market.team.cancel')}</button>
      </div>
    </Sheet>
  );
}
