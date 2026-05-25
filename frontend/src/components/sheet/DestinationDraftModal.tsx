import { useState } from 'react';
import { Modal, Button, Input, Typography, DatePicker } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useCreateDestinationDraft } from '@/hooks/useDrafts';
import { CountrySelect } from '@/components/CountrySelect';
import { CitySelect } from '@/components/CitySelect';
import { CustomerSelect } from '@/components/CustomerSelect';
import { ImportFirmSelect } from '@/components/ImportFirmSelect';
import { ExportFirmSelect } from '@/components/ExportFirmSelect';
import { COLORS, FONT } from '@/constants/styles';
import type { IDraftFirmSplitInput } from '@/types';

// ─── Firm split row ───────────────────────────────────────────────────────

interface IFirmSplitRowProps {
  index: number;
  firmId: number | null;
  weightKg: string;
  usedFirmIds: number[];
  onFirmChange: (firmId: number | null) => void;
  onWeightChange: (weight: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function FirmSplitRow({
  firmId,
  weightKg,
  usedFirmIds,
  onFirmChange,
  onWeightChange,
  onRemove,
  canRemove,
}: IFirmSplitRowProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 110px 32px',
        gap: 8,
        alignItems: 'center',
        marginBottom: 8,
      }}
    >
      <ExportFirmSelect
        value={firmId}
        onChange={onFirmChange}
        excludeIds={usedFirmIds.filter((id) => id !== firmId)}
        size="small"
        placeholder={t('sheet.dest_modal.firm_ph')}
      />
      <Input
        size="small"
        type="number"
        value={weightKg}
        onChange={(e) => onWeightChange(e.target.value)}
        placeholder="kg"
        suffix="kg"
        style={{ fontFamily: FONT.mono }}
      />
      <Button
        size="small"
        type="text"
        danger
        icon={<DeleteOutlined />}
        onClick={onRemove}
        disabled={!canRemove}
      />
    </div>
  );
}

// ─── Local types ──────────────────────────────────────────────────────────

interface IFirmSplitDraft {
  key: number;
  firm_id: number | null;
  weight_kg: string;
}

function makeKey(): number {
  return Date.now() + Math.random();
}

function autoCargo(): string {
  const now = dayjs();
  const dd = now.format('DD');
  const mm = now.format('MM');
  const yy = now.format('YY');
  const seq = String(Math.floor(Math.random() * 900 + 100));
  return `${dd}${mm}${seq}/${yy}`;
}

// ─── Main modal ───────────────────────────────────────────────────────────

export interface IDestinationDraftModalProps {
  open: boolean;
  onClose: () => void;
}

