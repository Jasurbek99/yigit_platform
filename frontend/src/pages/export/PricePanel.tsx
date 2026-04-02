import { useState } from 'react';
import { Alert, Badge, Group, SegmentedControl, Skeleton, Table, Text } from '@mantine/core';
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

  return (
    <div>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3' }}>
            {t('prices.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Ugurlar boýunça bahalar paneli
          </div>
        </div>
        <SegmentedControl
          data={[
            { label: t('prices.days_7'), value: '7' },
            { label: t('prices.days_14'), value: '14' },
            { label: t('prices.days_30'), value: '30' },
          ]}
          value={String(days)}
          onChange={(v) => setDays(Number(v) as DaysRange)}
        />
      </Group>

      {isError && <Alert color="red" mb="md">{t('prices.error_load')}</Alert>}

      {isLoading ? (
        <Skeleton height={300} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <Table striped withColumnBorders withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ minWidth: 120 }}>{t('prices.city')}</Table.Th>
                {dates.map((date) => (
                  <Table.Th key={date} style={{ textAlign: 'right', minWidth: 90 }}>
                    {dayjs(date).format('DD.MM')}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cities.map((city) => {
                const dir = trend(city);
                return (
                  <Table.Tr key={city}>
                    <Table.Td>
                      <span>
                        {city}{' '}
                        {dir === 'up' && <Badge color="red" size="xs">↑</Badge>}
                        {dir === 'down' && <Badge color="green" size="xs">↓</Badge>}
                      </span>
                    </Table.Td>
                    {dates.map((date) => {
                      const entry = priceMap[city]?.[date];
                      if (!entry) {
                        return (
                          <Table.Td key={date} style={{ textAlign: 'right', color: '#bfbfbf' }}>
                            —
                          </Table.Td>
                        );
                      }
                      return (
                        <Table.Td key={date} style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: 500 }}>${entry.price_usd?.toFixed(2)}</span>
                          {entry.price_local != null && (
                            <span style={{ color: '#8c8c8c', fontSize: 11, marginLeft: 4 }}>
                              {Number(entry.price_local).toLocaleString()} {entry.currency}
                            </span>
                          )}
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </div>
      )}

      <Text c="dimmed" size="xs" mt="sm">
        {t('prices.note')}
      </Text>
    </div>
  );
}
