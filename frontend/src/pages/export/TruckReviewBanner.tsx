import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAcknowledgeTask, useTruckAllocationReview } from '@/hooks/usePlanAck';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface ITruckReviewBannerProps {
  readonly year?: number;
  readonly week?: number;
}

/**
 * «Tanyşdym» banner for the export manager (docs/Tasks.md item 2b): the
 * greenhouse plan changed how many trucks a day needs after the allocation was
 * done. Shown only while an alloc_review task is open for the week.
 */
export function TruckReviewBanner({ year, week }: ITruckReviewBannerProps) {
  const { t } = useTranslation();
  const { data } = useTruckAllocationReview(year, week);
  const ack = useAcknowledgeTask();

  if (!data || data.open_task_id == null) return null;
  const taskId = data.open_task_id;

  const changes = data.changes
    .map((c) => `${t(`weekday.${WEEKDAY_KEYS[c.day_of_week - 1]}`)}: ${c.was} → ${c.now}`)
    .join(', ');

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 12 }}
      message={t('plan.review_title')}
      description={changes}
      action={data.can_acknowledge ? (
        <Button
          size="small"
          type="primary"
          loading={ack.isPending}
          onClick={() => ack.mutate({ taskId, snapshot: data.snapshot })}
        >
          {t('tasks.acknowledge')}
        </Button>
      ) : undefined}
    />
  );
}
