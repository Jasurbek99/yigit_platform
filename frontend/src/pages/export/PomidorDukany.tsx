import { useMemo, useState } from 'react';
import { Alert, Card, DatePicker, Flex, Segmented, Select, Statistic, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useTranslation } from 'react-i18next';
import { useSeasons } from '@/hooks/useAdmin';
import { useSelectedSeason } from '@/hooks/useSeasonParam';
import {
  useProductionAnalysis,
  type IProductionAnalysisRow,
} from '@/hooks/useProductionAnalysis';
import { COLORS } from '@/constants/styles';
import {
  achievementTone,
  formatVariance,
  resolveRange,
  type Granularity,
  type PeriodMode,
} from './PomidorDukany.helpers';

dayjs.extend(isoWeek);

const { Title, Text } = Typography;

const TONE_COLOR: Record<'good' | 'warn' | 'bad', string> = {
  good: COLORS.success,
  warn: COLORS.warning,
  bad: COLORS.danger,
};

function kg(value: number): string {
  return Math.round(value).toLocaleString();
}

/**
 * Pomidor Dükany — planned vs achieved production per greenhouse block.
 *
 * Ports the analysis the office ran in `Pomidor Dükany 2025-2026.xlsx` and that
 * sera-butce-web shows on its own screen: week / month / season period modes, a
 * cumulative-to-a-day granularity, kg/m² by planted area, and the domestic vs
 * export split. Every figure comes from data the platform already stores.
 */
