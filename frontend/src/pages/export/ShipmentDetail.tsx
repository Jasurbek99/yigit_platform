import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Flex,
  Grid,
  Modal,
  Skeleton,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { CheckCircleOutlined, EditOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShipmentDetailHero } from '@/components/shipment/ShipmentDetailHero';
import { RouteTimelineRail } from '@/components/shipment/RouteTimelineRail';
import { LifecycleStage, type StageState } from '@/components/shipment/LifecycleStage';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { VarietySelect } from '@/components/VarietySelect';
import { useShipmentDetail, getShipmentDetailKey } from '@/hooks/useShipmentDetail';
import { useOverrideVarieties } from '@/hooks/usePallets';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { EDIT_FIELD_GROUPS, type IEditFieldGroup } from '@/constants/shipmentEditConfig';
import api from '@/services/api';
import type { TableColumnsType } from 'antd';
import type {
  ICustomsExpense,
  IFirmSplit,
  IShipmentQuality,
} from '@/types';
import { CustomsExpenseModal } from '@/components/customsExpense/CustomsExpenseModal';
import { CUSTOMS_EXPENSE_WRITE_ROLES } from '@/components/customsExpense/CustomsExpensesTab';
import { InfoRow, SalesReportForm } from './ShipmentDetailHelpers';
import { MIN_SALES_REPORT_STEP } from '@/components/salesReport/salesReportUtils';
import { fmt, fmtDate, fmtNum } from './ShipmentDetailHelpers.helpers';
import { COLORS } from '@/constants/styles';

const { Text, Title } = Typography;

