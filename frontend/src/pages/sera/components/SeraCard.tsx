import type { ReactNode } from 'react';
import { SERA } from '../seraTheme';

interface SeraCardProps {
  readonly title?: ReactNode;
  readonly extra?: ReactNode;
  readonly children: ReactNode;
  readonly padding?: number;
  readonly style?: React.CSSProperties;
}

/** White rounded surface with an optional title/extra header row. */
export function SeraCard({ title, extra, children, padding = 18, style }: SeraCardProps) {
  return (
    <div style={{ background: SERA.card, border: `1px solid ${SERA.line}`, borderRadius: 14, padding, ...style }}>
      {(title || extra) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          {title && <span style={{ fontWeight: 700, color: SERA.ink }}>{title}</span>}
          {extra && <span style={{ color: SERA.sub, fontSize: 13 }}>{extra}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
