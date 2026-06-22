import { useState } from 'react';
import { DownOutlined } from '@ant-design/icons';
import { COLORS } from '@/constants/styles';

export type StageState = 'done' | 'active' | 'pending';

interface ILifecycleStageProps {
  /** 1-based position, shown inside the dot for pending stages. */
  stepNumber: number;
  title: string;
  state: StageState;
  /** Short status line under the title (e.g. "In progress", a timestamp). */
  summary?: string;
  /** Whether the body starts expanded (the active stage does). */
  defaultOpen: boolean;
  /** Last stage hides the trailing connector line. */
  isLast?: boolean;
  children: React.ReactNode;
}

/**
 * One collapsible stage on the ShipmentDetail lifecycle spine.
 *
 * Renders a timeline dot + connector (done / active / pending, mirroring
 * RouteTimelineRail's visual language) and a clickable header that toggles the
 * stage body. The active stage opens by default; the others are one click away,
 * so an operator sees the step they're on without the full field-wall.
 */
export function LifecycleStage({
  stepNumber,
  title,
  state,
  summary,
  defaultOpen,
  isLast = false,
  children,
}: ILifecycleStageProps) {
  const [open, setOpen] = useState(defaultOpen);

  const dotBg =
    state === 'done' ? COLORS.success :
    state === 'active' ? COLORS.primary :
    COLORS.bgLight;
  const dotColor = state === 'pending' ? COLORS.textMuted : COLORS.white;

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 8 }}>
      {/* Connector line down the spine */}
      {!isLast && (
        <div
          style={{
            position: 'absolute',
            left: 15,
            top: 34,
            bottom: 0,
            width: 2,
            background: state === 'done' ? COLORS.success : COLORS.border,
          }}
        />
      )}

      {/* Step dot */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 600,
          zIndex: 1,
          background: dotBg,
          color: dotColor,
          border: state === 'pending' ? `2px solid ${COLORS.borderLight}` : 'none',
        }}
      >
        {state === 'done' ? '✓' : state === 'active' ? '●' : stepNumber}
      </div>

      {/* Header + collapsible body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '5px 0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span
              style={{
                fontWeight: state === 'active' ? 600 : 500,
                fontSize: 15,
                color: state === 'pending' ? COLORS.textTertiary : COLORS.textPrimary,
              }}
            >
              {title}
            </span>
            {summary && (
              <span style={{ fontSize: 12, color: COLORS.textSecondary }}>{summary}</span>
            )}
          </span>
          <DownOutlined
            style={{
              fontSize: 12,
              color: COLORS.textSecondary,
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.15s',
            }}
          />
        </button>

        {open && (
          <div
            style={{
              padding: '8px 0 20px',
              borderBottom: isLast ? 'none' : `1px solid ${COLORS.border}`,
              marginBottom: isLast ? 0 : 4,
            }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
