import { Alert, Button, InputNumber, Select, Space, Typography } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useShipmentPacking,
  useSetShipmentPacking,
  type IShipmentPackingRow,
} from '@/hooks/useShipmentPacking';
import { usePackingTemplates } from '@/hooks/usePackingTemplates';

const { Text } = Typography;

interface IProps {
  shipmentId: number;
}

const num = (v: string | number | null): string =>
  v == null || v === '' ? '—' : Number(v).toLocaleString();

function apiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
  if (data && typeof data.error === 'string') return data.error;
  return fallback;
}

/**
 * Unified per-truck packing (one Excel "gross net" row). Pick ONE PackingTemplate:
 * its whole-truck line feeds the CMR, and each firm share is copied onto that firm
 * (editable here) and sets the firm weight (quota-safe). Two firms are swappable.
 */
export function ShipmentPackingPanel({ shipmentId }: IProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useShipmentPacking(shipmentId);
  const setPacking = useSetShipmentPacking();
  const { data: templates = [] } = usePackingTemplates();

  const firmCount = data?.rows.length ?? 0;
  const truckPicked = data?.whole_truck.packing_template != null;
  const matching = templates.filter((tpl) => tpl.share_count === firmCount);

  const onError = (err: unknown) => toast.error(apiError(err, t('sheet.packing.toast_error')));

  const applyTemplate = (templateId: number) =>
    setPacking.mutate({ shipment: shipmentId, scope: 'template', packing_template: templateId }, { onError });

  const swap = () => {
    if (!data || data.rows.length !== 2) return;
    setPacking.mutate({
      shipment: shipmentId, scope: 'swap',
      export_firm_a: data.rows[0].export_firm, export_firm_b: data.rows[1].export_firm,
    }, { onError });
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ marginTop: 8, padding: 8, background: '#fafafa', borderRadius: 4, width: 380 }}
    >
      <Text strong style={{ fontSize: 12 }}>{t('sheet.packing.title')}</Text>

      {/* Pick a full template (whole truck + shares) */}
      <div style={{ marginTop: 6 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>{t('sheet.packing.template')}</Text>
        <Select
          size="small"
          style={{ width: '100%', marginTop: 2 }}
          placeholder={t('sheet.packing.template_pick')}
          value={data?.whole_truck.packing_template ?? undefined}
          loading={setPacking.isPending}
          onChange={applyTemplate}
          notFoundContent={firmCount < 1 ? t('sheet.packing.no_firms') : t('sheet.packing.no_template_match', { n: firmCount })}
          options={matching.map((tpl) => ({
            value: tpl.id, label: `${tpl.name}  (${num(tpl.net_kg)} kg)`,
          }))}
        />
        {truckPicked && data && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('sheet.packing.truck_totals', {
              net: num(data.whole_truck.net_kg), gross: num(data.whole_truck.gross_kg),
              boxes: num(data.whole_truck.box_count),
            })} → CMR
          </Text>
        )}
      </div>

      {/* Poka-yoke: firm weights must sum to the truck net */}
      {truckPicked && data && (
        data.consistent ? (
          <Alert type="success" showIcon style={{ marginTop: 8, padding: '2px 8px', fontSize: 11 }}
            message={t('sheet.packing.sum_ok', { total: num(data.total_firm_weight) })} />
        ) : (
          <Alert type="error" showIcon style={{ marginTop: 8, padding: '2px 8px', fontSize: 11 }}
            message={t('sheet.packing.sum_bad', {
              total: num(data.total_firm_weight), net: num(data.whole_truck.net_kg) })} />
        )
      )}

      {/* Per firm → Invoice (explicit values, editable) */}
      <div style={{ marginTop: 10 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 11 }}>{t('sheet.packing.per_firm')}</Text>
          {firmCount === 2 && (
            <Button size="small" type="text" icon={<SwapOutlined />} onClick={swap}>
              {t('sheet.packing.swap')}
            </Button>
          )}
        </Space>
        {isLoading ? (
          <Text type="secondary" style={{ fontSize: 12 }}>…</Text>
        ) : !data || data.rows.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>{t('sheet.packing.no_firms')}</Text>
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 4 }}>
            {data.rows.map((row) => (
              <FirmRow key={row.export_firm} shipmentId={shipmentId} row={row} onError={onError} />
            ))}
          </Space>
        )}
      </div>
    </div>
  );
}

type PackingField = 'gross_kg' | 'box_count' | 'pallet_count' | 'pallet_weight_kg';

function FirmRow({ shipmentId, row, onError }: {
  shipmentId: number; row: IShipmentPackingRow; onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const setPacking = useSetShipmentPacking();

  const commit = (field: PackingField, value: number | null) => {
    setPacking.mutate(
      { shipment: shipmentId, scope: 'firm', export_firm: row.export_firm, [field]: value },
      { onError },
    );
  };

  const fields: { key: PackingField; label: string; precision: number }[] = [
    { key: 'gross_kg', label: t('sheet.packing.gross'), precision: 2 },
    { key: 'box_count', label: t('sheet.packing.boxes'), precision: 0 },
    { key: 'pallet_count', label: t('sheet.packing.pallets'), precision: 1 },
    { key: 'pallet_weight_kg', label: t('sheet.packing.pallet_wt'), precision: 2 },
  ];

  return (
    <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 6 }}>
      <Space size={6} wrap style={{ marginBottom: 2 }}>
        <Text strong style={{ fontSize: 12 }}>{row.export_firm_code}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {t('sheet.packing.net')}: {num(row.weight_kg)} kg
        </Text>
      </Space>
      {row.sale_id == null ? (
        <Text type="warning" style={{ fontSize: 11 }}>{t('sheet.packing.no_sale')}</Text>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {fields.map(({ key, label, precision }) => (
            <div key={key}>
              <Text style={{ fontSize: 10, color: '#999' }}>{label}</Text>
              <InputNumber
                size="small"
                precision={precision}
                value={row[key] != null ? Number(row[key]) : null}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const parsed = raw === '' ? null : Number(raw);
                  const current = row[key] != null ? Number(row[key]) : null;
                  if (parsed !== current) commit(key, parsed);
                }}
                style={{ width: '100%' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
