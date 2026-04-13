import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface IDeadlineTimerProps {
  compact?: boolean;
}

export function DeadlineTimer({ compact = false }: IDeadlineTimerProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const target = new Date();
  target.setHours(13, 0, 0, 0);

  const diff = target.getTime() - now.getTime();
  const isPast = diff < 0;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);

  const timeStr = `${isPast ? '+' : ''}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const bg = isPast ? '#fef3f2' : diff < 3600000 ? '#fffaeb' : '#ecfdf3';
  const border = isPast ? '#fecdc9' : diff < 3600000 ? '#fedf89' : '#a6f4c5';
  const color = isPast ? '#b42318' : diff < 3600000 ? '#b54708' : '#067647';
  const timeColor = isPast ? '#f04438' : diff < 3600000 ? '#dc6803' : '#12b76a';

  if (compact) {
    return (
      <span
        style={{
          background: bg,
          color: timeColor,
          padding: '2px 8px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          border: `1px solid ${border}`,
        }}
      >
        {timeStr}
      </span>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 10,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {isPast ? t('sheet.deadline_passed') : t('sheet.deadline_label')}
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            fontFamily: "'JetBrains Mono', monospace",
            color: timeColor,
            letterSpacing: '-1px',
          }}
        >
          {timeStr}
          <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 4, opacity: 0.7 }}>
            {isPast ? t('sheet.deadline_overdue') : t('sheet.deadline_until')}
          </span>
        </div>
      </div>
    </div>
  );
}
