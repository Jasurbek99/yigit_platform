import { Tag } from 'antd';

const STATUS_COLORS: Record<string, string> = {
  Loading: 'blue',
  'Customs Entry': 'orange',
  'Customs Exit': 'orange',
  Departed: 'blue',
  'TM Border': 'geekblue',
  'Border Crossed': 'geekblue',
  'Dest Customs': 'purple',
  'In Transit': 'cyan',
  Arrived: 'green',
  'Being Sold': 'lime',
  Sold: 'green',
  Report: 'gold',
  Completed: 'default',
};

export interface IStatusTagProps {
  statusDisplay: string;
}

export function StatusTag({ statusDisplay }: IStatusTagProps) {
  return (
    <Tag color={STATUS_COLORS[statusDisplay] ?? 'default'} style={{ margin: 0 }}>
      {statusDisplay}
    </Tag>
  );
}
