import type { ReactNode } from 'react';
import { Flex, Typography } from 'antd';

import { COLORS } from '@/constants/styles';

interface IDocumentGroupProps {
  readonly title: ReactNode;
  /** Right of the title — e.g. «Fill packing» when the group is blocked on it. */
  readonly extra?: ReactNode;
  readonly children: ReactNode;
}

/** A titled block of document rows in the shipment Documents card. */
export function DocumentGroup({ title, extra, children }: IDocumentGroupProps) {
  return (
    <div style={{ marginTop: 12 }}>
      <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
        <Typography.Text strong style={{ fontSize: 12, color: COLORS.textSecondary, textTransform: 'uppercase' }}>
          {title}
        </Typography.Text>
        {extra}
      </Flex>
      {children}
    </div>
  );
}
