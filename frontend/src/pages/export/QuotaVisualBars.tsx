import { useTranslation } from 'react-i18next';
import type { IQuotaDashboardFirm } from '@/types';
import { fmtWeight, weightSuffix, type WeightUnit } from '@/utils/weight';
import { COLORS } from '@/constants/styles';

interface IProps {
  data: IQuotaDashboardFirm[];
  weightUnit: WeightUnit;
}

interface IFirmBarProps {
  firm: IQuotaDashboardFirm;
  maxKg: number;
  weightUnit: WeightUnit;
}

function FirmBar({ firm, maxKg, weightUnit }: IFirmBarProps) {
  const { t } = useTranslation();
  const ws = weightSuffix(weightUnit);
  const fw = (v: number) => fmtWeight(v, weightUnit);

  const expectedPct = maxKg > 0 ? (firm.expected_kg / maxKg) * 100 : 0;
  const issuedPct = firm.expected_kg > 0 ? Math.min((firm.issued_kg / firm.expected_kg) * 100, 100) : 0;
  const usedPct = firm.issued_kg > 0 ? Math.min((firm.used_kg / firm.issued_kg) * 100, 100) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: firm.is_blocked ? COLORS.danger : COLORS.textDark }}>
          {firm.export_firm_name}
        </span>
        <span style={{ fontSize: 12, color: COLORS.textTertiary }}>
          {t('quota_dashboard.issued')}: {fw(firm.issued_kg)} {ws}
          {firm.not_given_kg > 0 && (
            <span style={{ color: COLORS.danger, marginLeft: 8 }}>
              {t('quota_dashboard.not_given')}: {fw(firm.not_given_kg)} {ws}
            </span>
          )}
        </span>
      </div>

      {/* Expected bar (gray background) */}
      <div
        style={{
          position: 'relative',
          height: 20,
          background: COLORS.border,
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
            background: COLORS.primary,
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
            background: COLORS.success,
            borderRadius: 4,
            opacity: 0.85,
          }}
        />
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 11, color: COLORS.textSecondary }}>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: COLORS.borderLight,
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          {t('quota_dashboard.expected')}: {fw(firm.expected_kg)}
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: COLORS.primary,
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          {t('quota_dashboard.issued')}: {fw(firm.issued_kg)}
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: COLORS.success,
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          {t('quota_dashboard.used')}: {fw(firm.used_kg)}
        </span>
      </div>
    </div>
  );
}

export function QuotaVisualBars({ data, weightUnit }: IProps) {
  const sorted = [...data].sort((a, b) => b.expected_kg - a.expected_kg);
  const maxKg = sorted.reduce((m, f) => Math.max(m, f.expected_kg), 0);

  return (
    <div style={{ padding: '8px 0' }}>
      {sorted.map((firm) => (
        <FirmBar key={firm.export_firm} firm={firm} maxKg={maxKg} weightUnit={weightUnit} />
      ))}
    </div>
  );
}
