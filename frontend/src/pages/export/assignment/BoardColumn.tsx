import type { ReactNode } from 'react';
import { COLORS } from '@/constants/styles';

interface IBoardColumnProps {
  title: string;
  dotColor?: string;
  count?: number;
  children: ReactNode;
}

/** One Assignment-board column: header with a dot and a count, scrolling body. */
export function BoardColumn({ title, dotColor, count, children }: IBoardColumnProps) {
  return (
    <div style={{ background: COLORS.white, border: '1px solid #f0f0f0', borderRadius: 8,
      display: 'flex', flexDirection: 'column', minHeight: 600 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          {dotColor && (
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
          )}
          {title}
        </div>
        {count != null && (
          <div style={{ background: COLORS.border, padding: '2px 9px', borderRadius: 12, fontSize: 12,
            fontWeight: 600, color: COLORS.textTertiary }}>
            {count}
          </div>
        )}
      </div>
      <div style={{ padding: 10, flex: 1, overflowY: 'auto', maxHeight: 680 }}>{children}</div>
    </div>
  );
}
