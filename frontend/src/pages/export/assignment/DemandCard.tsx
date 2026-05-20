import { useTranslation } from 'react-i18next';
import type { IDemandItem } from '@/types';
import { COLORS, FONT } from '@/constants/styles';

interface IDemandCardProps {
  item: IDemandItem;
  selected: boolean;
  onSelect: () => void;
}

export function DemandCard({ item, selected, onSelect }: IDemandCardProps) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onSelect}
      style={{
        background: selected ? COLORS.bgBlue : '#fff2e8',
        border: selected ? '2px solid #1677ff' : '1px solid #ffbb96',
        borderRadius: 6,
        padding: 10,
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: selected ? '0 0 0 2px rgba(22,119,255,0.2)' : undefined,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          color: '#d4380d',
          letterSpacing: '0.06em',
          marginBottom: 3,
        }}
      >
        {item.country}
        {item.strict && <span style={{ marginLeft: 6 }}>🔒 {t('assign.label_strict')}</span>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{item.customer}</div>
      <div style={{ fontSize: 11, color: COLORS.textTertiary, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div>
          {t('assign.label_firm')}<strong>{item.firm}</strong>
        </div>
        <div>
          {t('assign.label_remaining')}<strong style={{ fontFamily: FONT.mono }}>{item.remaining}</strong>
          {item.due_days > 0 && ` · ${t('assign.label_days_suffix', { days: item.due_days })}`}
        </div>
        <div>
          {t('assign.label_pref')}<em>{item.pref}</em>
        </div>
      </div>
    </div>
  );
}
