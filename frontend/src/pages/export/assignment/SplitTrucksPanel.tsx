import { useState, useMemo } from 'react';
import { Button, InputNumber, Typography, Tooltip, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CountrySelect } from '@/components/CountrySelect';
import { CitySelect } from '@/components/CitySelect';
import { CustomerSelect } from '@/components/CustomerSelect';
import { ImportFirmSelect } from '@/components/ImportFirmSelect';
import { ExportFirmSelect } from '@/components/ExportFirmSelect';
import { useSplitDraft } from '@/hooks/useDrafts';
import type { IShipmentDraft, ITruckSplitInput, ITruckFirmSplitInput } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

const { Text, Title } = Typography;

const MAX_TRUCK_WEIGHT_KG = 18_500;
const MAX_FIRM_SPLITS = 3;

// ─── Types ────────────────────────────────────────────────────────────────

interface ITruckRow {
  /** Stable React key */
  key: number;
  weight_kg: number;
  country: number | null;
  city: number | null;
  customer: number | null;
  import_firm: number | null;
  firm_splits: ITruckFirmSplitInput[];
}

interface ISplitTrucksPanelProps {
  draft: IShipmentDraft;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeKey(): number {
  return Date.now() + Math.random();
}

function makeTruckRow(): ITruckRow {
  return {
    key: makeKey(),
    weight_kg: 0,
    country: null,
    city: null,
    customer: null,
    import_firm: null,
    firm_splits: [],
  };
}

// ─── Component ────────────────────────────────────────────────────────────

export function SplitTrucksPanel({ draft, onClose }: ISplitTrucksPanelProps) {
  const { t } = useTranslation();
  const splitDraft = useSplitDraft();

  // Harvest total = sum of the draft's block allocations (what the backend
  // validates against). NOT draft.weight_net — that's operator-entered and is
  // null on a fresh draft, which would wrongly force "over capacity".
  const harvestTotal = useMemo(
    () => draft.block_sources.reduce((s, r) => s + Number(r.weight_kg), 0),
    [draft.block_sources],
  );
  const batchCode = draft.cargo_code;
  const shipmentCode = draft.official_export_code ?? '—';

  const [trucks, setTrucks] = useState<ITruckRow[]>([makeTruckRow()]);

  const totalTruckWeight = useMemo(
    () => trucks.reduce((sum, r) => sum + r.weight_kg, 0),
    [trucks],
  );

  const remaining = harvestTotal - totalTruckWeight;
  const isOverCapacity = remaining < 0;
  const isAtZero = remaining === 0;

  // ── Row handlers ─────────────────────────────────────────────────────

  function handleAddTruck() {
    if (remaining <= 0) return;
    setTrucks((prev) => [...prev, makeTruckRow()]);
  }

  function handleRemoveTruck(key: number) {
    if (trucks.length <= 1) return;
    setTrucks((prev) => prev.filter((r) => r.key !== key));
  }

  function handleFieldChange<K extends keyof ITruckRow>(
    key: number,
    field: K,
    value: ITruckRow[K],
  ) {
    setTrucks((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  }

  function handleCountryChange(key: number, value: number | null) {
    // Reset city when country changes
    setTrucks((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, country: value, city: null } : r,
      ),
    );
  }

  function handleAddFirmSplit(key: number) {
    setTrucks((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (r.firm_splits.length >= MAX_FIRM_SPLITS) return r;
        return { ...r, firm_splits: [...r.firm_splits, { export_firm_id: 0, weight_kg: null }] };
      }),
    );
  }

  function handleRemoveFirmSplit(key: number, splitIndex: number) {
    setTrucks((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = r.firm_splits.filter((_, i) => i !== splitIndex);
        return { ...r, firm_splits: next };
      }),
    );
  }

