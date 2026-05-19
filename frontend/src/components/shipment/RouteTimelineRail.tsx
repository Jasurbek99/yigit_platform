import { Card, Tag } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import type { IShipmentDetail, IStatusLogEntry } from '@/types';
import { COLORS } from '@/constants/styles';

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
 */
export function RouteTimelineRail({ shipment }: IRouteTimelineRailProps) {
  const { t } = useTranslation();

  const STATUS_STEPS = getStatusStepsForShipment(shipment.has_peregruz);
  const currentIdx = STATUS_STEPS.findIndex((s) => s.code === shipment.status_code);

  // Map log entries by status_code so we don't rely on positional ordering;
  // ShipmentStatusLog is ordered by -changed_at so log[0] is the most recent
  // entry, NOT the first step.
  const logByCode = new Map<string, IStatusLogEntry>();
  for (const entry of shipment.status_log) {
    logByCode.set(entry.status_code, entry);
  }

  return (
    <Card
      title={`📍 ${t('shipment_detail.route_card')}`}
      size="small"
      style={{ marginBottom: 16 }}
    >
      <div style={{ padding: '4px 0' }}>
        {STATUS_STEPS.map((step, idx) => {
          const state: 'done' | 'active' | 'pending' =
            idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending';
          const logEntry: IStatusLogEntry | null = logByCode.get(step.code) ?? null;
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
                    state === 'done' ? COLORS.success : state === 'active' ? COLORS.primary : COLORS.bgLight,
                  color: state === 'pending' ? COLORS.textMuted : COLORS.white,
                  border: state === 'pending' ? '2px solid #d9d9d9' : 'none',
                }}
              >
                {state === 'done' ? '✓' : state === 'active' ? '●' : idx + 1}
              </div>
              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: state === 'active' ? 600 : 500,
                    fontSize: 13,
                    color:
                      state === 'pending' ? COLORS.textMuted : state === 'active' ? COLORS.primary : COLORS.textPrimary,
                  }}
                >
                  {t(`shipment_status.${step.code}`)}
                  {step.code === 'dest_entry' && shipment.country_name && (
                    <span style={{ color: COLORS.textSecondary, fontWeight: 400 }}>
                      {` — ${shipment.country_name}`}
                    </span>
                  )}
                  {state !== 'pending' && logEntry?.is_auto && (
                    <Tag color="default" style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px' }}>
                      {t('shipment_status.auto_badge', 'Auto')}
                    </Tag>
                  )}
                </div>
                {state !== 'pending' && logEntry && (
                  <div style={{ fontSize: 11, color: COLORS.textSecondary, fontFamily: 'monospace' }}>
                    {fmt(logEntry.changed_at)}
                  </div>
                )}
                {state !== 'pending' && logEntry?.comment && (
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
      </div>
    </Card>
  );
}
