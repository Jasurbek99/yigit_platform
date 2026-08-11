import { useTranslation } from 'react-i18next';
import { Card, Skeleton, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { BossPeriod } from '@/hooks/useBossDashboard';
import { useBossExportMarket, useBossProduction } from '@/hooks/useBossDashboard';
import { mergeBlockRows, sumTotals } from './BlocksTable.helpers';
import { BlockRow, ColumnHeaderRow, GroupHeaderRow, TotalRow } from './BlocksTableRows';

// CRITICAL: The export columns intentionally show ONLY Daşarky Bazar (export market).
// Içerki Bazar (domestic) and Sowgatlyk (gift) are explicitly excluded from v1.
// Do not add columns, fields, or keys for domestic or gift data here.
//
// The four column groups cover DIFFERENT time windows, and only two of them follow
// the period switcher: Günlük is always today and Aýlyk is always the current
// calendar month (both fixed inside _aggregate_production), while Möwsümleýin and
// the export columns honour the selected period. The group headers are what keeps
// that honest now the four sit on one row — do not drop them.

const { Text } = Typography;

interface IBlocksTableProps {
  period: BossPeriod;
}

export function BlocksTable({ period }: IBlocksTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: daily, isLoading: dailyLoading } = useBossProduction(period, 'daily');
  const { data: seasonal, isLoading: seasonalLoading } = useBossProduction(period, 'seasonal');
  const { data: market, isLoading: marketLoading } = useBossExportMarket(period);

  const rows = mergeBlockRows(daily?.rows ?? [], seasonal?.rows ?? [], market?.rows ?? []);
  const totals = sumTotals(rows);
  const isLoading = dailyLoading || seasonalLoading || marketLoading;

  return (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 14 }}>{t('boss_dashboard.section.blocks_table')}</Text>}
      style={{ borderRadius: 8, border: '1px solid #f0f0f0', marginBottom: 16 }}
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, overflowX: 'auto' }}>
            <div style={{ minWidth: 900 }}>
              <GroupHeaderRow />
              <ColumnHeaderRow />
              {rows.map((row) => (
                <BlockRow
                  key={row.block_code}
                  row={row}
                  onHarvestClick={() => navigate(`/export/plan?block=${row.block_code}`)}
                  onExportClick={() => navigate(`/export/shipments?block_source=${row.block_code}`)}
                />
              ))}
              {rows.length > 0 && <TotalRow totals={totals} />}
            </div>
            {rows.length === 0 && (
              <div style={{ padding: '12px 14px' }}>
                <Text type="secondary" style={{ fontSize: 13 }}>{t('boss_dashboard.no_data')}</Text>
              </div>
            )}
          </div>

          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }}>
              {t('boss_dashboard.export_market.note_excluded')}
            </Text>
          </div>
        </>
      )}
    </Card>
  );
}
