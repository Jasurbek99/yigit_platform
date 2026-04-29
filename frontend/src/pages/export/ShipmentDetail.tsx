import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Button,
  Card,
  Checkbox,
  Divider,
  Flex,
  Grid,
  Modal,
  Skeleton,
  Alert,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useState } from 'react';
import type { TableColumnsType } from 'antd';
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusTag } from '@/components/StatusTag';
import { TransitionButton } from '@/components/TransitionButton';
import { CommentComposer } from '@/components/CommentComposer';
import { FreshnessPill } from '@/components/FreshnessPill';
import { VarietySelect } from '@/components/VarietySelect';
import { ShipmentEditDrawer } from '@/components/ShipmentEditDrawer';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useAuth } from '@/hooks/useAuth';
import { useOverrideVarieties } from '@/hooks/usePallets';
import { canDo, canEditField } from '@/utils/permissions';
import { EDIT_FIELD_GROUPS } from '@/constants/shipmentEditConfig';
import type { IEditFieldGroup } from '@/constants/shipmentEditConfig';
import api from '@/services/api';
import type {
  IFirmSplit,
  IStatusLogEntry,
  IShipmentComment,
  IShipmentQuality,
} from '@/types';
import { fmt, fmtDate, fmtNum, InfoRow, SectionBlock, SalesReportForm } from './ShipmentDetailHelpers';

const { Text, Title } = Typography;

