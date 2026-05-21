import { useState } from 'react';
import { Button, Flex, Input, Modal, Tag } from 'antd';
import { ArrowLeftOutlined, RocketOutlined, StopOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { StatusTag } from '@/components/StatusTag';
import { FreshnessPill } from '@/components/FreshnessPill';
import { TransitionButton } from '@/components/TransitionButton';
import { useAuth } from '@/hooks/useAuth';
import { usePromoteFromDraft } from '@/hooks/useDrafts';
import { useCancelShipment } from '@/hooks/useShipments';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import type { IShipmentDetail } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

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

  // Cancel modal state
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelMutation = useCancelShipment();

  const isIdle =
    shipment.phase_avg_seconds != null &&
    shipment.in_phase_seconds > shipment.phase_avg_seconds * 1.5;

  const canSeeManifest =
    user?.role === 'weight_master' ||
    user?.role === 'warehouse_chief' ||
    user?.role === 'export_manager' ||
    user?.is_superuser === true;

  // Cancel shipment: admin / export_manager / director (or any superuser),
  // and only when the shipment is not already cancelled or fully completed.
  const CANCEL_ROLES: ReadonlyArray<string> = ['admin', 'export_manager', 'director'];
  const canCancel =
    !!user &&
    (CANCEL_ROLES.includes(user.role) || user.is_superuser === true) &&
    shipment.status_code !== 'cancelled' &&
    shipment.status_code !== 'tamamlandy';

  function handleCancelOpen() {
    setCancelReason('');
    setCancelModalOpen(true);
  }

  async function handleCancelConfirm() {
    const trimmedReason = cancelReason.trim();
    if (!trimmedReason) return;
    try {
      const result = await cancelMutation.mutateAsync({ id: shipment.id, reason: trimmedReason });
      setCancelModalOpen(false);
      setCancelReason('');
      if (result.approved_quota_to_reconcile.length > 0) {
        toast.warning(
          t('shipment.cancel_quota_reconcile_toast', {
            count: result.approved_quota_to_reconcile.length,
          }),
        );
      } else {
        toast.success(t('shipment.cancel_success_toast'));
      }
    } catch (err) {
      toast.error(extractPatchError(err, t('shipment.cancel_error_toast')));
    }
  }

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
        {/* Stream G: stacked dual-code display.
            Top line (large): Shipment Code (official_export_code) — the
            human-meaningful pallet tag with block + variety. Falls back to "—".
            Bottom line (small): Export Code (cargo_code) — the platform
            tracker, always present. */}
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontSize: 18, fontWeight: 600, fontFamily: FONT.mono }}>
            {shipment.official_export_code || '—'}
          </span>
          <span style={{ fontSize: 11, fontFamily: FONT.mono, color: COLORS.textSecondary }}>
            {t('shipment.detail.export_code_label')}: {shipment.cargo_code}
          </span>
        </div>
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
          {canCancel && (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={handleCancelOpen}
            >
              {t('shipment.cancel_button')}
            </Button>
          )}
        </div>
      </Flex>

      {/* Route subtitle */}
      <div style={{ paddingLeft: 44, fontSize: 13, color: COLORS.textSecondary }}>
        {shipment.customer_name ?? '—'} → {shipment.country_name ?? '—'}
      </div>

      {/* Cancel confirmation modal */}
      <Modal
        open={cancelModalOpen}
        title={t('shipment.cancel_modal_title')}
        onCancel={() => setCancelModalOpen(false)}
        onOk={handleCancelConfirm}
        okText={t('shipment.cancel_modal_confirm')}
        cancelText={t('shipment.cancel_modal_cancel')}
        okButtonProps={{
          danger: true,
          disabled: cancelReason.trim().length === 0,
          loading: cancelMutation.isPending,
        }}
        destroyOnClose
      >
        <div style={{ marginBottom: 8, fontWeight: 500 }}>
          {t('shipment.cancel_modal_reason_label')}
        </div>
        <Input.TextArea
          autoFocus
          rows={3}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          placeholder={t('shipment.cancel_modal_reason_placeholder')}
          maxLength={500}
          showCount
        />
      </Modal>
    </div>
  );
}
