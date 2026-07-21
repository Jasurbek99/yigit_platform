// Per-user KPI card: rank medal, avatar, completed headline, on-time meter,
// overdue badge, active hours, 14-day trend sparkline.

import { Card, Progress, Tag, Typography, Avatar } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';
import type { ITeamKpiRow } from '@/types/teamKpi';

const { Text } = Typography;

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function formatHm(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface ISparklineProps {
  readonly points: number[];
}

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 32;
const SPARK_PADDING = 2;

function Sparkline({ points }: ISparklineProps) {
  if (points.length === 0) return null;

  const max = Math.max(...points, 1);
  const usableHeight = SPARK_HEIGHT - SPARK_PADDING * 2;
  const coords = points
    .map((value, i) => {
      const x = points.length === 1 ? 0 : (i / (points.length - 1)) * SPARK_WIDTH;
      const y = SPARK_HEIGHT - SPARK_PADDING - (value / max) * usableHeight;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: SPARK_HEIGHT, display: 'block' }}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={COLORS.primary}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={coords}
      />
    </svg>
  );
}

interface ITeamKpiCardProps {
  readonly row: ITeamKpiRow;
  readonly rank: number;
}

export function TeamKpiCard({ row, rank }: ITeamKpiCardProps) {
  const { t } = useTranslation();
  const pct = row.on_time_rate == null ? null : Math.round(row.on_time_rate * 100);
  const onTimeColor = row.on_time_rate == null ? undefined : (row.on_time_rate >= 0.8 ? COLORS.success : COLORS.orange);
  const hasTrend = row.trend.some((n) => n > 0);

  return (
    <Card size="small" style={{ borderRadius: 8 }} styles={{ body: { padding: '12px 14px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 22, textAlign: 'center', fontWeight: 700 }}>
          {MEDALS[rank] ?? <Text type="secondary">{rank}</Text>}
        </span>
        <Avatar size={30} style={{ backgroundColor: COLORS.primary, color: '#fff', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
          {initials(row.user_name) || '?'}
        </Avatar>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text strong ellipsis style={{ display: 'block' }}>{row.user_name}</Text>
          <Tag color="blue" style={{ marginTop: 2 }}>{t(`roles.${row.role}`, { defaultValue: row.role })}</Tag>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
          {row.completed}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{t('team_kpi.card_completed')}</Text>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <Text type="secondary">{t('team_kpi.card_on_time')}</Text>
          <Text style={{ color: pct == null ? undefined : onTimeColor }}>{pct == null ? '—' : `${pct}%`}</Text>
        </div>
        <Progress percent={pct ?? 0} size="small" showInfo={false} strokeColor={onTimeColor} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
        <Text type="secondary">{t('team_kpi.card_overdue')}</Text>
        <Text style={{ color: row.overdue_now > 0 ? COLORS.orange : undefined }}>
          {row.overdue_now > 0 ? row.overdue_now : '—'}
        </Text>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12 }}>
        <Text type="secondary">{t('team_kpi.card_active')}</Text>
        <Text type={row.active_seconds === 0 ? 'secondary' : undefined}>
          {row.active_seconds === 0 ? '—' : formatHm(row.active_seconds)}
        </Text>
      </div>

      {hasTrend && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>{t('team_kpi.card_trend')}</Text>
          <div style={{ height: 32 }}>
            <Sparkline points={row.trend} />
          </div>
        </div>
      )}
    </Card>
  );
}