const groupByKey = (key: IEditFieldGroup['key']): IEditFieldGroup =>
  EDIT_FIELD_GROUPS.find((g) => g.key === key)!;

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const screens = Grid.useBreakpoint();
  const { data: shipment, isLoading, isError } = useShipmentDetail(id);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideIds, setOverrideIds] = useState<number[]>([]);
  const [customsExpenseOpen, setCustomsExpenseOpen] = useState(false);
  const overrideMutation = useOverrideVarieties(Number(id));

  const qualityMutation = useMutation({
    mutationFn: async ({ field, checked }: { field: keyof IShipmentQuality; checked: boolean }) => {
      await api.patch(`/export/shipments/${id}/quality/`, { [field]: checked });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(id) });
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (isError || !shipment) {
    return <Alert type="error" message={t('shipment_detail.error_load')} style={{ margin: 24 }} />;
  }

  const canEditQuality = canDo(user, 'shipment', 'edit');
  const canWriteExpense =
    (user ? CUSTOMS_EXPENSE_WRITE_ROLES.has(user.role) : false) ||
    user?.is_superuser === true;
  // Sales report: only sales_rep / export_manager / director (or superuser) once
  // the shipment has departed (step_order >= 4) — system status lags the real
  // sale, so gating on "sold" would block reports for trucks that have sold.
  const canEditSalesReport =
    (
      user?.role === 'sales_rep' ||
      user?.role === 'export_manager' ||
      user?.role === 'director' ||
      user?.role === 'admin' ||
      user?.is_superuser === true
    ) && shipment.status_step >= MIN_SALES_REPORT_STEP;
  const canEditAnyField = canDo(user, 'shipment', 'edit');
  const canOverrideVariety =
    user?.role === 'warehouse_chief' ||
    user?.role === 'export_manager' ||
    user?.role === 'director' ||
    user?.is_superuser === true;

  const q: IShipmentQuality = shipment.quality ?? {
    azyk_maglumatnama: false,
    suriji_gozukdiriji: false,
    hil_sertifikaty: false,
    kalibrowka_analiz: false,
  };

  const qualityFields: (keyof IShipmentQuality)[] = [
    'azyk_maglumatnama',
    'suriji_gozukdiriji',
    'hil_sertifikaty',
    'kalibrowka_analiz',
  ];

  // Report section is visible for all roles once the shipment has departed
  // (step_order >= 4).
  const isReportAvailable = shipment.status_step >= MIN_SALES_REPORT_STEP;

  const blockDisplay =
    shipment.block_sources.length === 0
      ? '—'
      : shipment.block_sources.map((b) => b.block_code).join(', ');

  // ── Firm splits table ──────────────────────────────────────────────────────

  const firmSplitColumns: TableColumnsType<IFirmSplit> = [
    { title: t('shipment_detail.firm_splits_col_firm'), dataIndex: 'export_firm_name' },
    { title: t('shipment_detail.weight_net'), dataIndex: 'weight_kg', render: (_, record) => fmtNum(record.weight_kg) },
    { title: t('shipment_detail.total_usd'), dataIndex: 'amount_usd', render: (_, record) => fmtNum(record.amount_usd) },
    { title: t('shipment_detail.firm_splits_col_invoice'), dataIndex: 'invoice_number', render: (_, record) => record.invoice_number ?? '—' },
  ];

  // ── Editable sections ──────────────────────────────────────────────────────
  // Each section renders the corresponding EDIT_FIELD_GROUPS group(s) as
  // DetailFieldRow components, plus any special inline content (variety
  // override widget, firm-splits table, quality checkboxes, sales report).

  const renderEditableGroup = (group: IEditFieldGroup) => (
    <div key={group.key}>
      {group.fields.map((config) => (
        <DetailFieldRow
          key={config.key}
          shipment={shipment}
          config={config}
          readOnly={!canEditAnyField}
        />
      ))}
    </div>
  );

  // ── Section panel renderers ────────────────────────────────────────────────
  // Each section is a Card with a SectionBlock header + the relevant fields,
  // always visible. No accordion — operators see everything in one scroll.
  // Logistics + Transport pair on the top row, Goods + Documents on the next,
  // Finance spans full width because of the firm-splits table and sales report.

  const logisticsBody = renderEditableGroup(groupByKey('logistics'));

  const transportBody = renderEditableGroup(groupByKey('transport'));

  const goodsBody = (
    <>
      <InfoRow label={t('shipment_detail.block_sources')} value={blockDisplay} />

        {/* Variety sub-section */}
        <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t('variety.section_title')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {shipment.variety_confidence === 'high' && (
                <Tag color="success">✓ {t('pallet.confidence_high')}</Tag>
              )}
              {shipment.variety_confidence === 'low' && (
                <Tag color="warning">⚠ {t('pallet.confidence_low')}</Tag>
              )}
              {shipment.variety_confidence === 'none' && (
                <Tag color="default">{t('pallet.confidence_none')}</Tag>
              )}
              {canOverrideVariety && (
                <Button
                  size="small"
                  onClick={() => {
                    setOverrideIds(shipment.varieties_dominant.map((v) => v.id));
                    setOverrideOpen(true);
                  }}
                >
                  {t('variety.override_btn')}
                </Button>
              )}
            </div>
          </div>
          {shipment.varieties_dominant.length === 0 ? (
            <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{t('variety.empty_state')}</span>
          ) : (
            <Flex gap={4} wrap="wrap">
              {shipment.varieties_dominant.map((v) => (
                <Tag key={v.id} color={v.is_experimental ? 'orange' : undefined} style={{ margin: 0 }}>
                  {v.code ? `${v.code} · ` : ''}{v.name}
                  {v.is_experimental && <span style={{ marginLeft: 4, fontSize: 10 }}>(exp)</span>}
                </Tag>
              ))}
            </Flex>
          )}
        </div>

      {renderEditableGroup(groupByKey('goods'))}
      <InfoRow label={t('shipment_detail.harvest_date')} value={fmtDate(shipment.date)} />
    </>
  );

  const documentsBody = (
    <>
      {/* Quality certificates */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            {t('shipment_detail.section_certs')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {qualityFields.map((field) => (
              <Checkbox
                key={field}
                id={`detail-field-quality.${field}`}
                checked={q[field]}
                disabled={!canEditQuality || qualityMutation.isPending}
                onChange={(e) => qualityMutation.mutate({ field, checked: e.target.checked })}
              >
                {t(`quality.${field}`)}
              </Checkbox>
            ))}
          </div>
        </div>

        {/* Status fields: documents_status, harvest_status, customs_clearance_planned_day */}
        {renderEditableGroup(groupByKey('status'))}

        {/* Timestamps (read-only — written by transition_to per AD-1) */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            {t('shipment_detail.section_timestamps')}
          </div>
          <InfoRow label={t('shipment_detail.loading_started')} value={fmt(shipment.loading_started_at)} />
          <InfoRow label={t('shipment_detail.customs_entry')} value={fmt(shipment.customs_entry_at)} />
          <InfoRow label={t('shipment_detail.customs_exit')} value={fmt(shipment.customs_exit_at)} />
          <InfoRow label={t('shipment_detail.border_crossed')} value={fmt(shipment.border_crossed_at)} />
          <InfoRow label={t('shipment_detail.arrived')} value={fmt(shipment.arrived_at)} />
          <InfoRow label={t('shipment_detail.sale_started')} value={fmt(shipment.sale_started_at)} />
          <InfoRow label={t('shipment_detail.sale_ended')} value={fmt(shipment.sale_ended_at)} />
        </div>
    </>
  );

  const financeBody = (
    <>
      {renderEditableGroup(groupByKey('finance'))}
        {renderEditableGroup(groupByKey('notes'))}

        {shipment.firm_splits.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Title level={5} style={{ marginBottom: 8 }}>{t('shipment_detail.firm_splits')}</Title>
            <Table<IFirmSplit>
              dataSource={shipment.firm_splits}
              columns={firmSplitColumns}
              rowKey="export_firm_id"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {isReportAvailable ? (
            <>
              {!shipment.sales_report && !canEditSalesReport && (
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  {t('sales_report.empty')}
                </Text>
              )}
              <SalesReportForm
                shipmentId={String(shipment.id)}
                report={shipment.sales_report}
                canEdit={canEditSalesReport}
              />
            </>
          ) : (
            <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>
              {t('sales_report.only_at_hasabat')}
            </Text>
          )}
        </div>
    </>
  );

  // ── Lifecycle spine stages ──────────────────────────────────────────────────
  // Field groups regrouped under the shipment's journey stages, in the
  // platform's own phase order (PLAN/PREP → DOCS → LOAD → TRANSIT/DEST → CLOSE).
  // The stage matching the current phase opens by default; the rest collapse.
  const STAGES = [
    { key: 'destination', phases: ['PLAN', 'PREP'], body: logisticsBody },
    { key: 'documents', phases: ['DOCS'], body: documentsBody },
    { key: 'loading', phases: ['LOAD'], body: goodsBody },
    { key: 'transit', phases: ['TRANSIT', 'DEST'], body: transportBody },
    { key: 'sale', phases: ['CLOSE'], body: financeBody },
  ] as const;

  const activeStageIdx = STAGES.findIndex((s) =>
    (s.phases as readonly string[]).includes(shipment.phase),
  );

  // ── Guidance line ───────────────────────────────────────────────────────────
  // One state-aware "what to do now" line under the hero. Grounded entirely in
  // existing shipment state (personal task / status code) — no invented domain
  // steps. A draft's empty destination fields are normal, so the draft message
  // explains that instead of leaving the screen reading as an abandoned form.

  const guide = ((): { text: string; tone: 'task' | 'draft' | 'info' } => {
    if (shipment.my_task) {
      return { text: t('shipment.detail.guide.your_task', { task: t(shipment.my_task.title_key) }), tone: 'task' };
    }
    if (shipment.status_code === 'draft') {
      return { text: t('shipment.detail.guide.draft'), tone: 'draft' };
    }
    if (shipment.status_code === 'cancelled') {
      return { text: t('shipment.detail.guide.cancelled'), tone: 'info' };
    }
    if (shipment.status_code === 'tamamlandy') {
      return { text: t('shipment.detail.guide.completed'), tone: 'info' };
    }
    return { text: t('shipment.detail.guide.active', { status: shipment.status_display }), tone: 'info' };
  })();

  const guideStyle = {
    task: { bg: COLORS.bgBlue, accent: COLORS.primary, icon: <CheckCircleOutlined style={{ color: COLORS.primary }} /> },
    draft: { bg: COLORS.bgGold, accent: COLORS.warning, icon: <EditOutlined style={{ color: COLORS.warning }} /> },
    info: { bg: COLORS.bgLight, accent: COLORS.borderLight, icon: <InfoCircleOutlined style={{ color: COLORS.textSecondary }} /> },
  }[guide.tone];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Hero bar */}
      <ShipmentDetailHero shipment={shipment} />

      {/* State-aware guidance line — tells the employee what this shipment
          needs right now, so an empty draft no longer reads as a broken form. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          marginBottom: 16,
          borderRadius: 6,
          background: guideStyle.bg,
          borderLeft: `3px solid ${guideStyle.accent}`,
          fontSize: 13,
          color: COLORS.textPrimary,
        }}
      >
        {guideStyle.icon}
        <span>{guide.text}</span>
      </div>

      {/* 2-column grid: data column left, timeline rail right on ≥md */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: screens.md ? '1fr 340px' : '1fr',
          gap: 20,
          alignItems: 'start',
        }}
      >
        {/* Left: lifecycle spine. Each journey stage is a collapsible row; the
            stage matching the current phase opens, the rest stay one click away
            — so operators focus on the step they're on, not a wall of fields. */}
        <div>
          <Card size="small" styles={{ body: { padding: '16px 20px' } }} style={{ marginBottom: 16 }}>
            {STAGES.map((stage, idx) => {
              const state: StageState =
                activeStageIdx < 0 ? 'pending' :
                idx < activeStageIdx ? 'done' :
                idx === activeStageIdx ? 'active' :
                'pending';
              return (
                <LifecycleStage
                  key={stage.key}
                  stepNumber={idx + 1}
                  title={t(`shipment.detail.stage.${stage.key}`)}
                  state={state}
                  summary={t(`shipment.detail.stage_state.${state}`)}
                  defaultOpen={idx === activeStageIdx}
                  isLast={idx === STAGES.length - 1}
                >
                  {stage.body}
                </LifecycleStage>
              );
            })}
          </Card>

          {/* Customs / Document expenses section */}
          <Card
            size="small"
            style={{ marginBottom: 16 }}
            title={
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {t('customs_expense.detail_section_title')}
              </span>
            }
            extra={
              canWriteExpense ? (
                <Button
                  size="small"
                  type="link"
                  icon={<PlusOutlined />}
                  onClick={() => setCustomsExpenseOpen(true)}
                >
                  {t('customs_expense.detail_add_expense')}
                </Button>
              ) : null
            }
          >
            {shipment.customs_expenses && shipment.customs_expenses.length > 0 ? (
              <>
                <Table<ICustomsExpense>
                  rowKey="id"
                  dataSource={shipment.customs_expenses}
                  size="small"
                  pagination={false}
                  columns={[
                    {
                      title: t('customs_expense.col_date'),
                      dataIndex: 'expense_date',
                      width: 110,
                      render: (v: string) => fmtDate(v),
                    },
                    {
                      title: t('customs_expense.col_category'),
                      dataIndex: 'category',
                      render: (_: unknown, row: ICustomsExpense) => (
                        <Tag color="blue">
                          {t(`customs_expense.category.${row.category}`, {
                            defaultValue: row.category_display,
                          })}
                        </Tag>
                      ),
                    },
                    {
                      title: t('customs_expense.col_amount'),
                      dataIndex: 'amount',
                      align: 'right',
                      render: (v: string) => (
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} TMT
                        </span>
                      ),
                    },
                    {
                      title: t('customs_expense.col_label'),
                      dataIndex: 'label_raw',
                      responsive: ['md'],
                      render: (_: unknown, row: ICustomsExpense) =>
                        row.label_raw ?? row.notes ?? (
                          <Typography.Text type="secondary">—</Typography.Text>
                        ),
                    },
                  ]}
                  footer={() => {
                    const total = (shipment.customs_expenses ?? []).reduce(
                      (sum, e) => sum + Number(e.amount),
                      0,
                    );
                    return (
                      <div style={{ textAlign: 'right', fontWeight: 700, padding: '4px 0' }}>
                        {t('customs_expense.total_label')}:{' '}
                        {total.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} TMT
                      </div>
                    );
                  }}
                />
              </>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {t('customs_expense.detail_no_expenses')}
              </Typography.Text>
            )}
          </Card>

          {/* Link to activity log */}
          <Flex justify="flex-end" style={{ marginBottom: 8 }}>
            <Link
              to={`/shipments/${shipment.id}/activity`}
              style={{ fontSize: 13, color: COLORS.textSecondary }}
            >
              {t('shipment.detail.activity_link')} →
            </Link>
          </Flex>
        </div>

        {/* Right rail: route timeline (hidden on mobile) */}
        {screens.md && (
          <div>
            <RouteTimelineRail shipment={shipment} />
            <Card title={`🔗 ${t('shipment_detail.links_card')}`} size="small">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: COLORS.textSecondary }}>Logo Tiger</span>
                  <Tag>{t('shipment_detail.link_not_sent')}</Tag>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: COLORS.textSecondary }}>Trip Management</span>
                  <span style={{ color: COLORS.textSecondary }}>—</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: COLORS.textSecondary }}>GPS Tracking</span>
                  <Tag>{t('shipment_detail.link_no_device')}</Tag>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Override varieties modal */}
      <Modal
        open={overrideOpen}
        title={t('variety.override_modal_title')}
        okText={t('variety.override_apply')}
        cancelText={t('variety.override_cancel')}
        confirmLoading={overrideMutation.isPending}
        onCancel={() => setOverrideOpen(false)}
        onOk={() => {
          overrideMutation.mutate(overrideIds, {
            onSuccess: () => setOverrideOpen(false),
          });
        }}
      >
        <VarietySelect
          mode="multiple"
          value={overrideIds}
          onChange={(ids) => setOverrideIds(ids)}
          style={{ width: '100%' }}
        />
      </Modal>

      {/* Add customs expense modal — pre-filled with this shipment */}
      <CustomsExpenseModal
        open={customsExpenseOpen}
        onClose={() => setCustomsExpenseOpen(false)}
        editTarget={null}
        prefilledShipmentId={shipment.id}
        prefilledExportCode={shipment.export_code}
      />
    </div>
  );
}
