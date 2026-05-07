import { Button, Flex, Modal, Tag } from 'antd';
import { ArrowLeftOutlined, RocketOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { StatusTag } from '@/components/StatusTag';
import { FreshnessPill } from '@/components/FreshnessPill';
import { TransitionButton } from '@/components/TransitionButton';
import { useAuth } from '@/hooks/useAuth';
import { usePromoteFromDraft } from '@/hooks/useDrafts';
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

  // Stream F — only privileged roles can promote a draft. The backend's
  // /assign/ endpoint enforces this server-side; gating client-side just
  // hides the button entirely for unauthorised users.
  const canPromote =
    shipment.can_promote_from_draft &&
    (user?.role === 'export_manager' ||
      user?.role === 'director' ||
      user?.role === 'admin' ||
      user?.is_superuser === true);

  const promote = usePromoteFromDraft();

  function handlePromote() {
    Modal.confirm({
      title: t('shipment.detail.promote_confirm_title'),
      content: t('shipment.detail.promote_confirm_body'),
      okText: t('shipment.detail.promote_button'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await promote.mutateAsync({ shipmentId: shipment.id });
          toast.success(t('shipment.detail.promote_toast_success'));
        } catch {
          toast.error(t('shipment.detail.promote_toast_error'));
        }
      },
    });
  }

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
          {canPromote && (
            <Button
              type="primary"
              icon={<RocketOutlined />}
              loading={promote.isPending}
              onClick={handlePromote}
            >
              {t('shipment.detail.promote_button')}
            </Button>
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
