import React from 'react';
import { Typography } from 'antd';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

export interface ISummaryRowProps {
  readonly label: string;
  readonly value: string;
  readonly highlight?: boolean;
}

export function SummaryRow({ label, value, highlight }: ISummaryRowProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <Text style={{ fontSize: 13, color: highlight ? undefined : COLORS.textTertiary }}>
        {label}
      </Text>
      <Text strong={highlight} style={{ fontSize: 13 }}>
        {value}
      </Text>
    </div>
  );
}
