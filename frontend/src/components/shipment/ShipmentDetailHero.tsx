import { Button, Flex, Tag } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusTag } from '@/components/StatusTag';
import { FreshnessPill } from '@/components/FreshnessPill';
import { TransitionButton } from '@/components/TransitionButton';
import { useAuth } from '@/hooks/useAuth';
import type { IShipmentDetail } from '@/types';

interface IShipmentDetailHeroProps {
  shipment: IShipmentDetail;
}

/**
 * Top bar for the new single-column ShipmentDetail layout.
 * Shows cargo code, status pill, phase tag, optional idle warning,
 * origin → destination route line, and a manifest button.
 */
export function ShipmentDetailHero({ shipment }: IShipmentDetailHeroProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const isIdle =
    shipment.phase_avg_seconds != null &&
    shipment.in_phase_seconds > shipment.phase_avg_seconds * 1.5;

  const canSeeManifest =
    user?.role === 'weight_master' ||
    user?.role === 'warehouse_chief' ||
    user?.role === 'export_manager' ||
    user?.is_superuser === true;

  return (
    <div style={{ marginBottom: 20 }}>
      <Flex align="center" gap={12} wrap="wrap" style={{ marginBottom: 6 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
        <span style={{ fontSize: 18, fontWeight: 600, fontFamily: 'monospace' }}>
          {shipment.cargo_code}
        </span>
        <StatusTag statusDisplay={shipment.status_display} />

        {/* Phase tag */}
        <Tag color="blue">{t(`phase.${shipment.phase.toLowerCase()}`)}</Tag>

        {/* Idle warning */}
        {isIdle && (
          <Tag color="red">{t('shipment.detail.idle_warning')}</Tag>
        )}

        <FreshnessPill freshness={shipment.freshness} ageDays={shipment.harvest_age_days} />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {canSeeManifest && (
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

      {/* Route subtitle */}
      <div style={{ paddingLeft: 44, fontSize: 13, color: '#8c8c8c' }}>
        {shipment.customer_name ?? '—'} → {shipment.country_name ?? '—'}
      </div>
    </div>
  );
}
