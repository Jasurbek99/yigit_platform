// WorklogChip — "Today: 4h 23m" in the header. Reads from the `/worklog/me/`
// endpoint; refetches every 5 min. Hidden until the first response is in
// (no skeleton — the header doesn't need a layout-shift indicator for this).

import { Tooltip } from 'antd';
import { IconClock } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useMyWorklog } from '@/hooks/useWorklog';
import { useNavigate } from 'react-router-dom';

function formatHm(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function WorklogChip() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useMyWorklog();
  if (isLoading || !data) return null;

  const today = data.today_active_seconds || 0;
  return (
    <Tooltip title={t('worklog.chip_tooltip', { count: data.results.length })} placement="bottom">
      <button
        type="button"
        onClick={() => navigate('/worklog')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: '1px solid #e2e8f0',
          borderRadius: 999,
          padding: '2px 10px',
          fontSize: 12,
          color: '#475569',
          cursor: 'pointer',
        }}
        aria-label={t('worklog.chip_aria')}
      >
        <IconClock size={13} />
        {t('worklog.chip_today', { time: formatHm(today) })}
      </button>
    </Tooltip>
  );
}
