import { Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { useShipmentDetail } from '@/hooks/useShipmentDetail';
import { DetailSlideBody } from './DetailSlideBody';

const STATUS_STEP_COLOR: Record<number, string> = {
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

interface IDetailSlideProps {
  shipmentId: number | null;
  onClose: () => void;
}

export function DetailSlide({ shipmentId, onClose }: IDetailSlideProps) {
  const { t } = useTranslation();
  const { data: detail, isLoading } = useShipmentDetail(shipmentId ?? undefined);

  if (shipmentId === null) return null;

  const activeColor = detail ? (STATUS_STEP_COLOR[detail.status_step] ?? '#2e90fa') : '#2e90fa';
  const countryCode = detail?.country_name?.slice(0, 2).toUpperCase() ?? '';
  const flag = COUNTRY_FLAGS[countryCode] ?? '';
  const isGapy = detail?.is_gapy_satys ?? false;
  const weightFormatted = detail?.weight_net
    ? `${detail.weight_net.toLocaleString()} kg`
    : '—';

  return (
    <>
      <div className="detail-backdrop" onClick={onClose} />
      <div className="detail-panel">
        <div className="detail-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.5)',
                  fontWeight: 600,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                {t('dashboard.detail_title')}
              </div>
              {isLoading ? (
                <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                  <Spin size="small" />
                </div>
              ) : (
                <>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 800,
                      fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: '-0.5px',
                    }}
                  >
                    {detail?.cargo_code ?? '—'}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>
                    {detail?.customer_name ?? '—'} → {flag} {detail?.country_name ?? '—'} · {weightFormatted}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label={t('dashboard.close')}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: '#fff',
                borderRadius: 8,
                width: 32,
                height: 32,
                fontSize: 16,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          {!isLoading && detail && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  color: activeColor,
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <span
                  className="status-dot--pulse"
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: activeColor,
                    marginRight: 5,
                    verticalAlign: 'middle',
                  }}
                />
                {detail.status_display}
              </span>
              {isGapy && (
                <span
                  style={{
                    background: '#fdf2fa',
                    color: '#c11574',
                    padding: '3px 10px',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  🏪 {t('dashboard.gapy_satys')}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="detail-body">
          {isLoading && (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Spin />
            </div>
          )}
          {!isLoading && detail && (
            <DetailSlideBody detail={detail} activeColor={activeColor} />
          )}
        </div>
      </div>
    </>
  );
}
