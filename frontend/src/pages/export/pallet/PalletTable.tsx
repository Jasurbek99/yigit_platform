import { InputNumber, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { useTranslation } from 'react-i18next';
import { CrateTypeSelect } from '@/components/CrateTypeSelect';
import { VarietySelect } from '@/components/VarietySelect';
import { computeNet, type IEditableRow } from './palletHelpers';

interface IPalletTableProps {
  rows: IEditableRow[];
  crateWeightMap: Record<number, number>;
  onChangeRow: (key: number, field: keyof IEditableRow, value: unknown) => void;
}

export function PalletTable({ rows, crateWeightMap, onChangeRow }: IPalletTableProps) {
  const { t } = useTranslation();

  const columns: TableColumnsType<IEditableRow> = [
    {
      title: t('pallet.col_number'),
      dataIndex: 'pallet_number',
      width: 56,
      fixed: 'left' as const,
      render: (v: number) => <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</span>,
    },
    {
      title: t('pallet.col_crate_type'),
      dataIndex: 'crate_type',
      width: 190,
      render: (v: number, record) => (
        <CrateTypeSelect
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'crate_type', newVal)}
          size="small"
          style={{ width: 175 }}
        />
      ),
    },
    {
      title: t('pallet.col_gross'),
      dataIndex: 'gross_weight_kg',
      width: 100,
      render: (v: number, record) => (
        <InputNumber
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'gross_weight_kg', newVal ?? 0)}
          size="small"
          style={{ width: 88 }}
          precision={2}
          min={0}
        />
      ),
    },
    {
      title: t('pallet.col_count'),
      dataIndex: 'crate_count',
      width: 80,
      render: (v: number, record) => (
        <InputNumber
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'crate_count', newVal ?? 0)}
          size="small"
          style={{ width: 68 }}
          precision={0}
          min={0}
        />
      ),
    },
    {
      title: t('pallet.col_crate_weight'),
      dataIndex: 'crate_type',
      key: 'crate_weight_auto',
      width: 80,
      render: (v: number, record) => {
        const cw = crateWeightMap[v] ?? 0;
        return (
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8c8c8c' }}>
            {(cw * record.crate_count).toFixed(2)}
          </span>
        );
      },
    },
    {
      title: t('pallet.col_pallet_kg'),
      dataIndex: 'pallet_weight_kg',
      width: 80,
      render: (v: number, record) => (
        <InputNumber
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'pallet_weight_kg', newVal ?? 0)}
          size="small"
          style={{ width: 68 }}
          precision={2}
          min={0}
        />
      ),
    },
    {
      title: t('pallet.col_additions'),
      dataIndex: 'additions_kg',
      width: 80,
      render: (v: number, record) => (
        <InputNumber
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'additions_kg', newVal ?? 0)}
          size="small"
          style={{ width: 68 }}
          precision={2}
          min={0}
        />
      ),
    },
    {
      title: t('pallet.col_net'),
      key: 'net',
      width: 90,
      render: (_: unknown, record) => {
        const cw = crateWeightMap[record.crate_type] ?? 0;
        const net = computeNet(
          Number(record.gross_weight_kg),
          cw,
          record.crate_count,
          Number(record.pallet_weight_kg),
          Number(record.additions_kg),
        );
        return (
          <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#389e0d' }}>
            {net.toFixed(2)}
          </span>
        );
      },
    },
    {
      title: t('pallet.col_variety'),
      dataIndex: 'variety',
      width: 160,
      render: (v: number, record) => (
        <VarietySelect
          value={v}
          onChange={(newVal) => onChangeRow(record.key, 'variety', newVal)}
          size="small"
          style={{ width: 148 }}
        />
      ),
    },
    {
      title: t('pallet.col_sub_block'),
      dataIndex: 'sub_block_code',
      width: 80,
      render: (v: string) => <Tag>{v}</Tag>,
    },
  ];

  return (
    <Table<IEditableRow>
      dataSource={rows}
      columns={columns}
      rowKey="key"
      size="small"
      pagination={false}
      scroll={{ x: 1050 }}
      bordered
    />
  );
}
