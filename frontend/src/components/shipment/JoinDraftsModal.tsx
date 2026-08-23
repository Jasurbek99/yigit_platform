import { Modal, Spin, Typography, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { useJoinShipments } from '@/hooks/useDrafts';
import { detectJoinDirection, explainJoinBlockers } from '@/components/sheet/joinHelpers';
import { FONT } from '@/constants/styles';

interface IJoinDraftsModalProps {
  readonly open: boolean;
  readonly draftIds: readonly [number, number];
  readonly onClose: () => void;
  readonly onSuccess?: () => void;
}

/** Merge two selected drafts: auto-detects which is the destination (kept) vs the supply (deleted). */
export function JoinDraftsModal({ open, draftIds, onClose, onSuccess }: IJoinDraftsModalProps) {
  const { t } = useTranslation();
  const [idA, idB] = draftIds;
  // Two FIXED hook calls (never in a loop — Rules of Hooks). Gated on `open` so
  // no detail fetch fires until the modal is actually shown.
  const a = useShipmentDetail(open ? idA : undefined);
  const b = useShipmentDetail(open ? idB : undefined);
  const joinMutation = useJoinShipments();

  const loading = a.isLoading || b.isLoading;
  const fetchError = a.isError || b.isError;
  const direction = a.data != null && b.data != null ? detectJoinDirection(a.data, b.data) : null;
  const resolved = direction != null && 'target' in direction ? direction : null;

  function handleJoin() {
    if (resolved == null) return;
    joinMutation.mutate(
      { targetId: resolved.target.id, sourceId: resolved.source.id },
      {
        onSuccess: () => {
          toast.success(t('join_drafts.toast_success'));
          onSuccess?.();
          onClose();
        },
        onError: (err) => {
          const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
          toast.error(msg ?? t('join_drafts.toast_error'));
        },
      },
    );
  }

  return (
    <Modal
      title={t('join_drafts.title')}
      open={open}
      onCancel={onClose}
      onOk={handleJoin}
      okText={t('join_drafts.confirm')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: resolved == null }}
      confirmLoading={joinMutation.isPending}
      destroyOnHidden
    >
      {loading ? (
        <Spin style={{ display: 'block', margin: '24px auto' }} />
      ) : fetchError ? (
        <Alert type="error" showIcon message={t('join_drafts.fetch_error')} />
      ) : resolved == null ? (
        <Alert
          type="warning"
          showIcon
          message={t('join_drafts.ambiguous')}
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {explainJoinBlockers(
                [a.data, b.data].filter((d): d is NonNullable<typeof d> => d != null),
              ).map((bl) => (
                <li key={`${bl.key}:${bl.code ?? ''}`}>
                  {t(`join_blockers.${bl.key}`, { code: bl.code })}
                </li>
              ))}
            </ul>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Typography.Text type="secondary">{t('join_drafts.destination_label')}</Typography.Text>
            <div>
              <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
                {resolved.target.shipment_code}
              </Typography.Text>
              <span style={{ marginLeft: 8, color: '#475467', fontSize: 12 }}>
                {resolved.target.country_name ?? '—'} · {resolved.target.customer_name ?? '—'}
              </span>
            </div>
          </div>
          <div>
            <Typography.Text type="secondary">{t('join_drafts.supply_label')}</Typography.Text>
            <div>
              <Typography.Text style={{ fontFamily: FONT.mono, fontWeight: 600 }}>
                {resolved.source.shipment_code}
              </Typography.Text>
              <span style={{ marginLeft: 8, color: '#475467', fontSize: 12 }}>
                {resolved.source.block_sources.map((bs) => bs.block_code).join(', ')}
                {resolved.source.weight_net != null &&
                  ` · ${Number(resolved.source.weight_net).toLocaleString('ru-RU')} kg`}
              </span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
