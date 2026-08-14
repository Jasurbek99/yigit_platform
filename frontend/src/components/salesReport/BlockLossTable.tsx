import React, { useMemo } from 'react';
import { Table } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import type { IBlockSource } from '@/types';
import { fmtLocal } from './salesReportUtils';

interface IBlockLossRow {
  block_code: string;
  weight_kg: number;
  loss_kg: number;
}

interface IBlockLossTableProps {
  readonly blockSources: IBlockSource[];
  readonly rejectedKg: number;
}

export function BlockLossTable({
  blockSources,
  rejectedKg,
}: IBlockLossTableProps): React.ReactElement {
  const { t } = useTranslation();

  const rows: IBlockLossRow[] = useMemo(() => {
    const total = blockSources.reduce((s, b) => s + Number(b.weight_kg ?? 0), 0);
    return blockSources.map((b) => {
      const weightKg = Number(b.weight_kg ?? 0);
      return {
        block_code: b.block_code,
        weight_kg: weightKg,
        loss_kg: total > 0 ? (weightKg / total) * Math.max(rejectedKg, 0) : 0,
      };
    });
  }, [blockSources, rejectedKg]);

  const columns: ColumnsType<IBlockLossRow> = [
    {
      title: t('sales_report.processing_block_code'),
      dataIndex: 'block_code',
      width: 100,
    },
    {
      title: t('sales_report.processing_block_weight'),
      dataIndex: 'weight_kg',
      render: (v: number) => fmtLocal(v),
    },
    {
      title: t('sales_report.processing_block_loss'),
      dataIndex: 'loss_kg',
      render: (v: number) => fmtLocal(v),
    },
  ];

  return (
    <Table<IBlockLossRow>
      dataSource={rows}
      columns={columns}
      rowKey="block_code"
      pagination={false}
      size="small"
    />
  );
}
