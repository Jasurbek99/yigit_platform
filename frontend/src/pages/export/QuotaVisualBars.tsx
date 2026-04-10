import { useTranslation } from 'react-i18next';
import type { IQuotaDashboardFirm } from '@/types';

interface IProps {
  data: IQuotaDashboardFirm[];
}

interface IFirmBarProps {
  firm: IQuotaDashboardFirm;
  maxKg: number;
}

function FirmBar({ firm, maxKg }: IFirmBarProps) {
  const { t } = useTranslation();

  const expectedPct = maxKg > 0 ? (firm.expected_kg / maxKg) * 100 : 0;
  const issuedPct = firm.expected_kg > 0 ? Math.min((firm.issued_kg / firm.expected_kg) * 100, 100) : 0;
  const usedPct = firm.issued_kg > 0 ? Math.min((firm.used_kg / firm.issued_kg) * 100, 100) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: firm.is_blocked ? '#ff4d4f' : '#1f1f1f' }}>
          {firm.export_firm_name}
        </span>
        <span style={{ fontSize: 12, color: '#595959' }}>
          {t('quota_dashboard.issued')}: {Number(firm.issued_kg).toLocaleString()} kg
          {firm.not_given_kg > 0 && (
            <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
              {t('quota_dashboard.not_given')}: {Number(firm.not_given_kg).toLocaleString()} kg
            </span>
          )}
        </span>
      </div>

      {/* Expected bar (gray background) */}
      <div
        style={{
          position: 'relative',
          height: 20,
          background: '#f0f0f0',
          borderRadius: 4,
          overflow: 'hidden',
          width: `${Math.max(expectedPct, 4)}%`,
          minWidth: 40,
        }}
      >
        {/* Issued bar (blue) */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${issuedPct}%`,
            background: '#1677ff',
            borderRadius: 4,
            opacity: 0.85,
          }}
        />
        {/* Used bar (green overlay) */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${(issuedPct * usedPct) / 100}%`,
            background: '#52c41a',
            borderRadius: 4,
            opacity: 0.85,
          }}
        />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 11, color: '#8c8c8c' }}>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: '#d9d9d9',
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          {t('quota_dashboard.expected')}: {Number(firm.expected_kg).toLocaleString()}
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: '#1677ff',
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          {t('quota_dashboard.issued')}: {Number(firm.issued_kg).toLocaleString()}
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: '#52c41a',
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          {t('quota_dashboard.used')}: {Number(firm.used_kg).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export function QuotaVisualBars({ data }: IProps) {
  const sorted = [...data].sort((a, b) => b.expected_kg - a.expected_kg);
  const maxKg = sorted.reduce((m, f) => Math.max(m, f.expected_kg), 0);

  return (
    <div style={{ padding: '8px 0' }}>
      {sorted.map((firm) => (
        <FirmBar key={firm.export_firm} firm={firm} maxKg={maxKg} />
      ))}
    </div>
  );
}
