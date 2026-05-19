import { useState } from 'react';
import {
  Typography,
  Card,
  InputNumber,
  Button,
  Badge,
  Space,
  Alert,
  Spin,
  Tag,
} from 'antd';
import { CheckCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useDayEntries, useUpsertDayEntry } from '@/hooks/usePlanning';
import { useGreenhouseConfig } from '@/hooks/useGreenhouseConfig';
import { useSeasons } from '@/hooks/useAdmin';
import type { IHarvestDayEntry } from '@/types';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

// ─── Component ────────────────────────────────────────────────────────────────

export default function FallbackForecastView(): React.ReactElement {
  const { t } = useTranslation();
  const today = dayjs();
  const todayStr = today.format('YYYY-MM-DD');

  const { data: configData } = useGreenhouseConfig();
  const { data: seasonsData } = useSeasons();
  const activeSeason = seasonsData?.find((s) => s.is_active);

  // Load today's day entries for all blocks
  const { data: entries = [], isLoading } = useDayEntries({
    season: activeSeason?.id,
    date_from: todayStr,
    date_to: todayStr,
  });

  const upsert = useUpsertDayEntry();

  // Local forecast values keyed by entry id
  const [localValues, setLocalValues] = useState<Record<number, number | null>>({});
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());

  function handleChange(entryId: number, val: number | null) {
    setLocalValues((prev) => ({ ...prev, [entryId]: val }));
  }

  async function handleSaveAll() {
    const unsubmittedEntries = entries.filter((e) => !e.forecast_submitted_at);
    const toSave = unsubmittedEntries.filter((e) => localValues[e.id] !== undefined);

    if (toSave.length === 0) {
      toast.info(t('plan.fallback_nothing_to_save'));
      return;
    }

    const newSavingIds = new Set(toSave.map((e) => e.id));
    setSavingIds(newSavingIds);

    try {
      await Promise.all(
        toSave.map((e) =>
          upsert.mutateAsync({
            id: e.id,
            forecast_value: localValues[e.id],
          }),
        ),
      );
      toast.success(t('plan.toast_forecast_saved'));
      setLocalValues({});
    } catch {
      toast.error(t('plan.toast_save_error'));
    } finally {
      setSavingIds(new Set());
    }
  }

  const truckCapacity = configData ? Number(configData.truck_capacity_kg) : 18500;

  const pageTitle = t('plan.fallback_mode_title', { date: today.format('DD.MM.YYYY') });

  // Separate submitted and unsubmitted
  const submitted = entries.filter((e) => e.forecast_submitted_at);
  const pending = entries.filter((e) => !e.forecast_submitted_at);

  // Forecast total: submitted entries + local edits for pending
  const forecastTotal = entries.reduce((sum, e) => {
    if (e.forecast_submitted_at) return sum + (e.forecast_value != null ? Number(e.forecast_value) : 0);
    const local = localValues[e.id];
    if (local !== undefined) return sum + (local ?? 0);
    return sum + (e.plan_value != null ? Number(e.plan_value) : 0);
  }, 0);
  const estTrucks = truckCapacity > 0 ? (forecastTotal / truckCapacity).toFixed(1) : '—';

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px' }}>
      <Title level={3} style={{ margin: '0 0 4px' }}>{pageTitle}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        {t('plan.fallback_mode_help')}
      </Text>

      {/* KPI strip */}
      <Space size={24} style={{ marginBottom: 20 }} wrap>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('plan.total_forecast')}</Text>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.orange }}>
            {forecastTotal.toLocaleString()} kg
          </div>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('plan.est_trucks')}</Text>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            {estTrucks} <Text type="secondary" style={{ fontSize: 13 }}>{t('plan.trucks_suffix')}</Text>
          </div>
        </div>
      </Space>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : entries.length === 0 ? (
        <Alert message={t('plan.empty_week')} type="info" showIcon />
      ) : (
        <>
          {/* ── Pending blocks ── */}
          {pending.length > 0 && (
            <Card
              title={
                <Space>
                  <Badge color={COLORS.orange} />
                  <Text strong>{t('plan.forecast')}</Text>
                  <Tag color="orange">{pending.length}</Tag>
                </Space>
              }
              style={{ marginBottom: 16 }}
              size="small"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pending.map((entry) => (
                  <PendingRow
                    key={entry.id}
                    entry={entry}
                    value={localValues[entry.id] ?? (entry.plan_value != null ? Number(entry.plan_value) : null)}
                    onChange={(v) => handleChange(entry.id, v)}
                    saving={savingIds.has(entry.id)}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* ── Already submitted blocks ── */}
          {submitted.length > 0 && (
            <Card
              title={
                <Space>
                  <CheckCircleOutlined style={{ color: COLORS.success }} />
                  <Text strong>{t('plan.status_submitted')}</Text>
                  <Tag color="success">{submitted.length}</Tag>
                </Space>
              }
              style={{ marginBottom: 16 }}
              size="small"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {submitted.map((entry) => (
                  <SubmittedRow key={entry.id} entry={entry} />
                ))}
              </div>
            </Card>
          )}

          {/* ── Save all button ── */}
          {pending.length > 0 && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSaveAll}
              loading={upsert.isPending}
              style={{ width: '100%' }}
              size="large"
            >
              {t('plan.fallback_save_all')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface IPendingRowProps {
  entry: IHarvestDayEntry;
  value: number | null;
  onChange: (val: number | null) => void;
  saving: boolean;
}

function PendingRow({ entry, value, onChange, saving }: IPendingRowProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <div style={{ minWidth: 120 }}>
        <Tag color="blue">{entry.block_code}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>{entry.block_name}</Text>
      </div>
      {entry.plan_value && (
        <Text type="secondary" style={{ fontSize: 12, minWidth: 80 }}>
          {t('plan.plan')}: {Number(entry.plan_value).toLocaleString()}
        </Text>
      )}
      <InputNumber
        min={0}
        step={100}
        value={value}
        onChange={onChange}
        disabled={saving}
        size="small"
        style={{ width: 100 }}
        placeholder="—"
      />
    </div>
  );
}

interface ISubmittedRowProps {
  entry: IHarvestDayEntry;
}

function SubmittedRow({ entry }: ISubmittedRowProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid #f0f0f0',
        opacity: 0.8,
      }}
    >
      <div style={{ minWidth: 120 }}>
        <Tag color="blue">{entry.block_code}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>{entry.block_name}</Text>
      </div>
      <Text style={{ color: COLORS.success, fontWeight: 500 }}>
        {entry.forecast_value != null ? Number(entry.forecast_value).toLocaleString() : '—'}
      </Text>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('plan.fallback_already_submitted', {
          name: entry.forecast_submitted_by_name ?? '—',
        })}
      </Text>
    </div>
  );
}
