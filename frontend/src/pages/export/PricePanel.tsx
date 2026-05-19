import { useMemo, useState } from 'react';
import { Alert, Radio, Space, Tag, Typography } from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { usePriceEntries } from '@/hooks/usePlanning';
import type { IPriceEntry } from '@/types';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

type DaysRange = 7 | 14 | 30;

interface IPriceRow {
  city: string;
  trend: 'up' | 'down' | 'flat';
  cells: Record<string, IPriceEntry | undefined>;
}

export default function PricePanel() {
  const { t } = useTranslation();
  const [days, setDays] = useState<DaysRange>(7);
  const { data: entries, isLoading, isError } = usePriceEntries(days);

  const { rows, dates } = useMemo(() => {
    const all = entries ?? [];
    const cities = [...new Set(all.map((e) => e.city_name))].sort();
    const sortedDates = [...new Set(all.map((e) => e.date))].sort().reverse().slice(0, days);

    const priceMap: Record<string, Record<string, IPriceEntry>> = {};
    for (const e of all) {
      if (!priceMap[e.city_name]) priceMap[e.city_name] = {};
      priceMap[e.city_name][e.date] = e;
    }

    const builtRows: IPriceRow[] = cities.map((city) => {
      let trend: IPriceRow['trend'] = 'flat';
      if (sortedDates.length >= 2) {
        const today = priceMap[city]?.[sortedDates[0]]?.price_usd;
        const yesterday = priceMap[city]?.[sortedDates[1]]?.price_usd;
        if (today != null && yesterday != null) {
          if (today > yesterday) trend = 'up';
          else if (today < yesterday) trend = 'down';
        }
      }
      return { city, trend, cells: priceMap[city] ?? {} };
    });

    return { rows: builtRows, dates: sortedDates };
  }, [entries, days]);

  const columns: ProColumns<IPriceRow>[] = [
    {
      title: t('prices.city'),
      dataIndex: 'city',
      width: 140,
      fixed: 'left',
      search: false,
      sorter: (a, b) => a.city.localeCompare(b.city),
      defaultSortOrder: 'ascend',
      render: (_, record) => (
        <Space size={4}>
          <span>{record.city}</span>
          {record.trend === 'up' && <Tag color="red" style={{ margin: 0, padding: '0 4px' }}>↑</Tag>}
          {record.trend === 'down' && <Tag color="green" style={{ margin: 0, padding: '0 4px' }}>↓</Tag>}
        </Space>
      ),
    },
    ...dates.map<ProColumns<IPriceRow>>((date) => ({
      title: dayjs(date).format('DD.MM'),
      key: date,
      width: 110,
      align: 'right',
      search: false,
      render: (_, record) => {
        const entry = record.cells[date];
        if (!entry) return <span style={{ color: COLORS.textMuted }}>—</span>;
        return (
          <span>
            <span style={{ fontWeight: 500 }}>${entry.price_usd?.toFixed(2)}</span>
            {entry.price_local != null && (
              <span style={{ color: COLORS.textSecondary, fontSize: 11, marginLeft: 4 }}>
                {Number(entry.price_local).toLocaleString()} {entry.currency}
              </span>
            )}
          </span>
        );
      },
    })),
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: COLORS.textDark, lineHeight: '1.3' }}>
            {t('prices.title')}
          </div>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
            {t('prices.subtitle')}
          </div>
        </div>
        <Radio.Group
          value={days}
          onChange={(e) => setDays(e.target.value as DaysRange)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: t('prices.days_7'), value: 7 },
            { label: t('prices.days_14'), value: 14 },
            { label: t('prices.days_30'), value: 30 },
          ]}
        />
      </Space>

      {isError && (
        <Alert type="error" message={t('prices.error_load')} showIcon style={{ marginBottom: 16 }} />
      )}

      <ProTable<IPriceRow>
        rowKey="city"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
      />

      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
        {t('prices.note')}
      </Text>
    </div>
  );
}
