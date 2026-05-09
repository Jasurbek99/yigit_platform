import { useCallback, useRef, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShipmentDetailHero } from '@/components/shipment/ShipmentDetailHero';
import { MyTaskCard } from '@/components/shipment/MyTaskCard';
import { PhaseContextStrip } from '@/components/shipment/PhaseContextStrip';
import { OtherTasksRow } from '@/components/shipment/OtherTasksRow';
import { RouteTimelineRail } from '@/components/shipment/RouteTimelineRail';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { VarietySelect } from '@/components/VarietySelect';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useOverrideVarieties } from '@/hooks/usePallets';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { isSupervisor } from '@/utils/detailSections';
import { EDIT_FIELD_GROUPS, type IEditFieldGroup } from '@/constants/shipmentEditConfig';
import api from '@/services/api';
import type { TableColumnsType } from 'antd';
import type {
  IFirmSplit,
  IShipmentQuality,
  ITaskListItem,
} from '@/types';
import { fmt, fmtDate, fmtNum, InfoRow, SectionBlock, SalesReportForm } from './ShipmentDetailHelpers';

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
  const overrideMutation = useOverrideVarieties(Number(id));

  // Imperative scroll-to handle for OtherTasksRow → field navigation.
  const detailRootRef = useRef<HTMLDivElement>(null);

  const qualityMutation = useMutation({
    mutationFn: async ({ field, checked }: { field: keyof IShipmentQuality; checked: boolean }) => {
      await api.patch(`/export/shipments/${id}/quality/`, { [field]: checked });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shipment', id] });
    },
  });

  // Task-row click handler. All fields are always visible now, so this is just
  // a scroll + focus. Wrapped in useCallback so OtherTasksRow's memoized rows
  // don't churn.
  const handleTaskClick = useCallback((task: ITaskListItem) => {
    const targets = task.target_fields_list ?? [];
    if (targets.length === 0) return;
    const firstField = targets[0];
    const el = detailRootRef.current?.querySelector<HTMLElement>(
      `#detail-field-${CSS.escape(firstField)}`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = el.querySelector<HTMLElement>('input, textarea, .ant-select-selector');
    setTimeout(() => input?.focus(), 350);
  }, []);

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
  const canEditSalesReport = canDo(user, 'shipment', 'edit');
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

  const isReportAvailable =
    shipment.status_code === 'hasabat' || shipment.status_code === 'tamamlandy';

  const firmDisplay =
    shipment.firm_splits.length === 0
      ? '—'
      : shipment.firm_splits.map((s) => s.export_firm_name ?? '—').join(' + ');

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

  const logisticsPanel = (
    <Card size="small" styles={{ body: { padding: 16 } }}>
      <SectionBlock title={`📋 ${t('shipment_detail.section_logistics')}`}>
        {renderEditableGroup(groupByKey('logistics'))}
        <InfoRow label={t('shipment_detail.firm_splits')} value={firmDisplay} />
        <InfoRow label={t('shipment_detail.customer')} value={shipment.customer_name ?? '—'} />
      </SectionBlock>
    </Card>
  );

  const transportPanel = (
    <Card size="small" styles={{ body: { padding: 16 } }}>
      <SectionBlock title={`🚛 ${t('shipment_detail.section_transport')}`}>
        {renderEditableGroup(groupByKey('transport'))}
      </SectionBlock>
    </Card>
  );

  const goodsPanel = (
    <Card size="small" styles={{ body: { padding: 16 } }}>
      <SectionBlock title={`🌿 ${t('shipment_detail.section_goods')}`}>
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
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('variety.empty_state')}</span>
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
      </SectionBlock>
    </Card>
  );

  const documentsPanel = (
    <Card size="small" styles={{ body: { padding: 16 } }}>
      <SectionBlock title={`📄 ${t('shipment_detail.tab_document')}`}>
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
      </SectionBlock>
    </Card>
  );

  const financePanel = (
    <Card size="small" styles={{ body: { padding: 16 } }}>
      <SectionBlock title={`💰 ${t('shipment_detail.tab_finance')}`}>
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
              {!shipment.sales_report && (
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  {t('sales_report.empty')}
                </Text>
              )}
              {canEditSalesReport && (
                <SalesReportForm
                  shipmentId={String(shipment.id)}
                  report={shipment.sales_report}
                  canEdit={canEditSalesReport}
                />
              )}
            </>
          ) : (
            <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>
              {t('sales_report.only_at_hasabat')}
            </Text>
          )}
        </div>
      </SectionBlock>
    </Card>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const showSupervisorHint = isSupervisor(user) && shipment.my_task == null;

  return (
    <div ref={detailRootRef}>
      {/* Hero bar */}
      <ShipmentDetailHero shipment={shipment} />

      {/* Supervisor view hint — Stream I Case 4. Quiet single-line text, not a
          banner. Only shown to supervisors when they have no personal task on
          this shipment (otherwise the personal task takes priority). */}
      {showSupervisorHint && (
        <div style={{ marginBottom: 12, paddingLeft: 44, fontSize: 12, color: '#8c8c8c', fontStyle: 'italic' }}>
          {t('shipment.detail.supervisor_view')}
        </div>
      )}

      {/* 2-column grid: main column left, timeline rail right on ≥md */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: screens.md ? '1fr 340px' : '1fr',
          gap: 20,
          alignItems: 'start',
        }}
      >
        {/* Left: task-centric main column */}
        <div>
          {/* My task card */}
          <MyTaskCard shipment={shipment} />

          {/* Phase context strip */}
          <PhaseContextStrip shipment={shipment} />

          {/* Other roles' tasks — clickable rows scroll the main column to
              the task's first target field and focus it. */}
          <OtherTasksRow tasks={shipment.other_tasks} onTaskClick={handleTaskClick} />

          {/* Flat field grid: 2 columns on ≥md (Logistics + Transport,
              Goods + Documents), single column on mobile. Finance spans
              full width below — it carries the firm-splits table and
              sales-report form. No accordion, no toggling: every field is
              visible in one scroll. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: screens.md ? '1fr 1fr' : '1fr',
              gap: 16,
              marginBottom: 16,
            }}
          >
            {logisticsPanel}
            {transportPanel}
            {goodsPanel}
            {documentsPanel}
          </div>

          <div style={{ marginBottom: 16 }}>{financePanel}</div>

          {/* Link to activity log */}
          <Flex justify="flex-end" style={{ marginBottom: 8 }}>
            <Link to={`/shipments/${shipment.id}/activity`}>
              <Tag color="default" style={{ cursor: 'pointer', fontSize: 13, padding: '4px 10px' }}>
                {t('shipment.detail.activity_link')} →
              </Tag>
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
                  <span style={{ color: '#8c8c8c' }}>Logo Tiger</span>
                  <Tag>{t('shipment_detail.link_not_sent')}</Tag>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#8c8c8c' }}>Trip Management</span>
                  <span style={{ color: '#8c8c8c' }}>—</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#8c8c8c' }}>GPS Tracking</span>
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
    </div>
  );
}
