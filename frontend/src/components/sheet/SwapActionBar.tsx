import { Button, Modal, Typography } from 'antd';
import { SwapOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSheetStore } from '@/stores/sheetStore';
import { useSwapPackaging } from '@/hooks/useDrafts';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { explainSwapBlockers } from './joinHelpers';
import { FONT } from '@/constants/styles';
import type { IShipmentSheetItem } from '@/types';

const { Text } = Typography;

interface ISwapActionBarProps {
  shipments: IShipmentSheetItem[];
}

/** Sheet Swap (spec 2026-09-29): two columns exchange their packing, nothing else. */
export function SwapActionBar({ shipments }: ISwapActionBarProps) {
  const { t } = useTranslation();
  const swapSelection = useSheetStore((s) => s.swapSelection);
  const setSwapMode = useSheetStore((s) => s.setSwapMode);
  const swapMutation = useSwapPackaging();

  const selected = swapSelection
    .map((id) => shipments.find((s) => s.id === id))
    .filter((s): s is IShipmentSheetItem => s !== undefined);
  const blockers = selected.length === 0 ? [] : explainSwapBlockers(selected);
  const canSwap = selected.length === 2 && blockers.length === 0;

  function handleSwap() {
    if (!canSwap) return;
    const [a, b] = selected;
    Modal.confirm({
      title: t('packing.confirm_swap_title'),
      content: t('packing.confirm_swap_body', { a: a.shipment_code, b: b.shipment_code }),
      okText: t('packing.confirm_ok'),
      cancelText: t('packing.confirm_cancel'),
      onOk: () => swapMutation.mutate(
        { aId: a.id, otherId: b.id },
        {
          onSuccess: () => { toast.success(t('packing.toast_swapped')); setSwapMode(false); },
          onError: (err) => toast.error(extractPatchError(err, t('packing.toast_error'))),
        },
      ),
    });
  }

  return (
    <div className="sheet-join-bar" style={{ background: '#fff7ed', borderBottomColor: '#fed7aa' }}>
      <SwapOutlined style={{ color: '#ea580c', fontSize: 14, flexShrink: 0 }} />
      <Text style={{ fontSize: 12, flexShrink: 0 }}>{t('sheet.swap_bar.instruction')}</Text>

      {canSwap && (
        <div className="sheet-join-bar__preview">
          {selected.map((s, i) => (
            <span key={s.id} style={{ display: 'contents' }}>
              {i === 1 && <span style={{ color: '#ea580c', fontSize: 14 }}>⇄</span>}
              <div className="sheet-join-bar__preview-chip" style={{ background: '#fff7ed', border: '1px solid #fdba74' }}>
                <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 11 }}>{s.shipment_code}</span>
                <span style={{ fontSize: 11, color: '#475467' }}>
                  {s.block_sources.map((b) => b.block_code).join(', ')}
                </span>
              </div>
            </span>
          ))}
        </div>
      )}

      {blockers.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', minWidth: 0 }}>
          {blockers.map((b) => (
            <Text key={`${b.key}:${b.code ?? ''}`} type="warning" style={{ fontSize: 12 }}>
              <WarningOutlined style={{ marginRight: 4 }} />
              {t(`join_blockers.${b.key}`, { code: b.code })}
            </Text>
          ))}
        </div>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
        <Button size="small" onClick={() => setSwapMode(false)}>{t('sheet.swap_bar.cancel')}</Button>
        <Button
          size="small"
          type="primary"
          disabled={!canSwap}
          loading={swapMutation.isPending}
          icon={<SwapOutlined />}
          onClick={handleSwap}
          style={canSwap ? { background: '#ea580c', borderColor: '#ea580c' } : undefined}
        >
          {t('packing.btn_swap')}
        </Button>
      </div>
    </div>
  );
}
