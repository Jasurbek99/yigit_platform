import { useMemo, useState } from 'react';
import { Select, Button, InputNumber, Tag, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateDraft } from '@/hooks/useDrafts';
import { useUpdateTruckBlocks } from '@/hooks/useGaplama';
import { OfficialCodeEditor } from '@/components/draft/OfficialCodeEditor';
import { VarietySelect } from '@/components/VarietySelect';
import { useShipmentOptions } from '@/hooks/useAdmin';
import type { IGaplamaTruck, IDraftCreatePayload } from '@/types';

interface IGaplamaTruckFormProps {
  mode: 'create' | 'edit';
  today: string;
  editingTruck?: IGaplamaTruck;
  availableByBlock: Record<number, number>;
  blocks: { id: number; code: string; label: string }[];
  truckCapacityKg: number;
  onDone: () => void;
  onCancel: () => void;
}

interface IRow {
  blockId: number;
  kg: number | null;
}

function capFor(blockId: number, props: IGaplamaTruckFormProps): number {
  const base = props.availableByBlock[blockId] ?? 0;
  if (props.mode === 'edit' && props.editingTruck) {
    const own = props.editingTruck.block_sources.find((s) => s.block_id === blockId);
    return base + (own?.weight_kg ?? 0);
  }
  return base;
}

function initialRowsFor(props: IGaplamaTruckFormProps): IRow[] {
  if (props.mode === 'edit' && props.editingTruck) {
    return props.editingTruck.block_sources.map((s) => ({ blockId: s.block_id, kg: s.weight_kg }));
  }
  return [{ blockId: props.blocks[0]?.id ?? 0, kg: null }];
}

export default function GaplamaTruckForm(props: IGaplamaTruckFormProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language ?? 'tk';
  const createDraft = useCreateDraft();
  const updateBlocks = useUpdateTruckBlocks();

  const [rows, setRows] = useState<IRow[]>(() => initialRowsFor(props));
  const [exportCode, setExportCode] = useState(props.editingTruck?.export_code ?? '');
  const [harvestStatus, setHarvestStatus] = useState<string | undefined>();
  const [variety, setVariety] = useState<number | undefined>();
  const { data: harvestStatusOptions = [] } = useShipmentOptions('harvest_status');

  // Merge duplicate block rows for cap-checking and for the final payload.
  const mergedByBlock = useMemo(() => {
    const out: Record<number, number> = {};
    for (const row of rows) {
      if (!row.kg) continue;
      out[row.blockId] = (out[row.blockId] ?? 0) + row.kg;
    }
    return out;
  }, [rows]);

  const rowExceedsCap = (row: IRow): boolean => {
    if (!row.kg) return false;
    return mergedByBlock[row.blockId] > capFor(row.blockId, props);
  };

  const anyExceeds = rows.some(rowExceedsCap);
  const totalKg = Object.values(mergedByBlock).reduce((s, kg) => s + kg, 0);
  const hasAnyKg = totalKg > 0;
  const isPartial = totalKg > 0 && totalKg < props.truckCapacityKg;
  const submitDisabled = !hasAnyKg || anyExceeds;

  function updateRow(idx: number, patch: Partial<IRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function addRow() {
    setRows((prev) => [...prev, { blockId: props.blocks[0]?.id ?? 0, kg: null }]);
  }

  async function handleSubmit() {
    const blockSources = Object.entries(mergedByBlock).map(([blockId, weightKg]) => ({
      block_id: Number(blockId),
      weight_kg: weightKg,
    }));

    if (props.mode === 'edit' && props.editingTruck) {
      try {
        await updateBlocks.mutateAsync({ shipmentId: props.editingTruck.id, rows: blockSources });
        toast.success(t('tir_takip.gaplama.form.toast_updated'));
        props.onDone();
      } catch {
        toast.error(t('tir_takip.gaplama.form.toast_error'));
      }
      return;
    }

    // shipment_code is optional server-side (auto-generated when omitted —
    // backend/apps/export/serializers.py ShipmentCreateSerializer.shipment_code,
    // required=False). IDraftCreatePayload types it as required because every
    // other caller supplies one; this cast documents the deliberate omission
    // rather than widening the shared type from this single-purpose form.
    const payload = {
      is_draft: true,
      date: props.today,
      skip_forecast_check: true,
      block_sources: blockSources,
      weight_net: totalKg,
      export_code: exportCode || undefined,
      harvest_status: harvestStatus,
      varieties: variety ? [variety] : undefined,
    } as IDraftCreatePayload;

    try {
      await createDraft.mutateAsync(payload);
      toast.success(t('tir_takip.gaplama.form.toast_created'));
      props.onDone();
    } catch {
      toast.error(t('tir_takip.gaplama.form.toast_error'));
    }
  }

  return (
    <div className="sera-gaplama-form">
      {props.mode === 'create' && (
        <div className="sera-gaplama-form-day">{t('tir_takip.gaplama.form.day_label')}: {props.today}</div>
      )}
      <Space direction="vertical" style={{ width: '100%' }}>
        {rows.map((row, idx) => {
          const cap = capFor(row.blockId, props);
          const invalid = rowExceedsCap(row);
          return (
            <Space key={idx} align="start">
              <Select
                value={row.blockId}
                style={{ width: 160 }}
                onChange={(blockId) => updateRow(idx, { blockId })}
                options={props.blocks.map((b) => ({ value: b.id, label: b.label }))}
              />
              <InputNumber
                type="number"
                aria-label={t('tir_takip.gaplama.form.kg_label')}
                aria-invalid={invalid ? 'true' : undefined}
                value={row.kg ?? undefined}
                min={0}
                status={invalid ? 'error' : undefined}
                onChange={(kg) => updateRow(idx, { kg: kg ?? null })}
              />
              <span className="sera-gaplama-form-cap">
                {t('tir_takip.gaplama.form.available_hint', { kg: cap })}
              </span>
              {rows.length > 1 && (
                <Button type="text" onClick={() => removeRow(idx)}>
                  ✕
                </Button>
              )}
            </Space>
          );
        })}
        <Button onClick={addRow}>{t('tir_takip.gaplama.form.blok goş')}</Button>
      </Space>

      {props.mode === 'create' && (
        <>
          <OfficialCodeEditor value={exportCode} onChange={setExportCode} platformId={null} />
          <Select
            allowClear
            placeholder={t('tir_takip.gaplama.form.harvest_status_ph')}
            value={harvestStatus}
            onChange={setHarvestStatus}
            options={harvestStatusOptions
              .filter((o) => o.is_active)
              .map((o) => ({
                value: o.code,
                label: lang.startsWith('ru') && o.label_ru ? o.label_ru
                  : lang.startsWith('en') && o.label_en ? o.label_en : o.label_tk,
              }))}
          />
          <VarietySelect value={variety} onChange={(v) => setVariety(v ?? undefined)} />
        </>
      )}

      <div className="sera-gaplama-form-total">
        {t('tir_takip.gaplama.form.total_label')}: {totalKg} kg
        {isPartial && <Tag color="orange">{t('tir_takip.gaplama.form.partial_tag')}</Tag>}
      </div>

      <Space>
        <Button type="primary" disabled={submitDisabled} onClick={handleSubmit}>
          {props.mode === 'edit'
            ? t('tir_takip.gaplama.form.save')
            : t('tir_takip.gaplama.form.tır aç')}
        </Button>
        <Button onClick={props.onCancel}>{t('tir_takip.gaplama.form.cancel')}</Button>
      </Space>
    </div>
  );
}
