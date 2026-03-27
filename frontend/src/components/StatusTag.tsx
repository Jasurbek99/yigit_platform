import { Tag } from 'antd';

const STATUS_PHASE_COLOR: Record<string, string> = {
  Loading: 'processing',
  'Customs Entry': 'orange',
  'Customs Exit': 'orange',
  Departed: 'blue',
  'TM Border': 'geekblue',
  'Border Crossed': 'geekblue',
  'Dest Customs': 'purple',
  'In Transit': 'cyan',
  Arrived: 'green',
  'Being Sold': 'lime',
  Sold: 'success',
  Report: 'gold',
  Completed: 'default',
};

export interface IStatusTagProps {
  statusDisplay: string;
}

export function StatusTag({ statusDisplay }: IStatusTagProps) {
  const color = STATUS_PHASE_COLOR[statusDisplay] ?? 'default';
  return <Tag color={color}>{statusDisplay}</Tag>;
}