  function handleFirmSplitChange(
    key: number,
    splitIndex: number,
    field: keyof ITruckFirmSplitInput,
    value: number | null,
  ) {
    setTrucks((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = r.firm_splits.map((s, i) =>
          i === splitIndex ? { ...s, [field]: value } : s,
        );
        return { ...r, firm_splits: next };
      }),
    );
  }

  // ── Submit ────────────────────────────────────────────────────────────

  function handleSubmit() {
    if (isOverCapacity) {
      toast.error(t('split.error_over_capacity'));
      return;
    }

    const truckPayloads: ITruckSplitInput[] = trucks
      .filter((r) => r.weight_kg > 0)
      .map((r) => ({
        weight_kg: r.weight_kg,
        ...(r.country != null ? { country: r.country } : {}),
        ...(r.city != null ? { city: r.city } : {}),
        ...(r.customer != null ? { customer: r.customer } : {}),
        ...(r.import_firm != null ? { import_firm: r.import_firm } : {}),
        ...(r.firm_splits.length > 0
          ? {
              firm_splits: r.firm_splits
                .filter((s) => s.export_firm_id > 0)
                .map((s) => ({
                  export_firm_id: s.export_firm_id,
                  weight_kg: s.weight_kg ?? null,
                })),
            }
          : {}),
      }));

    if (truckPayloads.length === 0) {
      toast.error(t('split.error_no_trucks'));
      return;
    }

    splitDraft.mutate(
      { draftId: draft.id, payload: { trucks: truckPayloads } },
      {
        onSuccess: (result) => {
          toast.success(
            t('split.toast_success', { count: result.created_truck_ids.length }),
          );
          onClose();
        },
        onError: () => toast.error(t('split.toast_error')),
      },
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div>
        <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
          {t('split.header_title')}
        </Title>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            background: COLORS.bgLayout,
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 12,
          }}
        >
          <div>
            <Text type="secondary">{t('split.header_batch_code')}</Text>
            <div style={{ fontFamily: FONT.mono, fontWeight: 600, color: COLORS.primary }}>
              {batchCode}
            </div>
          </div>
          <div>
            <Text type="secondary">{t('split.header_shipment_code')}</Text>
            <div style={{ fontFamily: FONT.mono, fontWeight: 600 }}>{shipmentCode}</div>
          </div>
          <div>
            <Text type="secondary">{t('split.header_harvest_total')}</Text>
            <div style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
              {harvestTotal.toLocaleString('ru-RU')} kg
            </div>
          </div>
          <div>
            <Text type="secondary">{t('split.header_remaining')}</Text>
            <div
              style={{
                fontFamily: FONT.mono,
                fontWeight: 700,
                color: isOverCapacity
                  ? COLORS.danger
                  : isAtZero
                  ? COLORS.success
                  : COLORS.warning,
              }}
            >
              {remaining.toLocaleString('ru-RU')} kg
            </div>
          </div>
        </div>

        {remaining > 0 && !isOverCapacity && (
          <Text
            type="warning"
            style={{ display: 'block', marginTop: 6, fontSize: 12 }}
          >
            {t('split.discard_warning', { kg: remaining.toLocaleString('ru-RU') })}
          </Text>
        )}

        {isOverCapacity && (
          <Text
            type="danger"
            style={{ display: 'block', marginTop: 6, fontSize: 12 }}
          >
            {t('split.error_over_capacity')}
          </Text>
        )}
      </div>

      {/* ── Truck rows ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {trucks.map((truck, idx) => (
          <TruckRow
            key={truck.key}
            truck={truck}
            index={idx}
            canRemove={trucks.length > 1}
            onWeightChange={(v) => handleFieldChange(truck.key, 'weight_kg', v ?? 0)}
            onCountryChange={(v) => handleCountryChange(truck.key, v)}
            onCityChange={(v) => handleFieldChange(truck.key, 'city', v)}
            onCustomerChange={(v) => handleFieldChange(truck.key, 'customer', v)}
            onImportFirmChange={(v) => handleFieldChange(truck.key, 'import_firm', v)}
            onAddFirmSplit={() => handleAddFirmSplit(truck.key)}
            onRemoveFirmSplit={(i) => handleRemoveFirmSplit(truck.key, i)}
            onFirmSplitChange={(i, field, v) => handleFirmSplitChange(truck.key, i, field, v)}
            onRemove={() => handleRemoveTruck(truck.key)}
          />
        ))}
      </div>

      {/* ── Add Truck ── */}
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        disabled={remaining <= 0}
        onClick={handleAddTruck}
        block
      >
        {t('split.add_truck')}
      </Button>

      {/* ── Actions ── */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button style={{ flex: 1 }} onClick={onClose}>
          {t('split.cancel')}
        </Button>
        <Button
          type="primary"
          style={{ flex: 2 }}
          disabled={isOverCapacity}
          loading={splitDraft.isPending}
          onClick={handleSubmit}
        >
          {t('split.submit')}
        </Button>
      </div>
    </div>
  );
}

