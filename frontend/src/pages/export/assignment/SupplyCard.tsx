import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { FreshnessPill } from '@/components/FreshnessPill';
import type { IShipmentDraft } from '@/types';
import { FRESHNESS_BORDER } from './assignmentHelpers';
import { COLORS } from '@/constants/styles';

interface ISupplyCardProps {
  draft: IShipmentDraft;
  selected: boolean;
  onSelect: () => void;
}

export function SupplyCard({ draft, selected, onSelect }: ISupplyCardProps) {
  const { t } = useTranslation();
  const freshness = draft.freshness;
  const sourceCodes = draft.block_sources.map((s) => s.block_code).join(' + ');
  const ageLabel =
    freshness === 'today'
      ? t('assign.age_today_with_hours', {
          hours: dayjs().diff(dayjs(draft.created_at), 'hour'),
        })
      : freshness === 'yesterday'
      ? t('assign.age_yesterday')
      : t('assign.age_old');

  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? COLORS.bgBlue : COLORS.bgCyan,
        border: selected
          ? '2px solid #1677ff'
          : `1px solid #87e8de`,
        borderLeft: `3px solid ${FRESHNESS_BORDER[freshness]}`,
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: selected ? '0 0 0 2px rgba(22,119,255,0.2)' : undefined,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
        <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: COLORS.primary }}>
          {draft.cargo_code}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#08979c' }}>
          {(draft.weight_net ?? 0).toLocaleString('ru-RU')} kg
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 500, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <FreshnessPill freshness={freshness} ageDays={draft.harvest_age_days} size="small" />
        <span style={{ color: COLORS.textTertiary }}>{sourceCodes}</span>
      </div>
      <div style={{ fontSize: 10, color: COLORS.textSecondary, marginTop: 2, fontStyle: 'italic' }}>
        {ageLabel}
      </div>
    </div>
  );
}
