import { useState } from 'react';
import { Table, Segmented, Skeleton, Alert, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { usePriceEntries } from '@/hooks/usePlanning';
import type { IPriceEntry } from '@/types';

type DaysRange = 7 | 14 | 30;

export default function PricePanel() {
  const { t } = useTranslation();
  const [days, setDays] = useState<DaysRange>(7);
  const { data: entries, isLoading, isError } = usePriceEntries(days);

  // Group by city, pivot to date columns
  const cities = [...new Set((entries ?? []).map((e) => e.city_name))].sort();
  const dates = [...new Set((entries ?? []).map((e) => e.date))].sort().reverse().slice(0, days);

  // Build a map: city_name → date → entry
  const priceMap: Record<string, Record<string, IPriceEntry>> = {};
  (entries ?? []).forEach((e) => {
    if (!priceMap[e.city_name]) priceMap[e.city_name] = {};
    priceMap[e.city_name][e.date] = e;
  });

  // Trend: compare today vs yesterday for each city
  function trend(city: string): 'up' | 'down' | 'flat' {
    if (dates.length < 2) return 'flat';
    const today = priceMap[city]?.[dates[0]]?.price_usd;
    const yesterday = priceMap[city]?.[dates[1]]?.price_usd;
    if (today == null || yesterday == null) return 'flat';
    if (today > yesterday) return 'up';
    if (today < yesterday) return 'down';
    return 'flat';
  }

  const columns = [
    {
      title: t('prices.city'),
      dataIndex: 'city',
      fixed: 'left' as const,
      width: 120,
      render: (city: string) => {
        const dir = trend(city);
        return (
          <span>
            {city}{' '}
            {dir === 'up' && <Tag color="error" style={{ fontSize: 10 }}>↑</Tag>}
            {dir === 'down' && <Tag color="success" style={{ fontSize: 10 }}>↓</Tag>}
          </span>
        );
      },
    },
    ...dates.map((date) => ({
      title: dayjs(date).format('DD.MM'),
      key: date,
      width: 90,
      align: 'right' as const,
      render: (_: unknown, row: { city: string }) => {
        const entry = priceMap[row.city]?.[date];
        if (!entry) return <span style={{ color: '#bfbfbf' }}>—</span>;
        return (
          <span>
            <span style={{ fontWeight: 500 }}>${entry.price_usd?.toFixed(2)}</span>
            {entry.price_local != null && (
              <span style={{ color: '#8c8c8c', fontSize: 11, marginLeft: 4 }}>
                {Number(entry.price_local).toLocaleString()} {entry.currency}
              </span>
            )}
          </span>
        );
      },
    })),
  ];

  const tableData = cities.map((city) => ({ city, key: city }));

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3' }}>
            {t('prices.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Ugurlar boýunça bahalar paneli
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Segmented
            options={[
              { label: t('prices.days_7'), value: 7 },
              { label: t('prices.days_14'), value: 14 },
              { label: t('prices.days_30'), value: 30 },
            ]}
            value={days}
            onChange={(v) => setDays(v as DaysRange)}
          />
        </div>
      </div>

      {isError && <Alert type="error" message={t('prices.error_load')} style={{ marginBottom: 16 }} />}

      {isLoading ? (
        <Skeleton active />
      ) : (
        <Table
          rowKey="city"
          dataSource={tableData}
          columns={columns}
          pagination={false}
          scroll={{ x: 600 }}
          size="small"
          bordered
        />
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 12, display: 'block' }}>
        {t('prices.note')}
      </Typography.Text>
    </div>
  );
}
