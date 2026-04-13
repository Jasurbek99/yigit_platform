import { useMemo } from 'react';
import { Flex, Statistic } from 'antd';
import { useTranslation } from 'react-i18next';
import { DeadlineTimer } from '@/components/DeadlineTimer';
import type { IShipmentListItem } from '@/types';

interface IDashboardHeaderProps {
  shipments: IShipmentListItem[];
}

export function DashboardHeader({ shipments }: IDashboardHeaderProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const total = shipments.length;
    const active = shipments.filter((s) => s.status_step < 13).length;
    const completed = shipments.filter((s) => s.status_step >= 13).length;
    const missing = shipments.filter((s) => s.status_step >= 11).length;
    return { total, active, completed, missing };
  }, [shipments]);

  return (
    <div
      style={{
        padding: '12px 20px',
        borderBottom: '1px solid #eaecf0',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#101828', lineHeight: 1.2 }}>
          {t('dashboard.title')}
        </div>
        <div style={{ fontSize: 11, color: '#667085', marginTop: 2 }}>
          {t('dashboard.season_label')}
        </div>
      </div>

      <Flex gap={24} align="center" wrap="wrap">
        <Statistic
          title={t('dashboard.stat_total')}
          value={stats.total}
          valueStyle={{ fontSize: 20, fontWeight: 700, color: '#344054' }}
        />
        <Statistic
          title={t('dashboard.stat_active')}
          value={stats.active}
          valueStyle={{ fontSize: 20, fontWeight: 700, color: '#175cd3' }}
        />
        <Statistic
          title={t('dashboard.stat_completed')}
          value={stats.completed}
          valueStyle={{ fontSize: 20, fontWeight: 700, color: '#067647' }}
        />
        {stats.missing > 0 && (
          <Statistic
            title={t('dashboard.stat_missing')}
            value={stats.missing}
            valueStyle={{ fontSize: 20, fontWeight: 700, color: '#b42318' }}
          />
        )}
      </Flex>

      <DeadlineTimer />
    </div>
  );
}
