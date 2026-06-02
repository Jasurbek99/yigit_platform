import { useState } from 'react';
import { Button, Typography } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useSheetStore } from '@/stores/sheetStore';
import { SwapFieldsModal } from './SwapFieldsModal';
import { FONT } from '@/constants/styles';
import type { IShipmentSheetItem } from '@/types';

const { Text } = Typography;

interface ISwapActionBarProps {
  shipments: IShipmentSheetItem[];
}

export function SwapActionBar({ shipments }: ISwapActionBarProps) {
  const { t } = useTranslation();
  const swapSelection = useSheetStore((s) => s.swapSelection);
  const setSwapMode = useSheetStore((s) => s.setSwapMode);

  const [modalOpen, setModalOpen] = useState(false);

  // Resolve selected shipments from IDs
  const selectedShipments = swapSelection
    .map((id) => shipments.find((s) => s.id === id))
    .filter((s): s is IShipmentSheetItem => s !== undefined);

  const hasTwoSelected = swapSelection.length === 2;
  const shipmentA = selectedShipments[0] ?? null;
  const shipmentB = selectedShipments[1] ?? null;

  function handleOpenModal() {
    if (!hasTwoSelected) return;
    setModalOpen(true);
  }

  function handleCancel() {
    setSwapMode(false);
  }

  return (
    <>
      <div className="sheet-join-bar" style={{ background: '#fff7ed', borderBottomColor: '#fed7aa' }}>
        <SwapOutlined style={{ color: '#ea580c', fontSize: 14, flexShrink: 0 }} />

        <Text style={{ fontSize: 12, flexShrink: 0 }}>
          {hasTwoSelected
            ? null
            : t('sheet.swap_bar.instruction')}
        </Text>

        {/* Preview chips when 2 are selected */}
        {hasTwoSelected && shipmentA && shipmentB && (
          <div className="sheet-join-bar__preview">
            {/* Shipment A chip */}
            <div
              className="sheet-join-bar__preview-chip"
              style={{ background: '#fff7ed', border: '1px solid #fdba74' }}
            >
              <span className="sheet-join-bar__chip-label">A</span>
              <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 11 }}>
                {shipmentA.cargo_code}
              </span>
              {(shipmentA.customer_name || shipmentA.country_name) && (
                <span style={{ fontSize: 11, color: '#475467' }}>
                  {[shipmentA.customer_name, shipmentA.country_name]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              )}
            </div>

            <span style={{ color: '#ea580c', fontSize: 14 }}>⇄</span>

            {/* Shipment B chip */}
            <div
              className="sheet-join-bar__preview-chip"
              style={{ background: '#fff7ed', border: '1px solid #fdba74' }}
            >
              <span className="sheet-join-bar__chip-label">B</span>
              <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 11 }}>
                {shipmentB.cargo_code}
              </span>
              {(shipmentB.customer_name || shipmentB.country_name) && (
                <span style={{ fontSize: 11, color: '#475467' }}>
                  {[shipmentB.customer_name, shipmentB.country_name]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Hint when fewer than 2 selected */}
        {!hasTwoSelected && swapSelection.length === 1 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('sheet.swap_bar.need_pair')}
          </Text>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
          <Button size="small" onClick={handleCancel}>
            {t('sheet.swap_bar.cancel')}
          </Button>

          <Button
            size="small"
            type="primary"
            disabled={!hasTwoSelected}
            icon={<SwapOutlined />}
            onClick={handleOpenModal}
            style={hasTwoSelected ? { background: '#ea580c', borderColor: '#ea580c' } : undefined}
          >
            {t('sheet.swap_bar.swap')}
          </Button>
        </div>
      </div>

      {/* Swap fields modal — only mount when both shipments are resolved */}
      {shipmentA && shipmentB && (
        <SwapFieldsModal
          open={modalOpen && hasTwoSelected}
          onClose={() => setModalOpen(false)}
          shipmentA={shipmentA}
          shipmentB={shipmentB}
        />
      )}
    </>
  );
}