export default function PomidorDukany() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<PeriodMode>('monthly');
  const [granularity, setGranularity] = useState<Granularity>('period');
  const [week, setWeek] = useState(dayjs());
  const [month, setMonth] = useState(dayjs());
  const [upTo, setUpTo] = useState(dayjs());
  const [blockIds, setBlockIds] = useState<number[]>([]);

  const { data: seasons } = useSeasons();
  const { seasonId } = useSelectedSeason();
  const season = useMemo(
    () => seasons?.find((s) => s.id === seasonId) ?? seasons?.find((s) => s.is_active),
    [seasons, seasonId],
  );

  const range = useMemo(
    () =>
      resolveRange({
        mode,
        granularity,
        week,
        month,
        seasonStart: season?.start_date ?? null,
        seasonEnd: season?.end_date ?? null,
        upTo,
      }),
    [mode, granularity, week, month, season, upTo],
  );

  const query = useProductionAnalysis({ ...range, blockIds });
  const rows = query.data?.rows ?? [];
  const totals = query.data?.totals;

  // Block options come from the payload itself: it already returns every active
  // top-level block (zero-filled when idle), so no second request is needed and
  // the filter can never offer a block the table cannot show.
  const allBlocksQuery = useProductionAnalysis(range);
  const blockOptions = useMemo(
    () =>
      (allBlocksQuery.data?.rows ?? []).map((r) => ({
        value: r.block_id,
        label: `${r.block_code} — ${r.block_name}`,
      })),
    [allBlocksQuery.data],
  );

  const columns: TableColumnsType<IProductionAnalysisRow> = [
    {
      title: t('pomidor.block'),
      dataIndex: 'block_code',
      key: 'block_code',
      fixed: 'left',
      width: 150,
      sorter: (a, b) => a.block_code.localeCompare(b.block_code),
      defaultSortOrder: 'ascend',
      render: (_: unknown, row) => (
        <div>
          <Tag color="blue">{row.block_code}</Tag>
          <div style={{ color: COLORS.textSecondary, fontSize: 11, marginTop: 2 }}>
            {row.block_name}
          </div>
        </div>
      ),
    },
    {
      title: t('pomidor.planned'),
      dataIndex: 'plan_kg',
      key: 'plan_kg',
      align: 'right',
      width: 120,
      sorter: (a, b) => a.plan_kg - b.plan_kg,
      render: (v: number) => <span style={{ color: COLORS.primary }}>{kg(v)}</span>,
    },
    {
      title: t('pomidor.achieved'),
      dataIndex: 'actual_kg',
      key: 'actual_kg',
      align: 'right',
      width: 120,
      sorter: (a, b) => a.actual_kg - b.actual_kg,
      render: (v: number) => <span style={{ color: COLORS.success }}>{kg(v)}</span>,
    },
    {
      title: t('pomidor.rollup'),
      dataIndex: 'rollup_kg',
      key: 'rollup_kg',
      align: 'right',
      width: 110,
      responsive: ['xl'],
      sorter: (a, b) => a.rollup_kg - b.rollup_kg,
      // Diagnostic, not a headline figure: `rollup_days === 0` means the nightly
      // job never ran for these days, which is a different thing from a real zero.
      render: (v: number, row) =>
        row.rollup_days === 0 ? (
          <span style={{ color: COLORS.textMuted }} title={t('pomidor.rollup_never')}>
            —
          </span>
        ) : (
          <span style={{ color: COLORS.textMuted }}>{kg(v)}</span>
        ),
    },
    {
      title: t('pomidor.variance'),
      dataIndex: 'variance_kg',
      key: 'variance_kg',
      align: 'right',
      width: 110,
      sorter: (a, b) => a.variance_kg - b.variance_kg,
      render: (v: number) => (
        <span style={{ color: v >= 0 ? COLORS.success : COLORS.danger }}>{formatVariance(v)}</span>
      ),
    },
    {
      title: t('pomidor.achievement_pct'),
      dataIndex: 'achievement_pct',
      key: 'achievement_pct',
      align: 'right',
      width: 100,
      sorter: (a, b) => a.achievement_pct - b.achievement_pct,
      render: (v: number) => (
        <span style={{ color: TONE_COLOR[achievementTone(v)], fontWeight: 600 }}>{v}%</span>
      ),
    },
    {
      title: t('pomidor.area_m2'),
      dataIndex: 'area_m2',
      key: 'area_m2',
      align: 'right',
      width: 110,
      responsive: ['lg'],
      sorter: (a, b) => (a.area_m2 ?? 0) - (b.area_m2 ?? 0),
      render: (v: number | null) =>
        v == null ? <span style={{ color: COLORS.textMuted }}>—</span> : v.toLocaleString(),
    },
    {
      title: t('pomidor.plan_per_m2'),
      dataIndex: 'plan_kg_per_m2',
      key: 'plan_kg_per_m2',
      align: 'right',
      width: 110,
      responsive: ['lg'],
      sorter: (a, b) => a.plan_kg_per_m2 - b.plan_kg_per_m2,
      render: (v: number) => <span style={{ color: COLORS.primary }}>{v.toFixed(2)}</span>,
    },
    {
      title: t('pomidor.actual_per_m2'),
      dataIndex: 'actual_kg_per_m2',
      key: 'actual_kg_per_m2',
      align: 'right',
      width: 110,
      responsive: ['lg'],
      sorter: (a, b) => a.actual_kg_per_m2 - b.actual_kg_per_m2,
      render: (v: number) => <span style={{ color: COLORS.success }}>{v.toFixed(2)}</span>,
    },
    {
      title: t('pomidor.domestic'),
      dataIndex: 'domestic_kg',
      key: 'domestic_kg',
      align: 'right',
      width: 130,
      responsive: ['md'],
      sorter: (a, b) => a.domestic_kg - b.domestic_kg,
      render: (v: number, row) => (
        <div>
          {kg(v)}
          <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{row.domestic_pct}%</div>
        </div>
      ),
    },
    {
      title: t('pomidor.export'),
      dataIndex: 'export_kg',
      key: 'export_kg',
      align: 'right',
      width: 130,
      responsive: ['md'],
      sorter: (a, b) => a.export_kg - b.export_kg,
      render: (v: number, row) => (
        <div>
          {kg(v)}
          <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{row.export_pct}%</div>
        </div>
      ),
    },
  ];

  return (
    <div>
      <Flex justify="space-between" align="flex-start" wrap gap={12} style={{ marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('pomidor.title')}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('pomidor.subtitle')} · {range.dateFrom} → {range.dateTo} · {t('pomidor.achieved_hint')}
          </Text>
        </div>
        {totals && (
          <Statistic
            title={t('pomidor.total_achievement')}
            value={totals.achievement_pct}
            suffix="%"
            styles={{
              content: {
                color: TONE_COLOR[achievementTone(totals.achievement_pct)],
                fontSize: 24,
              },
            }}
          />
        )}
      </Flex>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Flex gap={12} wrap align="center">
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as PeriodMode)}
            options={[
              { value: 'weekly', label: t('pomidor.mode_weekly') },
              { value: 'monthly', label: t('pomidor.mode_monthly') },
              { value: 'seasonal', label: t('pomidor.mode_seasonal') },
            ]}
          />
          <Segmented
            value={granularity}
            onChange={(v) => setGranularity(v as Granularity)}
            options={[
              { value: 'period', label: t('pomidor.gran_period') },
              { value: 'cumulative', label: t('pomidor.gran_cumulative') },
            ]}
          />
          {mode === 'weekly' && (
            <DatePicker
              picker="week"
              value={week}
              onChange={(d) => d && setWeek(d)}
              allowClear={false}
              style={{ width: 180 }}
            />
          )}
          {mode === 'monthly' && (
            <DatePicker
              picker="month"
              value={month}
              onChange={(d) => d && setMonth(d)}
              allowClear={false}
              style={{ width: 160 }}
            />
          )}
          {granularity === 'cumulative' && (
            <DatePicker
              value={upTo}
              onChange={(d) => d && setUpTo(d)}
              allowClear={false}
              style={{ width: 160 }}
              placeholder={t('pomidor.up_to')}
            />
          )}
          <Select
            mode="multiple"
            allowClear
            value={blockIds}
            onChange={setBlockIds}
            options={blockOptions}
            placeholder={t('pomidor.all_blocks')}
            style={{ minWidth: 220, flex: 1 }}
            maxTagCount="responsive"
          />
        </Flex>
      </Card>

      {query.isError && (
        <Alert type="error" message={t('pomidor.error_load')} style={{ marginBottom: 16 }} />
      )}

      <Table<IProductionAnalysisRow>
          rowKey="block_id"
          columns={columns}
          dataSource={rows}
          loading={query.isLoading}
          pagination={false}
          size="small"
          scroll={{ x: 1250 }}
          summary={() =>
            totals ? (
              <Table.Summary.Row style={{ fontWeight: 600, background: COLORS.bgLight }}>
                <Table.Summary.Cell index={0}>{t('pomidor.total')}</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <span style={{ color: COLORS.primary }}>{kg(totals.plan_kg)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">
                  <span style={{ color: COLORS.success }}>{kg(totals.actual_kg)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">
                  <span style={{ color: COLORS.textMuted }}>{kg(totals.rollup_kg)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right">
                  <span
                    style={{
                      color: totals.variance_kg >= 0 ? COLORS.success : COLORS.danger,
                    }}
                  >
                    {formatVariance(totals.variance_kg)}
                  </span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">
                  <span style={{ color: TONE_COLOR[achievementTone(totals.achievement_pct)] }}>
                    {totals.achievement_pct}%
                  </span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">
                  {totals.area_m2 == null ? '—' : totals.area_m2.toLocaleString()}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right">
                  {totals.plan_kg_per_m2.toFixed(2)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right">
                  {totals.actual_kg_per_m2.toFixed(2)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={9} align="right">
                  {kg(totals.domestic_kg)}
                </Table.Summary.Cell>
                <Table.Summary.Cell index={10} align="right">
                  {kg(totals.export_kg)}
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
    </div>
  );
}