export function DestinationDraftModal({ open, onClose }: IDestinationDraftModalProps) {
  const { t } = useTranslation();
  const createDraft = useCreateDestinationDraft();

  const [date, setDate] = useState<ReturnType<typeof dayjs>>(dayjs());
  const [cargoCode, setCargoCode] = useState<string>(autoCargo);
  const [country, setCountry] = useState<number | null>(null);
  const [city, setCity] = useState<number | null>(null);
  const [customer, setCustomer] = useState<number | null>(null);
  const [importFirm, setImportFirm] = useState<number | null>(null);
  const [firmSplits, setFirmSplits] = useState<IFirmSplitDraft[]>([]);

  const usedFirmIds = firmSplits
    .map((f) => f.firm_id)
    .filter((id): id is number => id !== null);

  function handleAddFirmSplit() {
    setFirmSplits((prev) => [...prev, { key: makeKey(), firm_id: null, weight_kg: '' }]);
  }

  function handleRemoveFirmSplit(key: number) {
    setFirmSplits((prev) => prev.filter((f) => f.key !== key));
  }

  function handleFirmChange(key: number, firmId: number | null) {
    setFirmSplits((prev) => prev.map((f) => (f.key === key ? { ...f, firm_id: firmId } : f)));
  }

  function handleWeightChange(key: number, weight: string) {
    setFirmSplits((prev) => prev.map((f) => (f.key === key ? { ...f, weight_kg: weight } : f)));
  }

  function handleReset() {
    setDate(dayjs());
    setCargoCode(autoCargo());
    setCountry(null);
    setCity(null);
    setCustomer(null);
    setImportFirm(null);
    setFirmSplits([]);
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  function handleSave() {
    if (!cargoCode.trim()) {
      toast.error(t('draft.composer_error_no_code'));
      return;
    }

    const firm_splits: IDraftFirmSplitInput[] = firmSplits
      .filter((f) => f.firm_id !== null && Number(f.weight_kg) > 0)
      .map((f, i) => ({
        export_firm: f.firm_id as number,
        weight_kg: Number(f.weight_kg),
        split_order: i + 1,
      }));

    createDraft.mutate(
      {
        cargo_code: cargoCode.trim(),
        date: date.format('YYYY-MM-DD'),
        is_draft: true,
        block_sources: [],
        country: country ?? undefined,
        city: city ?? undefined,
        customer: customer ?? undefined,
        import_firm: importFirm ?? undefined,
        firm_splits: firm_splits.length > 0 ? firm_splits : undefined,
      },
      {
        onSuccess: (draft) => {
          toast.success(t('sheet.dest_modal.toast_saved', { code: draft.cargo_code }));
          handleReset();
          onClose();
        },
        onError: (err) => {
          const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
          if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) {
            toast.error(data.error);
            return;
          }
          toast.error(t('sheet.dest_modal.toast_error'));
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={t('sheet.dest_modal.title')}
      width={560}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          {t('common.cancel')}
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={createDraft.isPending}
          onClick={handleSave}
        >
          {t('sheet.dest_modal.save')}
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Date + Cargo code — side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
              {t('common.date')}
            </label>
            <DatePicker
              value={date}
              onChange={(d) => d && setDate(d)}
              format="DD.MM.YYYY"
              allowClear={false}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
              {t('sheet.supply_modal.cargo_code_label')}
            </label>
            <Input
              value={cargoCode}
              onChange={(e) => setCargoCode(e.target.value)}
              placeholder={t('sheet.supply_modal.cargo_code_ph')}
              style={{ fontFamily: FONT.mono }}
            />
          </div>
        </div>

        {/* Country (required) */}
        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
            {t('sheet.row.country')}
          </label>
          <CountrySelect
            value={country}
            onChange={(v) => { setCountry(v); setCity(null); }}
            style={{ width: '100%' }}
          />
        </div>

        {/* City */}
        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
            {t('sheet.row.city')}
          </label>
          <CitySelect
            value={city}
            onChange={setCity}
            countryId={country ?? undefined}
            style={{ width: '100%' }}
          />
        </div>

        {/* Customer (required) */}
        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
            {t('sheet.row.customer')}
          </label>
          <CustomerSelect
            value={customer}
            onChange={setCustomer}
            style={{ width: '100%' }}
          />
        </div>

        {/* Import firm */}
        <div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
            {t('sheet.row.import_firm')}
          </label>
          <ImportFirmSelect
            value={importFirm}
            onChange={setImportFirm}
            style={{ width: '100%' }}
          />
        </div>

        {/* Firm splits (optional) */}
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {t('sheet.dest_modal.firm_splits_label')}{' '}
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              ({t('common.optional')})
            </Typography.Text>
          </Typography.Text>
        </div>

        {firmSplits.map((split, idx) => (
          <FirmSplitRow
            key={split.key}
            index={idx}
            firmId={split.firm_id}
            weightKg={split.weight_kg}
            usedFirmIds={usedFirmIds}
            onFirmChange={(firmId) => handleFirmChange(split.key, firmId)}
            onWeightChange={(weight) => handleWeightChange(split.key, weight)}
            onRemove={() => handleRemoveFirmSplit(split.key)}
            canRemove={firmSplits.length > 1}
          />
        ))}

        <Button
          type="dashed"
          icon={<PlusOutlined />}
          size="small"
          onClick={handleAddFirmSplit}
          style={{ width: '100%', color: COLORS.textSecondary }}
        >
          {t('sheet.dest_modal.add_firm_split')}
        </Button>
      </div>
    </Modal>
  );
}
