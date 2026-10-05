import type { ReactNode } from 'react';
import { Flex, Typography } from 'antd';

import { COLORS } from '@/constants/styles';

interface IDocumentRowShellProps {
  readonly label: ReactNode;
  /** Why the row's actions are blocked — shown under the label, not in a tooltip, so it reads on a phone. */
  readonly hint?: string | null;
  readonly children: ReactNode;
}

/** One line of the shipment Documents card: the document's name left, its actions right. */
export function DocumentRowShell({ label, hint, children }: IDocumentRowShellProps) {
  return (
    <Flex
      data-doc-row
      justify="space-between"
      align="center"
      wrap="wrap"
      gap={8}
      style={{ padding: '6px 0', borderBottom: `1px solid ${COLORS.border}` }}
    >
      <div style={{ minWidth: 0 }}>
        <Typography.Text>{label}</Typography.Text>
        {hint && (
          <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{hint}</Typography.Text></div>
        )}
      </div>
      <Flex gap={4} wrap="wrap">{children}</Flex>
    </Flex>
  );
}
