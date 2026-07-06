import { Alert, Button, InputNumber, Space, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useShipmentPacking,
  useSetShipmentPacking,
  type IShipmentPackingRow,
} from '@/hooks/useShipmentPacking';
import { PackingPresetSelect } from '@/components/PackingPresetSelect';

const { Text } = Typography;

interface IShipmentPackingPanelProps {
  shipmentId: number;
}

const num = (v: string | number | null): string =>
  v == null || v === '' ? '—' : Number(v).toLocaleString();

/**
 * Unified per-truck packing panel (poka-yoke).
 * Pick ONE whole-truck config → each firm's packing is derived by its weight share
 * (always sums to the truck). NET per firm = its weight, never editable. Gross/boxes/
 * pallets can be overridden per firm; a live Σ-check warns on any mismatch.
 */
export function ShipmentPackingPanel({ shipmentId }: IShipmentPackingPanelProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useShipmentPacking(shipmentId);
  const setPacking = useSetShipmentPacking();

  const onTruckChange = (presetId: number | null) => {
    setPacking.mutate(
      { shipment: shipmentId, scope: 'truck', packing_preset: presetId },
      { onError: () => toast.error(t('sheet.packing.toast_error')) },
    );
  };

  const truckPicked = data?.whole_truck.packing_preset != null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ marginTop: 8, padding: 8, background: '#fafafa', borderRadius: 4, width: 360 }}
    >
      <Text strong style={{ fontSize: 12 }}>{t('sheet.packing.title')}</Text>

      {/* Whole truck → CMR + per-firm derivation source */}
      <div style={{ marginTop: 6 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>{t('sheet.packing.whole_truck')}</Text>
        <PackingPresetSelect
          value={data?.whole_truck.packing_preset ?? undefined}
          onChange={onTruckChange}
          allowClear
          size="small"
          placeholder={t('sheet.packing.pick')}
          style={{ width: '100%', marginTop: 2 }}
        />
        {truckPicked && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('sheet.packing.truck_totals', {
              net: num(data!.whole_truck.net_kg),
              gross: num(data!.whole_truck.gross_kg),
              boxes: num(data!.whole_truck.box_count),
            })}
          </Text>
        )}
      </div>

      {/* Poka-yoke: firms must sum to the truck config net */}
      {truckPicked && data && (
        data.consistent ? (
          <Alert
            type="success" showIcon style={{ marginTop: 8, padding: '2px 8px', fontSize: 11 }}
            message={t('sheet.packing.sum_ok', { total: num(data.total_firm_weight) })}
          />
        ) : (
          <Alert
            type="error" showIcon style={{ marginTop: 8, padding: '2px 8px', fontSize: 11 }}
            message={t('sheet.packing.sum_bad', {
              total: num(data.total_firm_weight), net: num(data.whole_truck.net_kg),
            })}
          />
        )
      )}

      {/* Per firm → Invoice (derived, with optional override) */}
      <div style={{ marginTop: 10 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>{t('sheet.packing.per_firm')}</Text>
        {isLoading ? (
          <div><Text type="secondary" style={{ fontSize: 12 }}>…</Text></div>
        ) : !data || data.rows.length === 0 ? (
          <div><Text type="secondary" style={{ fontSize: 12 }}>{t('sheet.packing.no_firms')}</Text></div>
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 4 }}>
            {data.rows.map((row) => (
              <FirmPackingRow key={row.export_firm} shipmentId={shipmentId} row={row} truckPicked={truckPicked} />
            ))}
          </Space>
        )}
      </div>
    </div>
  );
}

type OverrideField = 'gross_kg' | 'box_count' | 'pallet_count' | 'pallet_weight_kg';

function FirmPackingRow({
  shipmentId, row, truckPicked,
}: { shipmentId: number; row: IShipmentPackingRow; truckPicked: boolean }) {
  const { t } = useTranslation();
  const setPacking = useSetShipmentPacking();

  const commit = (field: OverrideField, value: number | null) => {
    setPacking.mutate(
      { shipment: shipmentId, scope: 'firm', export_firm: row.export_firm, [field]: value },
      { onError: () => toast.error(t('sheet.packing.toast_error')) },
    );
  };

  const resetOverrides = () => {
    setPacking.mutate(
      {
        shipment: shipmentId, scope: 'firm', export_firm: row.export_firm,
        gross_kg: null, box_count: null, pallet_count: null, pallet_weight_kg: null,
      },
      { onError: () => toast.error(t('sheet.packing.toast_error')) },
    );
  };

  const weight = row.weight_kg != null ? Number(row.weight_kg).toLocaleString() : '—';
  const hasOverride = (['gross_kg', 'box_count', 'pallet_count', 'pallet_weight_kg'] as OverrideField[])
    .some((f) => row.override[f] != null);

  const fields: { key: OverrideField; label: string; precision: number }[] = [
    { key: 'gross_kg', label: t('sheet.packing.gross'), precision: 2 },
    { key: 'box_count', label: t('sheet.packing.boxes'), precision: 0 },
    { key: 'pallet_count', label: t('sheet.packing.pallets'), precision: 1 },
    { key: 'pallet_weight_kg', label: t('sheet.packing.pallet_wt'), precision: 2 },
  ];

  return (
    <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 6 }}>
      <Space size={6} wrap style={{ marginBottom: 2 }}>
        <Text strong style={{ fontSize: 12 }}>{row.export_firm_code}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{t('sheet.packing.net')}: {weight} kg</Text>
        {hasOverride && (
          <Tooltip title={t('sheet.packing.reset')}>
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={resetOverrides} />
          </Tooltip>
        )}
      </Space>
      {row.sale_id == null ? (
        <Text type="warning" style={{ fontSize: 11 }}>{t('sheet.packing.no_sale')}</Text>
      ) : !truckPicked ? (
        <Text type="secondary" style={{ fontSize: 11 }}>{t('sheet.packing.pick_truck_first')}</Text>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {fields.map(({ key, label, precision }) => {
            const derived = row.derived[key];
            const effective = row.override[key] ?? derived;
            const isOverridden = row.override[key] != null;
            return (
              <div key={key}>
                <Text style={{ fontSize: 10, color: '#999' }}>{label}</Text>
                <InputNumber
                  size="small"
                  precision={precision}
                  value={effective != null ? Number(effective) : null}
                  placeholder={derived != null ? String(derived) : '—'}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const parsed = raw === '' ? null : Number(raw);
                    const current = effective != null ? Number(effective) : null;
                    if (parsed !== current) commit(key, parsed);
                  }}
                  status={isOverridden ? 'warning' : undefined}
                  style={{ width: '100%' }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
