import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { FeedbackStatus } from '@/types';

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  new: 'blue',
  in_review: 'gold',
  resolved: 'green',
  rejected: 'default',
};

interface ITicketStatusTagProps {
  status: FeedbackStatus;
}

export function TicketStatusTag({ status }: ITicketStatusTagProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Tag color={STATUS_COLORS[status]}>
      {t(`feedback.status.${status}`)}
    </Tag>
  );
}
