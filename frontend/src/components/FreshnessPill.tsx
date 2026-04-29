import { Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';

// ─── Types ────────────────────────────────────────────────────────────────

export interface IFreshnessPillProps {
  freshness: 'today' | 'yesterday' | 'aged';
  ageDays?: number;
  size?: 'small' | 'default';
  showLabel?: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────

type FreshnessConfig = {
  color: string;
  dotBackground: string;
  labelKey: 'freshness.today' | 'freshness.yesterday' | 'freshness.aged';
};

const FRESHNESS_CONFIG: Record<'today' | 'yesterday' | 'aged', FreshnessConfig> = {
  today: {
    color: 'success',
    dotBackground: '#52c41a',
    labelKey: 'freshness.today',
  },
  yesterday: {
    color: 'warning',
    dotBackground: '#faad14',
    labelKey: 'freshness.yesterday',
  },
  aged: {
    color: 'error',
    dotBackground: '#ff4d4f',
    labelKey: 'freshness.aged',
  },
};

// ─── Component ────────────────────────────────────────────────────────────

export function FreshnessPill({
  freshness,
  ageDays,
  size = 'default',
  showLabel = true,
}: IFreshnessPillProps) {
  const { t } = useTranslation();
  const config = FRESHNESS_CONFIG[freshness];

  const dot = (
    <span
      style={{
        display: 'inline-block',
        width: size === 'small' ? 6 : 8,
        height: size === 'small' ? 6 : 8,
        borderRadius: '50%',
        background: config.dotBackground,
        marginRight: showLabel ? 5 : 0,
        flexShrink: 0,
      }}
    />
  );

  const pill = showLabel ? (
    <Tag
      color={config.color}
      style={{ margin: 0, fontSize: size === 'small' ? 11 : 12, display: 'inline-flex', alignItems: 'center' }}
    >
      {dot}
      {t(config.labelKey)}
    </Tag>
  ) : (
    dot
  );

  if (ageDays != null) {
    return (
      <Tooltip title={t('freshness.tooltip', { days: ageDays })}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>{pill}</span>
      </Tooltip>
    );
  }

  return <span style={{ display: 'inline-flex', alignItems: 'center' }}>{pill}</span>;
}
