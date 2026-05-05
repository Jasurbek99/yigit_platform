import { Modal, Spin, Empty, Typography, Badge, Space, Divider, List } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useDayEntryHistory } from '@/hooks/usePlanning';
import type { IHarvestDayEntry, PlanState, ForecastWindow } from '@/types';

const { Text, Title } = Typography;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ICellHistoryModalProps {
  entry: IHarvestDayEntry | null;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtVal(val: string | null): string {
  if (val == null) return '—';
  const n = Number(val);
  return Number.isNaN(n) ? '—' : n.toLocaleString();
}

function fmtTs(ts: string | null): string {
  if (!ts) return '—';
  return dayjs(ts).format('DD.MM.YYYY HH:mm');
}

function PlanStateBadge({ state }: { state: PlanState | '' }) {
  const { t } = useTranslation();
  if (!state) return null;
  const map: Record<PlanState, { color: string; icon: React.ReactNode }> = {
    on_time: { color: '#52c41a', icon: <CheckCircleOutlined /> },
    late: { color: '#faad14', icon: <ClockCircleOutlined /> },
    critical_late: { color: '#ff4d4f', icon: <ExclamationCircleOutlined /> },
  };
  const cfg = map[state];
  return (
    <Badge
      color={cfg.color}
      text={
        <Text style={{ color: cfg.color, fontSize: 12 }}>
          {cfg.icon} {t(`plan.state_${state}`)}
        </Text>
      }
    />
  );
}

function ForecastWindowBadge({ win }: { win: ForecastWindow | '' }) {
  const { t } = useTranslation();
  if (!win) return null;
  const map: Record<ForecastWindow, string> = {
    primary: '#1677ff',
    fallback: '#fa8c16',
    same_day_red_flag: '#ff4d4f',
  };
  return (
    <Text style={{ color: map[win], fontSize: 12 }}>
      {t(`plan.window_${win}`)}
    </Text>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CellHistoryModal({ entry, onClose }: ICellHistoryModalProps): React.ReactElement {
  const { t } = useTranslation();

  const { data: history = [], isLoading } = useDayEntryHistory(entry?.id ?? null);

  const title = entry
    ? `${t('plan.cell_history_title')} — ${entry.block_code} ${dayjs(entry.entry_date).format('DD.MM.YYYY')}`
    : t('plan.cell_history_title');

  return (
    <Modal
      open={entry !== null}
      title={title}
      footer={null}
      onCancel={onClose}
      width={520}
      destroyOnHidden
    >
      {!entry ? null : (
        <>
          {/* ── Header: Plan / Forecast / Actual values ── */}
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={4}>
            {/* Plan */}
            <Space size={8} wrap>
              <Text strong style={{ color: '#1677ff', minWidth: 70 }}>{t('plan.plan')}:</Text>
              <Text>{fmtVal(entry.plan_value)}</Text>
              {entry.plan_submitted_at && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtTs(entry.plan_submitted_at)}
                  {entry.plan_submitted_by_name && ` · ${entry.plan_submitted_by_name}`}
                </Text>
              )}
              <PlanStateBadge state={entry.plan_state} />
            </Space>

            {/* Forecast */}
            <Space size={8} wrap>
              <Text strong style={{ color: '#fa8c16', minWidth: 70 }}>{t('plan.forecast')}:</Text>
              <Text>{fmtVal(entry.forecast_value)}</Text>
              {entry.forecast_submitted_at && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtTs(entry.forecast_submitted_at)}
                  {entry.forecast_submitted_by_name && ` · ${entry.forecast_submitted_by_name}`}
                </Text>
              )}
              {entry.forecast_window && <ForecastWindowBadge win={entry.forecast_window} />}
              {entry.forecast_revision_count > 1 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  (rev {entry.forecast_revision_count})
                </Text>
              )}
            </Space>

            {/* Actual */}
            <Space size={8} wrap>
              <Text strong style={{ color: '#52c41a', minWidth: 70 }}>{t('plan.actual')}:</Text>
              <Text>{fmtVal(entry.actual_value)}</Text>
              {entry.actual_finalized_at && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtTs(entry.actual_finalized_at)}
                </Text>
              )}
            </Space>
          </Space>

          {/* ── Admin override section ── */}
          {entry.last_override_at && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <Space size={4} align="start">
                <EditOutlined style={{ color: '#ff4d4f', marginTop: 3 }} />
                <Space direction="vertical" size={2}>
                  <Text strong style={{ color: '#ff4d4f', fontSize: 12 }}>
                    {t('plan.override_modal_title')}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtTs(entry.last_override_at)}
                    {entry.last_override_by_name && ` · ${entry.last_override_by_name}`}
                  </Text>
                  {entry.last_override_reason && (
                    <Text style={{ fontSize: 12 }}>{entry.last_override_reason}</Text>
                  )}
                </Space>
              </Space>
            </>
          )}

          {/* ── Audit log list ── */}
          <Divider style={{ margin: '12px 0' }} />
          <Title level={5} style={{ margin: '0 0 8px' }}>
            {t('plan.cell_history_title')}
          </Title>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Spin />
            </div>
          ) : history.length === 0 ? (
            <Empty
              description={t('plan.cell_history_no_audit')}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <List
              size="small"
              dataSource={history}
              renderItem={(item) => (
                <List.Item style={{ padding: '6px 0' }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space size={8} wrap>
                      <Text strong style={{ fontSize: 12 }}>{item.user_name ?? '—'}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {fmtTs(item.created_at)}
                      </Text>
                      <Text style={{ fontSize: 12 }}>{item.action}</Text>
                    </Space>
                    {item.field_name && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {item.field_name}
                        {item.old_value != null || item.new_value != null
                          ? `: ${t('plan.audit_old_to_new', {
                              old: item.old_value ?? '—',
                              new: item.new_value ?? '—',
                            })}`
                          : ''}
                      </Text>
                    )}
                    {item.detail && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {item.detail}
                      </Text>
                    )}
                  </Space>
                </List.Item>
              )}
            />
          )}
        </>
      )}
    </Modal>
  );
}
