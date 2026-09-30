import { Button, Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentDraft } from '@/types';
import type { BoardAction } from './boardHelpers';
import { COLORS, FONT } from '@/constants/styles';

const { Text } = Typography;

const BUTTON_KEY = {
  join: 'packing.btn_join',
  unjoin: 'packing.btn_unjoin',
  swap: 'packing.btn_swap',
} as const;

interface IPackingActionPanelProps {
  selected: IShipmentDraft[];
  action: BoardAction;
  canAct: boolean;
  isPending: boolean;
  onRun: () => void;
  onClear: () => void;
}

/** Centre column: the picked cards and the one action they allow. */
export function PackingActionPanel({ selected, action, canAct, isPending, onRun, onClear }: IPackingActionPanelProps) {
  const { t } = useTranslation();

  function confirmThenRun() {
    if (action.kind === 'join') {
      onRun();
      return;
    }
    const [a, b] = selected.map((s) => s.shipment_code);
    const kind = action.kind === 'swap' ? 'swap' : 'unjoin';
    Modal.confirm({
      title: t(`packing.confirm_${kind}_title`),
      content: t(`packing.confirm_${kind}_body`, { a, b }),
      okText: t('packing.confirm_ok'),
      cancelText: t('packing.confirm_cancel'),
      onOk: onRun,
    });
  }

  if (selected.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Text type="secondary">{t('assign.hint_pick')}</Text>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {selected.map((s) => (
        <div key={s.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: 8 }}>
          <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 12 }}>{s.shipment_code}</span>
          <div style={{ fontSize: 11, color: COLORS.textSecondary }}>
            {[s.customer_name, s.country_name].filter(Boolean).join(', ')
              || s.block_sources.map((b) => b.block_code).join(' + ')}
          </div>
        </div>
      ))}
      {action.kind === 'none' ? (
        <Text type="warning" style={{ fontSize: 12 }}>
          {t(selected.length === 1 ? 'assign.hint_pick_second' : 'assign.hint_invalid')}
        </Text>
      ) : (
        <Button type="primary" block loading={isPending} disabled={!canAct} onClick={confirmThenRun}>
          {t(BUTTON_KEY[action.kind])}
        </Button>
      )}
      <Button block onClick={onClear}>{t('assign.btn_clear')}</Button>
    </div>
  );
}
