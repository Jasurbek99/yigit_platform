import { useMemo } from 'react';
import { Card, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { useBlockBreakdown } from '@/hooks/usePallets';
import type { IBlockBreakdownRow } from '@/types';

const { Text } = Typography;

interface IBlockBreakdownCardProps {
  readonly shipmentId: number;
}

function fmt(kg: string | number): string {
  return Number(kg).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Per (parent block × variety) net-weight breakdown from the saved pallet
 * manifest — sub-blocks F1/F2 summed into F. This is the data that flows into
 * the sales report's block section (e.g. "MIDELICE, block F, 9143 kg").
 */
export function BlockBreakdownCard({ shipmentId }: IBlockBreakdownCardProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useBlockBreakdown(shipmentId);

  const rows = data?.rows ?? [];

  // Which block codes have >1 row — used to render the block cell only once.
  const firstRowByBlock = useMemo(() => {
    const seen = new Set<string>();
    return rows.map((r) => {
      const first = !seen.has(r.block_code);
      seen.add(r.block_code);
      return first;
    });
  }, [rows]);

  const columns: ColumnsType<IBlockBreakdownRow> = [
    {
      title: t('pallet.bb_block'),
      dataIndex: 'block_code',
      render: (code: string, _row, index) =>
        firstRowByBlock[index] ? <Text strong>{code}</Text> : '',
    },
    { title: t('pallet.bb_variety'), dataIndex: 'variety_name' },
    {
      title: t('pallet.bb_weight'),
      dataIndex: 'weight_kg',
      align: 'right',
      render: (kg: string) => `${fmt(kg)} kg`,
    },
  ];

  if (!isLoading && rows.length === 0) return null;

  return (
    <Card title={t('pallet.block_breakdown_title')} style={{ marginTop: 14 }} loading={isLoading}>
      <Table<IBlockBreakdownRow>
        size="small"
        pagination={false}
        rowKey={(r) => `${r.block_id}-${r.variety_id}`}
        columns={columns}
        dataSource={rows}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={2}>
              <Text strong>{t('pallet.bb_total')}</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <Text strong>{fmt(data?.total_net_kg ?? 0)} kg</Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </Card>
  );
}