const STATUS_STEPS = [
  { code: 'yuklenme' },
  { code: 'gumruk_girish' },
  { code: 'gumruk_chykysh' },
  { code: 'yola_chykdy' },
  { code: 'serhet_tm' },
  { code: 'serhet_gechdi' },
  { code: 'barysh_gumrugi' },
  { code: 'yolda' },
  { code: 'bardy' },
  { code: 'satylyar' },
  { code: 'satyldy' },
  { code: 'hasabat' },
  { code: 'tamamlandy' },
] as const;

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'overview';
  const screens = Grid.useBreakpoint();
  const { data: shipment, isLoading, isError } = useShipmentDetail(id);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const qualityMutation = useMutation({
    mutationFn: async ({ field, checked }: { field: keyof IShipmentQuality; checked: boolean }) => {
      await api.patch(`/export/shipments/${id}/quality/`, { [field]: checked });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shipment', id] });
    },
  });

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideIds, setOverrideIds] = useState<number[]>([]);
  const overrideMutation = useOverrideVarieties(Number(id));

  const [editGroupKey, setEditGroupKey] = useState<IEditFieldGroup['key'] | 'all' | null>(null);

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

  function canEditGroup(groupKey: IEditFieldGroup['key']): boolean {
    const group = EDIT_FIELD_GROUPS.find((g) => g.key === groupKey);
    if (!group) return false;
    return group.fields.some((f) => canEditField(user, 'shipment', f.key));
  }
  const canEditAny = EDIT_FIELD_GROUPS.some((g) => canEditGroup(g.key));

  function editButton(groupKey: IEditFieldGroup['key']) {
    if (!canEditGroup(groupKey)) return null;
    return (
      <Button
        size="small"
        type="text"
        icon={<EditOutlined />}
        onClick={() => setEditGroupKey(groupKey)}
      >
        {t('common.edit')}
      </Button>
    );
  }

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

  // ── Firm splits table ──────────────────────────────────────────────────────

  const firmSplitColumns: TableColumnsType<IFirmSplit> = [
    { title: t('shipment_detail.firm_splits_col_firm'), dataIndex: 'export_firm_name' },
    { title: t('shipment_detail.weight_net'), dataIndex: 'weight_kg', render: (_, record) => fmtNum(record.weight_kg) },
    { title: t('shipment_detail.total_usd'), dataIndex: 'amount_usd', render: (_, record) => fmtNum(record.amount_usd) },
    { title: t('shipment_detail.firm_splits_col_invoice'), dataIndex: 'invoice_number', render: (_, record) => record.invoice_number ?? '—' },
  ];

  // ── Firm display helper ────────────────────────────────────────────────────

  const firmDisplay =
    shipment.firm_splits.length === 0
      ? '—'
      : shipment.firm_splits.map((s) => s.export_firm_name ?? '—').join(' + ');

  const blockDisplay =
    shipment.block_sources.length === 0
      ? '—'
      : shipment.block_sources.map((b) => b.block_code).join(', ');

  // ── Status route sidebar ───────────────────────────────────────────────────

  const currentIdx = STATUS_STEPS.findIndex((s) => s.code === shipment.status_code);

  const statusRouteContent = (
    <div style={{ padding: '4px 0' }}>
      {STATUS_STEPS.map((step, idx) => {
        const state: 'done' | 'active' | 'pending' =
          idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending';
        const logEntry: IStatusLogEntry | null = shipment.status_log[idx] ?? null;
        const isLast = idx === STATUS_STEPS.length - 1;

        return (
          <div
            key={step.code}
            style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 20 }}
          >
            {/* Connector line */}
            {!isLast && (
              <div style={{
                position: 'absolute',
                left: 15,
                top: 32,
                bottom: 0,
                width: 2,
                background: state === 'done' ? '#52c41a' : '#f0f0f0',
              }} />
            )}
            {/* Dot */}
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              zIndex: 1,
              background: state === 'done' ? '#52c41a' : state === 'active' ? '#1677ff' : '#f5f5f5',
              color: state === 'pending' ? '#bfbfbf' : '#fff',
              border: state === 'pending' ? '2px solid #d9d9d9' : 'none',
            }}>
              {state === 'done' ? '✓' : state === 'active' ? '●' : idx + 1}
            </div>
            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: state === 'active' ? 600 : 500,
                fontSize: 13,
                color: state === 'pending' ? '#bfbfbf' : state === 'active' ? '#1677ff' : '#262626',
              }}>
                {t(`shipment_status.${step.code}`)}
              </div>
              {state !== 'pending' && logEntry && (
                <div style={{ fontSize: 11, color: '#8c8c8c', fontFamily: 'monospace' }}>
                  {fmt(logEntry.changed_at)}
                </div>
              )}
              {state !== 'pending' && logEntry?.comment && (
                <div style={{ fontSize: 11, color: '#595959', marginTop: 2 }}>
                  {logEntry.comment}
                </div>
              )}
              {state === 'active' && (
                <div style={{ fontSize: 11, color: '#8c8c8c' }}>{t('shipment_detail.status_now')}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── Tab items ──────────────────────────────────────────────────────────────

  const tabItems = [
    {
      key: 'overview',
      label: t('shipment_detail.tab_main'),
      children: (
        <div>
          {/* Section 1: Logistika */}
          <SectionBlock
            title={`📋 ${t('shipment_detail.section_logistics')}`}
            actions={editButton('logistics')}
          >
            <InfoRow label={t('shipment_detail.customer')} value={shipment.customer_name ?? '—'} />
            <InfoRow label={t('shipment_detail.firm_splits')} value={firmDisplay} />
            <InfoRow label={t('shipment_detail.import_firm')} value="—" />
            <InfoRow label={t('shipment_detail.country')} value={shipment.country_name ?? '—'} />
            <InfoRow label={t('shipment_detail.loading_point')} value="—" />
          </SectionBlock>

          {/* Section 2: Transport */}
          <SectionBlock
            title={`🚛 ${t('shipment_detail.section_transport')}`}
            actions={editButton('transport')}
          >
            <InfoRow label={t('shipment_detail.vehicle')} value="—" />
            <InfoRow label={t('shipment_detail.driver')} value="—" />
            <InfoRow label={t('shipment_detail.transport_firm')} value="—" />
            <InfoRow label={t('shipment_detail.border_point')} value="—" />
            <InfoRow label={t('shipment_detail.current_location')} value={shipment.vehicle_condition ?? '—'} />
          </SectionBlock>

          {/* Section 3: Haryt */}
          <SectionBlock
            title={`🌿 ${t('shipment_detail.section_goods')}`}
            actions={editButton('goods')}
          >
            <InfoRow label={t('shipment_detail.block_sources')} value={blockDisplay} />

            {/* Variety (R17) sub-section */}
            <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {t('variety.section_title')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Confidence badge */}
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
              {/* Dominant variety chips */}
              {shipment.varieties_dominant.length === 0 ? (
                <span style={{ fontSize: 12, color: '#8c8c8c' }}>{t('variety.empty_state')}</span>
              ) : (
                <Flex gap={4} wrap="wrap">
                  {shipment.varieties_dominant.map((v) => (
                    <Tag
                      key={v.id}
                      color={v.is_experimental ? 'orange' : undefined}
                      style={{ margin: 0 }}
                    >
                      {v.code ? `${v.code} · ` : ''}{v.name}
                      {v.is_experimental && <span style={{ marginLeft: 4, fontSize: 10 }}>(exp)</span>}
                    </Tag>
                  ))}
                </Flex>
              )}
            </div>

            <InfoRow label={t('shipment_detail.harvest_date')} value={fmtDate(shipment.date)} />
            <InfoRow label={t('shipment_detail.harvest_condition')} value="—" />
            <InfoRow
              label={t('shipment_detail.weight_official')}
              value={`${fmtNum(shipment.weight_net)} kg`}
              bold
              mono
            />
            <InfoRow
              label={t('shipment_detail.weight_actual')}
              value={`${fmtNum(shipment.weight_gross)} kg`}
              mono
            />
            <InfoRow
              label={t('shipment_detail.pallets')}
              value={shipment.pallet_count != null ? String(shipment.pallet_count) : '—'}
            />
          </SectionBlock>

          {/* Section 4: Hil */}
          <SectionBlock title={`🌡️ ${t('shipment_detail.section_quality_ctrl')}`}>
            <InfoRow label={t('shipment_detail.transit_days')} value="—" />
            <InfoRow label={t('shipment_detail.temperature')} value="— °C" />
          </SectionBlock>
        </div>
      ),
    },
    {
      key: 'document',
      label: t('shipment_detail.tab_document'),
      children: (
        <div>
          {/* Quality certificates */}
          <SectionBlock title={t('shipment_detail.section_certs')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {qualityFields.map((field) => (
                <Checkbox
                  key={field}
                  checked={q[field]}
                  disabled={!canEditQuality || qualityMutation.isPending}
                  onChange={(e) => qualityMutation.mutate({ field, checked: e.target.checked })}
                >
                  {t(`quality.${field}`)}
                </Checkbox>
              ))}
            </div>
          </SectionBlock>

          {/* Logistics timestamps */}
          <SectionBlock title={t('shipment_detail.section_timestamps')}>
            <InfoRow label={t('shipment_detail.loading_started')} value={fmt(shipment.loading_started_at)} />
            <InfoRow label={t('shipment_detail.customs_entry')} value={fmt(shipment.customs_entry_at)} />
            <InfoRow label={t('shipment_detail.customs_exit')} value={fmt(shipment.customs_exit_at)} />
            <InfoRow label={t('shipment_detail.border_crossed')} value={fmt(shipment.border_crossed_at)} />
            <InfoRow label={t('shipment_detail.arrived')} value={fmt(shipment.arrived_at)} />
            <InfoRow label={t('shipment_detail.sale_started')} value={fmt(shipment.sale_started_at)} />
            <InfoRow label={t('shipment_detail.sale_ended')} value={fmt(shipment.sale_ended_at)} />
          </SectionBlock>
        </div>
      ),
    },
    {
      key: 'finance',
      label: t('shipment_detail.tab_finance'),
      children: (
        <div>
          {/* Weight & price summary */}
          <SectionBlock title={t('shipment_detail.section_weight_price')}>
            <InfoRow label={t('shipment_detail.weight_net')} value={`${fmtNum(shipment.weight_net)} kg`} />
            <InfoRow label={t('shipment_detail.weight_gross')} value={`${fmtNum(shipment.weight_gross)} kg`} />
            <InfoRow label={t('shipment_detail.packaging')} value={`${fmtNum(shipment.packaging_kg)} kg`} />
            <InfoRow label={t('shipment_detail.boxes')} value={fmtNum(shipment.box_count)} />
            <InfoRow label={t('shipment_detail.pallets')} value={fmtNum(shipment.pallet_count)} />
            <InfoRow
              label={t('shipment_detail.price_per_kg')}
              value={shipment.price_per_kg != null ? `$${shipment.price_per_kg}` : '—'}
            />
            <InfoRow
              label={t('shipment_detail.total_usd')}
              value={shipment.total_amount_usd != null ? `$${fmtNum(shipment.total_amount_usd)}` : '—'}
            />
            <InfoRow label={t('shipment_detail.notes')} value={shipment.notes ?? '—'} />
          </SectionBlock>

          {/* Firm splits table */}
          {shipment.firm_splits.length > 0 && (
            <div style={{ marginBottom: 24 }}>
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

          {/* Sales report */}
          {!isReportAvailable ? (
            <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>
              {t('sales_report.only_at_hasabat')}
            </Text>
          ) : (
            <div>
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
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'changes',
      label: t('shipment_detail.tab_history', { count: shipment.status_log.length }),
      children: (
        <div>
          {/* Status history timeline */}
          <Timeline
            items={shipment.status_log.map((entry: IStatusLogEntry) => ({
              children: (
                <div>
                  <Flex gap={8} align="center" wrap="wrap">
                    <StatusTag statusDisplay={entry.status_display} />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {fmt(entry.changed_at)} — {t('shipment_detail.history_by', { name: entry.changed_by_name })}
                    </Text>
                  </Flex>
                  {entry.comment && (
                    <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                      {entry.comment}
                    </Text>
                  )}
                </div>
              ),
            }))}
          />

          <Divider />

          {/* Comments */}
          {shipment.comments.length === 0 ? (
            <Text type="secondary">{t('shipment_detail.no_comments')}</Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {shipment.comments.map((c: IShipmentComment) => (
                <div
                  key={c.id}
                  style={{
                    background: '#fafafa',
                    borderRadius: 6,
                    padding: '10px 14px',
                    border: '1px solid #f0f0f0',
                  }}
                >
                  <Flex gap={8} align="center" wrap="wrap">
                    <Text strong style={{ fontSize: 13 }}>{c.user_name}</Text>
                    <Tag style={{ margin: 0, fontSize: 11 }}>{c.role}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>{fmt(c.created_at)}</Text>
                  </Flex>
                  <div style={{ marginTop: 6, fontSize: 13 }}>{c.content}</div>
                </div>
              ))}
            </div>
          )}
          <CommentComposer shipmentId={shipment.id} />
        </div>
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Per-section / all-fields edit drawer */}
      <ShipmentEditDrawer
        open={editGroupKey !== null}
        onClose={() => setEditGroupKey(null)}
        shipment={shipment}
        groupKey={editGroupKey === 'all' ? undefined : editGroupKey ?? undefined}
      />

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

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 6 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
          <Text strong style={{ fontSize: 18, fontFamily: 'monospace' }}>
            {shipment.cargo_code}
          </Text>
          <StatusTag statusDisplay={shipment.status_display} />
          <FreshnessPill freshness={shipment.freshness} ageDays={shipment.harvest_age_days} />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button
              icon={<EditOutlined />}
              disabled={!canEditAny}
              onClick={() => setEditGroupKey('all')}
            >
              {t('common.edit')}
            </Button>
            {(user?.role === 'weight_master' || user?.role === 'warehouse_chief' || user?.role === 'export_manager' || user?.is_superuser) && (
              <Link to={`/shipments/${shipment.id}/manifest`}>
                <Button>{t('pallet.title')}</Button>
              </Link>
            )}
            {shipment.allowed_transitions?.length > 0 && (
              <TransitionButton
                shipmentId={shipment.id}
                allowedTransitions={shipment.allowed_transitions}
              />
            )}
          </div>
        </Flex>
        <div style={{ paddingLeft: 44, fontSize: 13, color: '#8c8c8c' }}>
          {shipment.customer_name} → {shipment.country_name}
          {shipment.route_note ? ` | ${shipment.route_note}` : ''}
        </div>
      </div>

      {/* 2-column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: screens.md ? '1fr 340px' : '1fr',
        gap: 20,
        alignItems: 'start',
      }}>
        {/* Left: main card with 4 tabs */}
        <Card>
          <Tabs
            items={tabItems}
            activeKey={activeTab}
            onChange={(k) => setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.set('tab', k);
              return next;
            }, { replace: true })}
          />
        </Card>

        {/* Right: sidebar */}
        <div>
          <Card title={`📍 ${t('shipment_detail.route_card')}`} size="small" style={{ marginBottom: 16 }}>
            {statusRouteContent}
          </Card>
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
      </div>
    </div>
  );
}
