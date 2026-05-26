import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IShipmentListItem } from '@/types';

const STATUS_COLORS: Record<number, string> = {
  1: '#2e90fa',
  2: '#7a5af8',
  3: '#7a5af8',
  4: '#f79009',
  5: '#e04f16',
  6: '#e04f16',
  7: '#f79009',
  8: '#f79009',
  9: '#06aed4',
  10: '#06aed4',
  11: '#06aed4',
  12: '#f04438',
  13: '#067647',
};

const COUNTRY_FLAGS: Record<string, string> = {
  KZ: '🇰🇿',
  RU: '🇷🇺',
  BY: '🇧🇾',
  KG: '🇰🇬',
};

const COUNTRY_COLORS: Record<string, [string, string]> = {
  KZ: ['#eff8ff', '#175cd3'],
  RU: ['#f4f3ff', '#5925dc'],
  BY: ['#fdf2fa', '#c11574'],
  KG: ['#ecfeff', '#0e7090'],
};

function getProgressColor(step: number): string {
  if (step >= 13) return '#12b76a';
  if (step >= 9) return '#06aed4';
  if (step >= 5) return '#f79009';
  return '#2e90fa';
}

interface IShipmentRowProps {
  shipment: IShipmentListItem;
  index: number;
  onSelect: (id: number) => void;
}

export const ShipmentRow = memo(function ShipmentRow({
  shipment,
  index,
  onSelect,
}: IShipmentRowProps) {
  const { t } = useTranslation();

  const countryCode = shipment.country_name?.slice(0, 2).toUpperCase() ?? '';
  const flag = COUNTRY_FLAGS[countryCode] ?? '';
  const [countryBg, countryText] = COUNTRY_COLORS[countryCode] ?? ['#f9fafb', '#475467'];
  const barColor = shipment.is_gapy_satys ? '#ee46bc' : (STATUS_COLORS[shipment.status_step] ?? '#e4e7ec');
  const progressPct = Math.round((shipment.status_step / 13) * 100);
  const progressColor = getProgressColor(shipment.status_step);
  const weightTons = shipment.weight_net
    ? (shipment.weight_net / 1000).toFixed(1)
    : '—';

  const hasReport = Boolean(shipment.arrived_at);
  const isComplete = shipment.status_step >= 13;
  const needsReport = shipment.status_step >= 9 && !hasReport;

  return (
    <div className="shipment-row" onClick={() => onSelect(shipment.id)}>
      <div
        className="shipment-row-color-bar"
        style={{ background: barColor }}
      />

      {/* Row number */}
      <div
        style={{
          width: 28,
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 600,
          color: '#98a2b3',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {index + 1}
      </div>

      {/* Cargo code + date */}
      <div style={{ width: 100, flexShrink: 0 }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            fontSize: 13,
            color: '#175cd3',
            letterSpacing: '-0.3px',
          }}
        >
          {shipment.cargo_code}
        </div>
        <div style={{ fontSize: 9, color: '#98a2b3', marginTop: 1 }}>
          {shipment.date}
        </div>
      </div>

      {/* Customer */}
      <div style={{ width: 80, flexShrink: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 12,
            color: shipment.is_gapy_satys ? '#c11574' : '#344054',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {shipment.customer_name ?? '—'}
        </div>
      </div>

      {/* Country */}
      <div style={{ width: 110, flexShrink: 0 }}>
        <span
          style={{
            background: countryBg,
            color: countryText,
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 600,
            display: 'inline-block',
          }}
        >
          {flag} {shipment.country_name ?? '—'}
        </span>
      </div>

      {/* Status badge */}
      <div style={{ flex: 1, minWidth: 80 }}>
        <div style={{ fontSize: 11, color: '#475467', fontWeight: 500 }}>
          {shipment.status_display}
        </div>
      </div>

      {/* Weight */}
      <div
        style={{
          width: 56,
          flexShrink: 0,
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          fontSize: 12,
          textAlign: 'right',
          color: '#344054',
        }}
      >
        {weightTons}t
      </div>

      {/* Progress */}
      <div style={{ width: 80, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{
                width: `${progressPct}%`,
                background: progressColor,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: isComplete ? '#067647' : '#475467',
              fontFamily: "'JetBrains Mono', monospace",
              minWidth: 28,
            }}
          >
            {t('dashboard.step_of', { step: shipment.status_step })}
          </span>
        </div>
      </div>

      {/* Report indicator */}
      <div style={{ width: 50, flexShrink: 0, textAlign: 'right' }}>
        {isComplete ? (
          <span style={{ color: '#067647', fontSize: 13 }}>✓</span>
        ) : needsReport ? (
          <span
            style={{
              background: '#fef3f2',
              color: '#b42318',
              padding: '2px 6px',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            ✕
          </span>
        ) : (
          <span style={{ color: '#d0d5dd', fontSize: 11 }}>—</span>
        )}
      </div>
    </div>
  );
});
