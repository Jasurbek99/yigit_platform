import { Alert, Button, InputNumber, Select, Space, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useShipmentPacking,
  useSetShipmentPacking,
  useApplyFirmSplit,
  type IShipmentPackingRow,
} from '@/hooks/useShipmentPacking';
import { useSplitTemplates } from '@/hooks/useSplitTemplates';
import { PackingPresetSelect } from '@/components/PackingPresetSelect';

const { Text } = Typography;

interface IShipmentPackingPanelProps {
  shipmentId: number;
}

const num = (v: string | number | null): string =>
  v == null || v === '' ? '—' : Number(v).toLocaleString();

/** Surface the server's message (e.g. the approved-quota guard), else a fallback. */
function apiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
  if (data && typeof data.error === 'string') return data.error;
  return fallback;
}

/**
 * Unified per-truck packing panel (poka-yoke).
 * Pick ONE whole-truck config + one split template → each firm's weight is set and
 * its packing derived by weight share (always sums to the truck). Firm weights are
 * switchable; gross/boxes/pallets can be overridden per firm; a live Σ-check warns
 * on any mismatch.
 */
export function ShipmentPackingPanel({ shipmentId }: IShipmentPackingPanelProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useShipmentPacking(shipmentId);
  const setPacking = useSetShipmentPacking();
  const applySplit = useApplyFirmSplit();
  const { data: splits = [] } = useSplitTemplates();

  const truckPicked = data?.whole_truck.packing_preset != null;
  const firmCount = data?.rows.length ?? 0;
  const matchingSplits = splits.filter((s) => s.part_count === firmCount);

  const onTruckChange = (presetId: number | null) => {
    setPacking.mutate(
      { shipment: shipmentId, scope: 'truck', packing_preset: presetId },
      { onError: () => toast.error(t('sheet.packing.toast_error')) },
    );
  };

  // Apply a split template: assign its weights to firms in current order.
  const onSplitPick = (templateId: number) => {
    const tpl = splits.find((s) => s.id === templateId);
    if (!tpl || !data) return;
    const weights = tpl.weights_list.map(Number);
    const firms = data.rows.map((r, i) => ({ export_firm_id: r.export_firm, weight_kg: weights[i] }));
    applySplit.mutate(
      { shipmentId, firms },
      { onError: (err) => toast.error(apiError(err, t('sheet.packing.toast_error'))) },
    );
  };

  // Switch: give firm `firmId` the weight `newWeight`, swapping with whichever
  // firm currently holds it (keeps the split total unchanged — poka-yoke).
  const onSwitchWeight = (firmId: number, newWeight: number) => {
    if (!data) return;
    const current = data.rows.map((r) => ({ id: r.export_firm, w: Number(r.weight_kg) }));
    const target = current.find((f) => f.id === firmId);
    if (!target || target.w === newWeight) return;
    const holder = current.find((f) => f.id !== firmId && f.w === newWeight);
    const oldWeight = target.w;
    const firms = current.map((f) => {
      if (f.id === firmId) return { export_firm_id: f.id, weight_kg: newWeight };
      if (holder && f.id === holder.id) return { export_firm_id: f.id, weight_kg: oldWeight };
      return { export_firm_id: f.id, weight_kg: f.w };
    });
    applySplit.mutate(
      { shipmentId, firms },
      { onError: (err) => toast.error(apiError(err, t('sheet.packing.toast_error'))) },
    );
  };

  // Distinct firm weights → the options for the per-firm switch dropdowns.
  const weightOptions = data
    ? Array.from(new Set(data.rows.map((r) => Number(r.weight_kg)).filter((w) => w > 0)))
        .sort((a, b) => b - a)
        .map((w) => ({ value: w, label: w.toLocaleString() }))
    : [];

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ marginTop: 8, padding: 8, background: '#fafafa', borderRadius: 4, width: 380 }}
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
        {truckPicked && data && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('sheet.packing.truck_totals', {
              net: num(data.whole_truck.net_kg),
              gross: num(data.whole_truck.gross_kg),
              boxes: num(data.whole_truck.box_count),
            })}
          </Text>
        )}
      </div>

      {/* Split template → sets the firm weights */}
      {firmCount > 1 && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>{t('sheet.packing.split')}</Text>
          <Select
            size="small"
            style={{ width: '100%', marginTop: 2 }}
            placeholder={t('sheet.packing.split_pick')}
            loading={applySplit.isPending}
            onChange={onSplitPick}
            value={null}
            notFoundContent={t('sheet.packing.no_split_match')}
            options={matchingSplits.map((s) => ({
              value: s.id,
              label: `${s.name}  (${num(s.total_kg)} kg)`,
            }))}
          />
        </div>
      )}

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
              <FirmPackingRow
                key={row.export_firm}
                shipmentId={shipmentId}
                row={row}
                truckPicked={truckPicked}
                weightOptions={weightOptions}
                onSwitchWeight={onSwitchWeight}
              />
            ))}
          </Space>
        )}
      </div>
    </div>
  );
}

type OverrideField = 'gross_kg' | 'box_count' | 'pallet_count' | 'pallet_weight_kg';

interface IFirmRowProps {
  shipmentId: number;
  row: IShipmentPackingRow;
  truckPicked: boolean;
  weightOptions: { value: number; label: string }[];
  onSwitchWeight: (firmId: number, newWeight: number) => void;
}

function FirmPackingRow({ shipmentId, row, truckPicked, weightOptions, onSwitchWeight }: IFirmRowProps) {
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

  const hasOverride = (['gross_kg', 'box_count', 'pallet_count', 'pallet_weight_kg'] as OverrideField[])
    .some((f) => row.override[f] != null);
  const canSwitch = weightOptions.length > 1 && row.weight_kg != null;

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
        <Text type="secondary" style={{ fontSize: 11 }}>{t('sheet.packing.net')}:</Text>
        {canSwitch ? (
          <Select
            size="small"
            value={Number(row.weight_kg)}
            options={weightOptions}
            onChange={(v) => onSwitchWeight(row.export_firm, v)}
            style={{ width: 90 }}
          />
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {row.weight_kg != null ? Number(row.weight_kg).toLocaleString() : '—'} kg
          </Text>
        )}
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
