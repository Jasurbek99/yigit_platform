import { useState } from 'react';
import { Badge, Button, Flex, Input, Modal, Tag } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  MessageOutlined,
  RocketOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { StatusTag } from '@/components/StatusTag';
import { FreshnessPill } from '@/components/FreshnessPill';
import { TransitionButton } from '@/components/TransitionButton';
import { JoinSupplyModal } from '@/components/shipment/JoinSupplyModal';
import { isDestinationDraft, canUserJoin } from '@/components/sheet/joinHelpers';
import { useAuth } from '@/hooks/useAuth';
import { usePromoteFromDraft } from '@/hooks/useDrafts';
import { useCancelShipment, useHardDeleteDraftShipment } from '@/hooks/useShipments';
import { extractPatchError } from '@/hooks/useShipmentPatch';
import { canDo } from '@/utils/permissions';
import { useSeasonReadOnly } from '@/hooks/useSeasonReadOnly';
import type { IShipmentDetail } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

interface IShipmentDetailHeroProps {
  shipment: IShipmentDetail;
  /** Opens the whole-shipment comments thread (the discussion drawer). */
  onOpenComments: (fieldKey: string | null) => void;
}

/**
 * Top bar for the new single-column ShipmentDetail layout.
 * Shows shipment code, status pill, phase tag, optional idle warning,
 * origin → destination route line, and a manifest button.
 */
export function ShipmentDetailHero({ shipment, onOpenComments }: IShipmentDetailHeroProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isReadOnly = useSeasonReadOnly();

  // Cancel modal state
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelMutation = useCancelShipment();

  const isIdle =
    shipment.phase_avg_seconds != null &&
    shipment.in_phase_seconds > shipment.phase_avg_seconds * 1.5;

  // Mirrors backend PALLET_WRITE_ROLES (views.py) so everyone who can fill the
  // manifest can reach it: weight_master, loading dept head/deputy, warehouse_chief,
  // export_manager, director (+ any superuser).
  const MANIFEST_ROLES: ReadonlyArray<string> = [
    'weight_master',
    'loading_dept_head',
    'loading_dept_head_deputy',
    'warehouse_chief',
    'export_manager',
    'director',
  ];
  const canSeeManifest =
    (user?.role != null && MANIFEST_ROLES.includes(user.role)) ||
    user?.is_superuser === true;

  // Cancel shipment: admin / export_manager / director (or any superuser),
  // and only when the shipment is not already cancelled or fully completed.
  const CANCEL_ROLES: ReadonlyArray<string> = ['admin', 'export_manager', 'director'];
  const canCancel =
    !!user &&
    (CANCEL_ROLES.includes(user.role) || user.is_superuser === true) &&
    shipment.status_code !== 'cancelled' &&
    shipment.status_code !== 'tamamlandy' &&
    !isReadOnly;

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
  //
  // `boss` added 2026-09-01 (F20): the endpoint was widened to him on
  // 2026-08-05 — "assigning a draft is a genuine process step, so its only
  // action must work" — but this literal was never updated, so the API accepted
  // him while this screen hid the button. The Assignment Board offered it to him
  // all along: one action, two screens, opposite answers. Mirrors the backend
  // list (`PRIVILEGED_ROLES | {'boss'}` in export/views.py) and deliberately does
  // NOT route through canDo/bossEditMode, exactly like canJoinSupply below.
  const canPromote =
    shipment.can_promote_from_draft &&
    (user?.role === 'export_manager' ||
      user?.role === 'director' ||
      user?.role === 'admin' ||
      user?.role === 'boss' ||
      user?.is_superuser === true) &&
    !isReadOnly;

  const promote = usePromoteFromDraft();

  // Join supply: only on a destination draft (has destination, no blocks yet).
  // Role gate comes from the shared canUserJoin() so the Sheet, the list bulk
  // bar and this hero can never drift apart again.
  const canJoinSupply = isDestinationDraft(shipment) && canUserJoin(user) && !isReadOnly;

  const [joinOpen, setJoinOpen] = useState(false);

  // Moving a truck through the state machine is the most consequential action
  // on this screen. Gate it on the same check ShipmentDetail uses for field
  // edits, so the boss's view/edit toggle covers it — without this he can drive
  // the whole lifecycle while the header reads "Просмотр".
  const canTransition = canDo(user, 'shipment', 'edit');

  // Admin-only permanent delete of a DRAFT scratch row. Distinct from cancel
  // (lifecycle) and soft-delete (restorable trash). The backend enforces both
  // the admin gate and the draft-only rule; this just hides the button.
  const hardDelete = useHardDeleteDraftShipment();
  const canHardDeleteDraft =
    shipment.status_code === 'draft' &&
    (user?.role === 'admin' || user?.is_superuser === true) &&
    !isReadOnly;

  function handleHardDelete() {
    Modal.confirm({
      title: t('shipment.detail.hard_delete_confirm_title', {
        code: shipment.shipment_code,
      }),
      icon: <ExclamationCircleFilled style={{ color: '#ff4d4f' }} />,
      content: t('shipment.detail.hard_delete_confirm_content'),
      okText: t('shipment.detail.hard_delete_confirm_ok'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      async onOk() {
        try {
          await hardDelete.mutateAsync({ id: shipment.id });
          toast.success(t('shipment.detail.hard_delete_success'));
          navigate('/export/shipments');
        } catch (err) {
          toast.error(extractPatchError(err, t('shipment.detail.hard_delete_error')));
        }
      },
    });
  }

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
            Top line (large): Shipment Code (export_code) — the
            human-meaningful pallet tag with block + variety. Falls back to "—".
            Bottom line (small): Export Code (shipment_code) — the platform
            tracker, always present. */}
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontSize: 18, fontWeight: 600, fontFamily: FONT.mono }}>
            {shipment.export_code || '—'}
          </span>
          <span style={{ fontSize: 11, fontFamily: FONT.mono, color: COLORS.textSecondary }}>
            {t('shipment.detail.export_code_label')}: {shipment.shipment_code}
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
          <Badge count={shipment.comment_count ?? 0} size="small">
            <Button icon={<MessageOutlined />} onClick={() => onOpenComments(null)}>
              {t('shipment.detail.discussion')}
            </Button>
          </Badge>
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
          {canJoinSupply && (
            <Button onClick={() => setJoinOpen(true)}>{t('join_supply.open_button')}</Button>
          )}
          {canTransition && shipment.allowed_transitions?.length > 0 && (
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
          {canHardDeleteDraft && (
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={hardDelete.isPending}
              onClick={handleHardDelete}
            >
              {t('shipment.detail.hard_delete_button')}
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

      {/* Join supply modal — only mounted for callers who can actually see the
          button. JoinSupplyModal's useDrafts() call sits above its `open` check,
          so mounting it unconditionally would fire the drafts list query for
          every role viewing every shipment, not just when the modal opens. */}
      {canJoinSupply && (
        <JoinSupplyModal open={joinOpen} targetId={shipment.id} onClose={() => setJoinOpen(false)} />
      )}
    </div>
  );
}
