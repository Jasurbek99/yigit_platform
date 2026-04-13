import { useTranslation } from 'react-i18next';
import { Timeline } from 'antd';
import dayjs from 'dayjs';
import type { IShipmentDetail } from '@/types';

const LIFECYCLE_STEPS = [
  { name: 'Yüklenme', icon: '📦' },
  { name: 'Gümrük↑', icon: '📋' },
  { name: 'Gümrük↓', icon: '✓' },
  { name: 'Ýola çykdy', icon: '🚚' },
  { name: 'Serhet TM', icon: '🚧' },
  { name: 'Geçdi', icon: '✓' },
  { name: 'Baryş güm.', icon: '🛃' },
  { name: 'Ýolda', icon: '🗺' },
  { name: 'Bardy', icon: '📍' },
  { name: 'Satylyar', icon: '💰' },
  { name: 'Satyldy', icon: '✓' },
  { name: 'Hasabat', icon: '📊' },
  { name: 'Tamam', icon: '✅' },
];

function getStepBarColor(step: number, index: number, activeColor: string): string {
  if (index < step - 1) return '#12b76a';
  if (index === step - 1) return activeColor;
  return '#f2f4f7';
}

interface IDetailSectionProps {
  titleKey: string;
  children: React.ReactNode;
}

function DetailSection({ titleKey, children }: IDetailSectionProps) {
  const { t } = useTranslation(); // used for section title translation
  return (
    <div className="detail-section">
      <div className="detail-section-title">{t(titleKey)}</div>
      {children}
    </div>
  );
}

interface IDetailFieldProps {
  labelKey: string;
  value: string | null | undefined;
  mono?: boolean;
}

function DetailField({ labelKey, value, mono }: IDetailFieldProps) {
  const { t } = useTranslation();
  const isEmpty = !value || value === '—';
  return (
    <div>
      <div className="detail-field-label">{t(labelKey)}</div>
      <div
        className={[
          'detail-field-value',
          isEmpty ? 'detail-field-value--empty' : '',
          mono ? 'detail-field-value--mono' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isEmpty ? '—' : value}
      </div>
    </div>
  );
}

interface IDetailSlideBodyProps {
  detail: IShipmentDetail;
  activeColor: string;
}

export function DetailSlideBody({ detail, activeColor }: IDetailSlideBodyProps) {
  const firmNames = detail.firm_splits.map((f) => f.export_firm_name ?? '—').join(' + ') || '—';
  const blockNames = detail.block_sources.map((b) => b.block_code).join(', ') || '—';

  return (
    <>
      {/* Lifecycle */}
      <DetailSection titleKey="dashboard.lifecycle_label">
        <div className="lifecycle-grid">
          {LIFECYCLE_STEPS.map((step, i) => {
            const barColor = getStepBarColor(detail.status_step, i, activeColor);
            const isDone = i < detail.status_step;
            const isActive = i === detail.status_step - 1;
            return (
              <div key={i} className="lifecycle-step">
                <div className="lifecycle-bar" style={{ background: barColor }} />
                <div className="lifecycle-icon">{step.icon}</div>
                <div
                  className={[
                    'lifecycle-name',
                    isDone ? 'lifecycle-name--done' : '',
                    isActive ? 'lifecycle-name--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {step.name}
                </div>
              </div>
            );
          })}
        </div>
      </DetailSection>

      {/* Overview */}
      <DetailSection titleKey="dashboard.section_overview">
        <div className="detail-grid">
          <DetailField labelKey="dashboard.cargo_code" value={detail.cargo_code} mono />
          <DetailField labelKey="dashboard.customer" value={detail.customer_name} />
          <DetailField labelKey="dashboard.country_city" value={detail.country_name} />
          <DetailField labelKey="dashboard.block" value={blockNames} />
          <DetailField
            labelKey="dashboard.weight"
            value={detail.weight_net ? `${detail.weight_net.toLocaleString()} kg` : null}
            mono
          />
          <DetailField labelKey="dashboard.export_firms" value={firmNames} />
        </div>
      </DetailSection>

      {/* Transport */}
      <DetailSection titleKey="dashboard.section_transport">
        <div className="detail-grid">
          <DetailField labelKey="dashboard.loading_started" value={detail.loading_started_at ? dayjs(detail.loading_started_at).format('DD.MM HH:mm') : null} />
          <DetailField labelKey="dashboard.border_exited" value={detail.border_crossed_at ? dayjs(detail.border_crossed_at).format('DD.MM') : null} />
          <DetailField labelKey="dashboard.arrived" value={detail.arrived_at ? dayjs(detail.arrived_at).format('DD.MM') : null} />
          <DetailField labelKey="dashboard.sale_ended" value={detail.sale_ended_at ? dayjs(detail.sale_ended_at).format('DD.MM') : null} />
        </div>
      </DetailSection>

      {/* Timeline */}
      {detail.status_log.length > 0 && (
        <DetailSection titleKey="dashboard.section_timeline">
          <Timeline
            items={detail.status_log.slice(0, 5).map((entry) => ({
              children: (
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: '#344054' }}>{entry.status_display}</div>
                  <div style={{ color: '#667085', fontSize: 11 }}>
                    {entry.changed_by_name} · {dayjs(entry.changed_at).format('DD.MM HH:mm')}
                  </div>
                  {entry.comment && (
                    <div style={{ color: '#475467', marginTop: 2 }}>{entry.comment}</div>
                  )}
                </div>
              ),
            }))}
          />
        </DetailSection>
      )}
    </>
  );
}