// ─── TruckRow (sub-component) ─────────────────────────────────────────────

interface ITruckRowProps {
  truck: ITruckRow;
  index: number;
  canRemove: boolean;
  onWeightChange: (value: number | null) => void;
  onCountryChange: (value: number | null) => void;
  onCityChange: (value: number | null) => void;
  onCustomerChange: (value: number | null) => void;
  onImportFirmChange: (value: number | null) => void;
  onAddFirmSplit: () => void;
  onRemoveFirmSplit: (index: number) => void;
  onFirmSplitChange: (
    index: number,
    field: keyof ITruckFirmSplitInput,
    value: number | null,
  ) => void;
  onRemove: () => void;
}

function TruckRow({
  truck,
  index,
  canRemove,
  onWeightChange,
  onCountryChange,
  onCityChange,
  onCustomerChange,
  onImportFirmChange,
  onAddFirmSplit,
  onRemoveFirmSplit,
  onFirmSplitChange,
  onRemove,
}: ITruckRowProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        padding: '12px 14px',
        background: COLORS.white,
      }}
    >
      {/* Row header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <Text strong style={{ fontSize: 13 }}>
          {t('split.truck_number', { n: index + 1 })}
        </Text>
        <Tooltip title={t('split.remove_truck_tooltip')}>
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={onRemove}
            disabled={!canRemove}
          />
        </Tooltip>
      </div>

      {/* Weight */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>
          {t('split.row_weight')}
        </div>
        <InputNumber
          value={truck.weight_kg || null}
          onChange={onWeightChange}
          min={1}
          max={MAX_TRUCK_WEIGHT_KG}
          step={500}
          style={{ width: '100%' }}
          size="small"
          addonAfter="kg"
          placeholder={t('split.row_weight_ph')}
        />
      </div>

      {/* Destination row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>
            {t('split.row_country')}
          </div>
          <CountrySelect
            value={truck.country}
            onChange={onCountryChange}
            size="small"
            placeholder={t('split.row_country_ph')}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>
            {t('split.row_city')}
          </div>
          <CitySelect
            value={truck.city}
            onChange={onCityChange}
            countryId={truck.country}
            size="small"
            placeholder={t('split.row_city_ph')}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>
            {t('split.row_customer')}
          </div>
          <CustomerSelect
            value={truck.customer}
            onChange={onCustomerChange}
            size="small"
            placeholder={t('split.row_customer_ph')}
          />
        </div>
      </div>

      {/* Import firm */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 }}>
          {t('split.row_import_firm')}
        </div>
        <ImportFirmSelect
          value={truck.import_firm}
          onChange={onImportFirmChange}
          size="small"
          placeholder={t('split.row_import_firm_ph')}
        />
      </div>

      {/* Export firm splits */}
      {truck.firm_splits.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 6 }}>
            {t('split.row_export_firms')}
          </div>
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            {truck.firm_splits.map((split, i) => (
              <div
                key={i}
                style={{ display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <ExportFirmSelect
                  value={split.export_firm_id || null}
                  onChange={(v) =>
                    onFirmSplitChange(i, 'export_firm_id', v)
                  }
                  size="small"
                  style={{ flex: 1 }}
                  placeholder={t('split.row_export_firm_ph')}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => onRemoveFirmSplit(i)}
                />
              </div>
            ))}
          </Space>
        </div>
      )}

      {truck.firm_splits.length < MAX_FIRM_SPLITS && (
        <Button
          type="link"
          size="small"
          icon={<PlusOutlined />}
          onClick={onAddFirmSplit}
          style={{ padding: 0, fontSize: 12 }}
        >
          {t('split.add_export_firm')}
        </Button>
      )}
    </div>
  );
}
