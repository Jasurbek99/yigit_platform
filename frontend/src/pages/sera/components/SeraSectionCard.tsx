import type { ReactNode } from 'react';
import { useState } from 'react';
import { SERA } from '../seraTheme';

interface SeraSectionCardProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly iconColor?: string;
  readonly onClick?: () => void;
}

/**
 * A clickable section tile used on the Bütçe hub grid — a coloured square
 * icon plus a label, with a hover lift. Mirrors the source hub cards.
 */
export function SeraSectionCard({ icon, label, iconColor = SERA.green, onClick }: SeraSectionCardProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: 16,
        borderRadius: 14,
        border: `1px solid ${hover ? SERA.emerald : SERA.line}`,
        background: SERA.card,
        boxShadow: hover ? '0 6px 18px rgba(16,185,129,0.14)' : 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s ease',
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: iconColor,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 15, fontWeight: 600, color: SERA.ink }}>{label}</span>
    </button>
  );
}
