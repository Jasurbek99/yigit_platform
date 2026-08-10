import { Modal, Button, Alert, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSeasonClosePreview, useCloseSeason } from '@/hooks/useAdmin';
import type { ISeason } from '@/types';

interface ISeasonCloseModalProps {
  season: ISeason | null;
  onClose: () => void;
}

/**
 * Close-season confirm dialog. Fetches `close-preview` counts for `season`
 * and renders them into the body copy — per D2 the close itself is never
 * blocked on this data, but the confirm button IS disabled while the counts
 * are loading or failed to load, so an admin can never confirm against a
 * blank/stale mitigation message (the copy is the only thing standing
 * between them and unfinished work vanishing from every board at once).
 */
export function SeasonCloseModal({ season, onClose }: ISeasonCloseModalProps): JSX.Element {
  const { t } = useTranslation();
  const { data: preview, isLoading, isError, refetch } = useSeasonClosePreview(season?.id ?? null);

  const closeMutation = useCloseSeason({
    onSuccess: () => {
      toast.success(t('seasons.toast_closed'));
      onClose();
    },
    onError: () => toast.error(t('seasons.toast_error')),
  });

  function handleConfirm(): void {
    if (!season) return;
    closeMutation.mutate(season.id);
  }

  return (
    <Modal
      open={season !== null}
      onCancel={onClose}
      title={season ? t('seasons.close_confirm_title', { name: season.name }) : ''}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button
          key="confirm"
          danger
          type="primary"
          loading={closeMutation.isPending}
          disabled={isLoading || isError}
          onClick={handleConfirm}
        >
          {t('seasons.close_button')}
        </Button>,
      ]}
    >
      {isLoading && <Spin />}
      {isError && (
        <Alert
          type="error"
          showIcon
          message={t('seasons.close_preview_error')}
          action={
            <Button size="small" onClick={() => refetch()}>
              {t('seasons.retry')}
            </Button>
          }
        />
      )}
      {preview && season && (
        <p>
          {t('seasons.close_confirm_body', {
            name: season.name,
            drafts: preview.drafts,
            in_transit: preview.in_transit,
            open_tasks: preview.open_tasks,
            unfinished_plans: preview.unfinished_plans,
          })}
        </p>
      )}
      {/*
        Separate from the body copy on purpose: that paragraph promises
        "nothing is deleted, everything comes back read-only", which is true of
        its four counters and NOT true of these rows — a draft quota-usage row
        can never be approved once the season freezes. Rendered only when there
        is something to act on, so the dialog stays quiet in the normal case.
      */}
      {preview && season && preview.draft_quota_usage > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t('seasons.close_confirm_quota_warning', {
            name: season.name,
            quota_drafts: preview.draft_quota_usage,
          })}
        />
      )}
    </Modal>
  );
}
