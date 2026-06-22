import React from 'react';
import { Button, Input, InputNumber, Table } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import type { ILineRow } from './salesReportUtils';
import { fmtLocal } from './salesReportUtils';

interface ILineItemsTableProps {
  readonly rows: ILineRow[];
  readonly canEdit: boolean;
  readonly onRowChange: (key: number, field: keyof Omit<ILineRow, '_key'>, value: unknown) => void;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (key: number) => void;
}

export function LineItemsTable({
  rows,
  canEdit,
  onRowChange,
  onAddRow,
  onRemoveRow,
}: ILineItemsTableProps): React.ReactElement {
  const { t } = useTranslation();

  const columns: ColumnsType<ILineRow> = [
    {
      title: t('sales_report.col_product'),
      dataIndex: 'product_name',
      render: (_: unknown, record: ILineRow) =>
        canEdit ? (
          <Input
            value={record.product_name}
            onChange={(e) => onRowChange(record._key, 'product_name', e.target.value)}
            size="small"
          />
        ) : (
          record.product_name || '—'
        ),
    },
    {
      title: t('sales_report.col_quantity_kg'),
      dataIndex: 'quantity_kg',
      width: 140,
      render: (_: unknown, record: ILineRow) =>
        canEdit ? (
          <InputNumber
            value={record.quantity_kg}
            onChange={(v) => onRowChange(record._key, 'quantity_kg', v)}
            min={0}
            precision={2}
            size="small"
            style={{ width: '100%' }}
          />
        ) : (
          record.quantity_kg != null ? fmtLocal(record.quantity_kg) : '—'
        ),
    },
    {
      title: t('sales_report.col_price_local'),
      dataIndex: 'price_local',
      width: 140,
      render: (_: unknown, record: ILineRow) =>
        canEdit ? (
          <InputNumber
            value={record.price_local}
            onChange={(v) => onRowChange(record._key, 'price_local', v)}
            min={0}
            precision={2}
            size="small"
            style={{ width: '100%' }}
          />
        ) : (
          record.price_local != null ? fmtLocal(record.price_local) : '—'
        ),
    },
    {
      title: t('sales_report.col_amount_local'),
      width: 150,
      render: (_: unknown, record: ILineRow) => {
        const amt = (record.quantity_kg ?? 0) * (record.price_local ?? 0);
        return fmtLocal(amt);
      },
    },
    ...(canEdit
      ? [
          {
            title: '',
            width: 40,
            render: (_: unknown, record: ILineRow) => (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                size="small"
                onClick={() => onRemoveRow(record._key)}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Table<ILineRow>
        columns={columns}
        dataSource={rows}
        rowKey="_key"
        pagination={false}
        size="small"
        style={{ marginBottom: 8 }}
      />
      {canEdit && (
        <Button icon={<PlusOutlined />} size="small" onClick={onAddRow}>
          {t('sales_report.add_line')}
        </Button>
      )}
    </>
  );
}
