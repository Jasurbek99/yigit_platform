import { Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { TicketStatusTag } from '@/components/feedback/TicketStatusTag';
import type { IFeedbackTicket } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface ITicketCardProps {
  ticket: IFeedbackTicket;
  isSelected: boolean;
  onClick: () => void;
}

export function TicketCard({ ticket, isSelected, onClick }: ITicketCardProps): React.ReactElement {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        cursor: 'pointer',
        borderRadius: 6,
        background: isSelected ? COLORS.bgBlue : COLORS.white,
        borderLeft: isSelected ? '3px solid #1677ff' : '3px solid transparent',
        borderBottom: '1px solid #f0f0f0',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text
          strong
          style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {ticket.description}
        </Text>
        <TicketStatusTag status={ticket.status} />
      </div>
      <div style={{ marginTop: 4 }}>
        <Space size={4}>
          <Tag style={{ fontSize: 11, padding: '0 4px' }}>{ticket.category_display}</Tag>
          <Text type="secondary" style={{ fontSize: 11 }}>{ticket.author_name}</Text>
        </Space>
      </div>
      <Text type="secondary" style={{ fontSize: 11 }}>
        {dayjs(ticket.last_activity_at).format('DD.MM.YYYY HH:mm')}
      </Text>
    </div>
  );
}
