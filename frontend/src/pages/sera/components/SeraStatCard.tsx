import type { ReactNode } from 'react';
import { SERA } from '../seraTheme';

interface SeraStatCardProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly sub?: ReactNode;
  readonly icon?: ReactNode;
  /** Accent tint for the value / left border. */
  readonly accent?: string;
  readonly tint?: string;
}

/**
 * A compact KPI tile: small label, large value, optional sub-line and icon.
 * Used across Ana Sayfa, Ana Dashboard and the Bütçe screens.
 */
export function SeraStatCard({
  label,
  value,
  sub,
  icon,
  accent = SERA.ink,
  tint = SERA.card,
}: SeraStatCardProps) {
  return (
    <div
      style={{
        background: tint,
        border: `1px solid ${SERA.line}`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 92,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: SERA.sub, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {label}
        </span>
        {icon}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: SERA.sub }}>{sub}</div>}
    </div>
  );
}
