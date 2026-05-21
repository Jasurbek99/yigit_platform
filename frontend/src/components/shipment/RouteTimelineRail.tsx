import { Card, Tag } from 'antd';
import { CloseCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import type { IShipmentDetail, IStatusLogEntry } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

// State machine v2: 12 steps + draft (step 0).
// transshipment is inserted only for has_peregruz=True shipments — see getStatusStepsForShipment.
interface IStatusStep { code: string }

const STATUS_STEPS_BASE: IStatusStep[] = [
  { code: 'draft' },
  { code: 'gumruk_girish' },
  { code: 'gumruk_chykysh' },
  { code: 'yuklenme' },
  { code: 'yola_chykdy' },
  { code: 'serhet_gechdi' },
  { code: 'dest_entry' },
  { code: 'barysh_gumrugi' },
  // transshipment slot — included only when shipment.has_peregruz === true
  { code: 'bardy' },
  { code: 'satylyar' },
  { code: 'satyldy' },
  { code: 'tamamlandy' },
];

function getStatusStepsForShipment(hasPeregruz: boolean | null | undefined): IStatusStep[] {
  if (!hasPeregruz) return STATUS_STEPS_BASE;
  const out = [...STATUS_STEPS_BASE];
  // Insert transshipment between barysh_gumrugi and bardy.
  const baryshIdx = out.findIndex((s) => s.code === 'barysh_gumrugi');
  if (baryshIdx >= 0) {
    out.splice(baryshIdx + 1, 0, { code: 'transshipment' });
  }
  return out;
}

/** Format an ISO datetime string with the active dayjs locale. */
function fmt(ts: string | null | undefined): string {
  if (!ts) return '—';
  return dayjs(ts).format('DD MMM HH:mm');
}

interface IRouteTimelineRailProps {
  shipment: IShipmentDetail;
}

/**
 * Vertical status-route timeline extracted from the old ShipmentDetail tabs.
 * Shows all 13 lifecycle steps with completion markers, timestamps, and comments.
 * When a shipment is cancelled, forward steps that were never reached are
 * rendered as dimmed/disabled (not pending-next), and a red "Cancelled" tile
 * is appended at the end showing the timestamp and reason.
 */
export function RouteTimelineRail({ shipment }: IRouteTimelineRailProps) {
  const { t } = useTranslation();

  const STATUS_STEPS = getStatusStepsForShipment(shipment.has_peregruz);
  const isCancelled = shipment.status_code === 'cancelled';

  // Map log entries by status_code so we don't rely on positional ordering;
  // ShipmentStatusLog is ordered by -changed_at so log[0] is the most recent
  // entry, NOT the first step.
  const logByCode = new Map<string, IStatusLogEntry>();
  for (const entry of shipment.status_log) {
    logByCode.set(entry.status_code, entry);
  }

  // For cancelled shipments: find the last forward step that was actually
  // reached so we can mark everything up to that as 'done' and everything
  // after as 'skipped' (dimmed, not pending-next).
  const cancelledLogEntry: IStatusLogEntry | null = isCancelled
    ? (logByCode.get('cancelled') ?? null)
    : null;

  // Determine the index of the last reached forward step.
  // We walk STATUS_STEPS in reverse and find the first one present in logByCode.
  let lastReachedIdx = -1;
  if (isCancelled) {
    for (let i = STATUS_STEPS.length - 1; i >= 0; i--) {
      if (logByCode.has(STATUS_STEPS[i].code)) {
        lastReachedIdx = i;
        break;
      }
    }
  }

  const currentIdx = isCancelled
    ? lastReachedIdx
    : STATUS_STEPS.findIndex((s) => s.code === shipment.status_code);

  return (
    <Card
      title={`📍 ${t('shipment_detail.route_card')}`}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <div style={{ padding: '4px 0' }}>
        {STATUS_STEPS.map((step, idx) => {
          // For cancelled shipments, every step after the last reached one is
          // 'skipped' (dimmed). Steps at or before lastReachedIdx are 'done'.
          // For normal shipments: existing done/active/pending logic.
          const state: 'done' | 'active' | 'pending' | 'skipped' = isCancelled
            ? (idx <= currentIdx ? 'done' : 'skipped')
            : (idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending');

          const logEntry: IStatusLogEntry | null = logByCode.get(step.code) ?? null;
          // For cancelled shipments there is no future "next" step — all
          // remaining forward steps get a line to the cancel tile.
          const isLast = idx === STATUS_STEPS.length - 1;

          return (
            <div
              key={step.code}
              style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 20 }}
            >
              {/* Connector line */}
              {!isLast && (
                <div
                  style={{
                    position: 'absolute',
                    left: 15,
                    top: 32,
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
                  background:
                    state === 'done' ? COLORS.success :
                    state === 'active' ? COLORS.primary :
                    COLORS.bgLight,
                  color: (state === 'pending' || state === 'skipped') ? COLORS.textMuted : COLORS.white,
                  border: (state === 'pending' || state === 'skipped') ? '2px solid #d9d9d9' : 'none',
                  opacity: state === 'skipped' ? 0.45 : 1,
                }}
              >
                {state === 'done' ? '✓' : state === 'active' ? '●' : idx + 1}
              </div>
              {/* Content */}
              <div style={{ flex: 1, minWidth: 0, opacity: state === 'skipped' ? 0.45 : 1 }}>
                <div
                  style={{
                    fontWeight: state === 'active' ? 600 : 500,
                    fontSize: 13,
                    color:
                      (state === 'pending' || state === 'skipped') ? COLORS.textMuted :
                      state === 'active' ? COLORS.primary :
                      COLORS.textPrimary,
                  }}
                >
                  {t(`shipment_status.${step.code}`)}
                  {step.code === 'dest_entry' && shipment.country_name && (
                    <span style={{ color: COLORS.textSecondary, fontWeight: 400 }}>
                      {` — ${shipment.country_name}`}
                    </span>
                  )}
                  {state !== 'pending' && state !== 'skipped' && logEntry?.is_auto && (
                    <Tag color="default" style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px' }}>
                      {t('shipment_status.auto_badge', 'Auto')}
                    </Tag>
                  )}
                </div>
                {state !== 'pending' && state !== 'skipped' && logEntry && (
                  <div style={{ fontSize: 11, color: COLORS.textSecondary, fontFamily: FONT.mono }}>
                    {fmt(logEntry.changed_at)}
                  </div>
                )}
                {state !== 'pending' && state !== 'skipped' && logEntry?.comment && (
                  <div style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 2 }}>
                    {logEntry.comment}
                  </div>
                )}
                {state === 'active' && (
                  <div style={{ fontSize: 11, color: COLORS.textSecondary }}>
                    {t('shipment_detail.status_now')}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Cancelled tile — appended after all forward steps for cancelled shipments */}
        {isCancelled && (
          <div style={{ display: 'flex', gap: 12, position: 'relative', paddingTop: 20 }}>
            {/* Red dot with X icon */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                zIndex: 1,
                background: '#ff4d4f',
                color: '#fff',
                border: 'none',
              }}
            >
              <CloseCircleOutlined />
            </div>
            {/* Connector line from last forward step to cancelled tile */}
            <div
              style={{
                position: 'absolute',
                left: 15,
                top: 0,
                height: 20,
                width: 2,
                background: COLORS.border,
              }}
            />
            {/* Cancelled content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#ff4d4f' }}>
                {t('shipment_status.cancelled')}
              </div>
              {cancelledLogEntry && (
                <div style={{ fontSize: 11, color: COLORS.textSecondary, fontFamily: FONT.mono }}>
                  {fmt(cancelledLogEntry.changed_at)}
                  {cancelledLogEntry.changed_by_name && (
                    <span> · {cancelledLogEntry.changed_by_name}</span>
                  )}
                </div>
              )}
              {cancelledLogEntry?.comment && (
                <div
                  style={{
                    fontSize: 11,
                    color: COLORS.textTertiary,
                    marginTop: 2,
                    fontStyle: 'italic',
                  }}
                >
                  {cancelledLogEntry.comment}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
