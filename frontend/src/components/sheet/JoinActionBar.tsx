import { Button, Typography } from 'antd';
import { MergeCellsOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSheetStore } from '@/stores/sheetStore';
import { useJoinShipments } from '@/hooks/useDrafts';
import { isDestinationDraft, isSupplyDraft } from './joinHelpers';
import { FONT } from '@/constants/styles';
import type { IShipmentSheetItem } from '@/types';

const { Text } = Typography;

interface IJoinActionBarProps {
  shipments: IShipmentSheetItem[];
}

export function JoinActionBar({ shipments }: IJoinActionBarProps) {
  const { t } = useTranslation();
  const joinSelection = useSheetStore((s) => s.joinSelection);
  const setJoinMode = useSheetStore((s) => s.setJoinMode);
  const joinMutation = useJoinShipments();

  // Resolve selected shipments from ids
  const selectedShipments = joinSelection
    .map((id) => shipments.find((s) => s.id === id))
    .filter((s): s is IShipmentSheetItem => s !== undefined);

  // Classify each selected shipment
  const destination = selectedShipments.find(isDestinationDraft) ?? null;
  const supply = selectedShipments.find(isSupplyDraft) ?? null;

  // Valid pair: exactly 2 selected, one destination, one supply, and they differ
  const hasTwoSelected = joinSelection.length === 2;
  const isValidPair =
    hasTwoSelected && destination !== null && supply !== null && destination.id !== supply.id;

  // Show validation hint when 2 are selected but pair is invalid
  const showInvalidHint = hasTwoSelected && !isValidPair;

  function handleConfirm() {
    if (!isValidPair || !destination || !supply) return;
    joinMutation.mutate(
      { targetId: destination.id, sourceId: supply.id },
      {
        onSuccess: () => {
          toast.success(t('sheet.join_modal.toast_success'));
          setJoinMode(false);
        },
        onError: (err) => {
          const data = (err as { response?: { data?: { error?: string } } }).response?.data;
          toast.error(data?.error ?? t('sheet.join_modal.toast_error'));
        },
      },
    );
  }

  return (
    <div className="sheet-join-bar">
      <MergeCellsOutlined style={{ color: '#2563eb', fontSize: 14, flexShrink: 0 }} />

      <Text style={{ fontSize: 12, flexShrink: 0 }}>
        {t('sheet.join_bar.instruction')}
      </Text>

      {/* Preview of the selected pair */}
      {hasTwoSelected && isValidPair && destination && supply && (
        <div className="sheet-join-bar__preview">
          {/* Supply side */}
          <div className="sheet-join-bar__preview-chip sheet-join-bar__preview-chip--supply">
            <span className="sheet-join-bar__chip-label">{t('sheet.join_bar.removed')}</span>
            <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 11 }}>
              {supply.cargo_code}
            </span>
            {supply.block_sources.length > 0 && (
              <span style={{ fontSize: 11, color: '#475467' }}>
                {supply.block_sources.map((b) => b.block_code).join(', ')}
                {supply.weight_net != null &&
                  ` · ${Number(supply.weight_net).toLocaleString('ru-RU')} kg`}
              </span>
            )}
          </div>

          <span style={{ color: '#98a2b3', fontSize: 12 }}>→</span>

          {/* Destination side */}
          <div className="sheet-join-bar__preview-chip sheet-join-bar__preview-chip--dest">
            <span className="sheet-join-bar__chip-label">{t('sheet.join_bar.kept')}</span>
            <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 11 }}>
              {destination.cargo_code}
            </span>
            {(destination.customer_name || destination.country_name) && (
              <span style={{ fontSize: 11, color: '#475467' }}>
                {[destination.customer_name, destination.country_name].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Validation hint when 2 selected but invalid pair */}
      {showInvalidHint && (
        <Text type="warning" style={{ fontSize: 12 }}>
          {t('sheet.join_bar.need_pair')}
        </Text>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
        <Button size="small" onClick={() => setJoinMode(false)}>
          {t('sheet.join_bar.cancel')}
        </Button>

        <Button
          size="small"
          type="primary"
          disabled={!isValidPair}
          loading={joinMutation.isPending}
          icon={<MergeCellsOutlined />}
          onClick={handleConfirm}
        >
          {t('sheet.join_bar.join')}
        </Button>
      </div>
    </div>
  );
}
