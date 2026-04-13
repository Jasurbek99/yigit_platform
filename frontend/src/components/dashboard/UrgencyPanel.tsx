import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UrgencyCard } from './UrgencyCard';
import type { IShipmentListItem } from '@/types';

interface IUrgencyPanelProps {
  shipments: IShipmentListItem[];
  onSelect: (id: number) => void;
}

interface IUrgencyGroup {
  icon: string;
  titleKey: string;
  items: IShipmentListItem[];
  color: string;
  bgColor: string;
  borderColor: string;
}

export function UrgencyPanel({ shipments, onSelect }: IUrgencyPanelProps) {
  const { t } = useTranslation();

  const groups = useMemo<IUrgencyGroup[]>(() => {
    const loading = shipments.filter((s) => s.status_step >= 1 && s.status_step <= 3);
    const customs = shipments.filter((s) => s.status_step === 2 || s.status_step === 3);
    const transit = shipments.filter((s) => s.status_step >= 4 && s.status_step <= 8);
    const border = shipments.filter((s) => s.status_step === 5 || s.status_step === 6);
    const missing = shipments.filter((s) => s.status_step >= 11);

    return [
      {
        icon: '📦',
        titleKey: 'dashboard.group_loading',
        items: loading,
        color: '#2e90fa',
        bgColor: '#eff8ff',
        borderColor: '#b2d9ff',
      },
      {
        icon: '🛃',
        titleKey: 'dashboard.group_customs',
        items: customs,
        color: '#7a5af8',
        bgColor: '#f4f3ff',
        borderColor: '#d9d6fe',
      },
      {
        icon: '🚛',
        titleKey: 'dashboard.group_transit',
        items: transit,
        color: '#f79009',
        bgColor: '#fffaeb',
        borderColor: '#fedf89',
      },
      {
        icon: '🚧',
        titleKey: 'dashboard.group_border',
        items: border,
        color: '#e04f16',
        bgColor: '#fef6ee',
        borderColor: '#f9dbaf',
      },
      {
        icon: '⚠️',
        titleKey: 'dashboard.group_missing',
        items: missing,
        color: '#f04438',
        bgColor: '#fef3f2',
        borderColor: '#fecdc9',
      },
    ];
  }, [shipments]);

  const hasAnyItems = groups.some((g) => g.items.length > 0);

  if (!hasAnyItems) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#98a2b3',
          fontSize: 13,
        }}
      >
        {t('dashboard.no_data')}
      </div>
    );
  }

  return (
    <>
      {groups.map((group) =>
        group.items.length > 0 ? (
          <UrgencyCard
            key={group.titleKey}
            icon={group.icon}
            titleKey={group.titleKey}
            items={group.items}
            color={group.color}
            bgColor={group.bgColor}
            borderColor={group.borderColor}
            onSelect={onSelect}
          />
        ) : null,
      )}
    </>
  );
}
