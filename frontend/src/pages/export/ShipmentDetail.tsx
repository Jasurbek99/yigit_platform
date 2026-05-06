import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
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
import { VarietySelect } from '@/components/VarietySelect';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useOverrideVarieties } from '@/hooks/usePallets';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import api from '@/services/api';
import type { TableColumnsType } from 'antd';
import type {
  IFirmSplit,
  IShipmentQuality,
} from '@/types';
import { fmt, fmtDate, fmtNum, InfoRow, SectionBlock, SalesReportForm } from './ShipmentDetailHelpers';

const { Text, Title } = Typography;

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

  const qualityMutation = useMutation({
    mutationFn: async ({ field, checked }: { field: keyof IShipmentQuality; checked: boolean }) => {
      await api.patch(`/export/shipments/${id}/quality/`, { [field]: checked });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shipment', id] });
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
  const canEditSalesReport = canDo(user, 'shipment', 'edit');
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

  // ── Read-only collapsible sections ────────────────────────────────────────

  const collapseItems = [
    {
      key: 'logistics',
      label: `📋 ${t('shipment_detail.section_logistics')}`,
      children: (
        <div>
          <InfoRow label={t('shipment_detail.customer')} value={shipment.customer_name ?? '—'} />
          <InfoRow label={t('shipment_detail.firm_splits')} value={firmDisplay} />
          <InfoRow label={t('shipment_detail.import_firm')} value="—" />
          <InfoRow label={t('shipment_detail.country')} value={shipment.country_name ?? '—'} />
          <InfoRow label={t('shipment_detail.loading_point')} value="—" />
        </div>
      ),
    },
    {
      key: 'transport',
      label: `🚛 ${t('shipment_detail.section_transport')}`,
      children: (
        <div>
          <InfoRow label={t('shipment_detail.vehicle')} value="—" />
          <InfoRow label={t('shipment_detail.driver')} value="—" />
          <InfoRow label={t('shipment_detail.transport_firm')} value="—" />
          <InfoRow label={t('shipment_detail.border_point')} value="—" />
          <InfoRow label={t('shipment_detail.current_location')} value={shipment.vehicle_condition ?? '—'} />
        </div>
      ),
    },
    {
      key: 'goods',
      label: `🌿 ${t('shipment_detail.section_goods')}`,
      children: (
        <div>
          <InfoRow label={t('shipment_detail.block_sources')} value={blockDisplay} />

          {/* Variety sub-section (R17) */}
          <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {t('variety.section_title')}
              </div>
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
          <InfoRow label={t('shipment_detail.weight_official')} value={`${fmtNum(shipment.weight_net)} kg`} bold mono />
          <InfoRow label={t('shipment_detail.weight_actual')} value={`${fmtNum(shipment.weight_gross)} kg`} mono />
          <InfoRow label={t('shipment_detail.pallets')} value={shipment.pallet_count != null ? String(shipment.pallet_count) : '—'} />
        </div>
      ),
    },
    {
      key: 'documents',
      label: `📄 ${t('shipment_detail.tab_document')}`,
      children: (
        <div>
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
      label: `💰 ${t('shipment_detail.tab_finance')}`,
      children: (
        <div>
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

          {isReportAvailable ? (
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
          ) : (
            <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>
              {t('sales_report.only_at_hasabat')}
            </Text>
          )}
        </div>
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Hero bar */}
      <ShipmentDetailHero shipment={shipment} />

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

          {/* Other roles' tasks */}
          <OtherTasksRow tasks={shipment.other_tasks} />

          {/* Read-only collapsibles for legacy detail info */}
          <Card style={{ marginBottom: 16 }}>
            <Collapse
              ghost
              items={collapseItems}
              defaultActiveKey={[]}
              style={{ padding: 0 }}
            />
          </Card>

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
