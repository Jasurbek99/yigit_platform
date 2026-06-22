import React from 'react';
import { Button, Input, InputNumber, Select, Table } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import type { SalesReportExpenseCategory } from '@/types';
import type { IExpenseRow } from './salesReportUtils';
import { EXPENSE_CATEGORIES, fmtLocal } from './salesReportUtils';

interface IExpensesTableProps {
  readonly rows: IExpenseRow[];
  readonly canEdit: boolean;
  readonly onRowChange: (
    key: number,
    field: keyof Omit<IExpenseRow, '_key'>,
    value: unknown,
  ) => void;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (key: number) => void;
}

export function ExpensesTable({
  rows,
  canEdit,
  onRowChange,
  onAddRow,
  onRemoveRow,
}: IExpensesTableProps): React.ReactElement {
  const { t } = useTranslation();

  const categoryOptions = EXPENSE_CATEGORIES.map((code) => ({
    value: code,
    label: t(`sales_report.expense.${code}`),
  }));

  const columns: ColumnsType<IExpenseRow> = [
    {
      title: t('sales_report.col_category'),
      dataIndex: 'category',
      render: (_: unknown, record: IExpenseRow) =>
        canEdit ? (
          <>
            <Select<SalesReportExpenseCategory>
              value={record.category ?? undefined}
              onChange={(v) => onRowChange(record._key, 'category', v)}
              options={categoryOptions}
              showSearch
              size="small"
              style={{ width: '100%', marginBottom: record.category === 'OTHER' ? 4 : 0 }}
              placeholder={t('common.select')}
            />
            {record.category === 'OTHER' && (
              <Input
                value={record.label_raw}
                onChange={(e) => onRowChange(record._key, 'label_raw', e.target.value)}
                size="small"
                placeholder={t('sales_report.other_label_placeholder')}
              />
            )}
          </>
        ) : (
          record.category
            ? record.category === 'OTHER' && record.label_raw
              ? record.label_raw
              : t(`sales_report.expense.${record.category}`)
            : '—'
        ),
    },
    {
      title: t('sales_report.col_amount_local'),
      dataIndex: 'amount_local',
      width: 160,
      render: (_: unknown, record: IExpenseRow) =>
        canEdit ? (
          <InputNumber
            value={record.amount_local}
            onChange={(v) => onRowChange(record._key, 'amount_local', v)}
            min={0}
            precision={2}
            size="small"
            style={{ width: '100%' }}
          />
        ) : (
          record.amount_local != null ? fmtLocal(record.amount_local) : '—'
        ),
    },
    ...(canEdit
      ? [
          {
            title: '',
            width: 40,
            render: (_: unknown, record: IExpenseRow) => (
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
      <Table<IExpenseRow>
        columns={columns}
        dataSource={rows}
        rowKey="_key"
        pagination={false}
        size="small"
        style={{ marginBottom: 8 }}
      />
      {canEdit && (
        <Button icon={<PlusOutlined />} size="small" onClick={onAddRow}>
          {t('sales_report.add_expense')}
        </Button>
      )}
    </>
  );
}
