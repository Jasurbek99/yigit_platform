import React from 'react';
import { Button, Input, InputNumber, Select, Table } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { useExpenseCategories } from '@/hooks/useExpenseCategories';
import type { IExpenseRow } from './salesReportUtils';
import { fmtLocal } from './salesReportUtils';

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
  const { t, i18n } = useTranslation();
  const { data: categories = [] } = useExpenseCategories();

  // Build Select options from API template
  const catOptions = categories.map((c) => ({
    value: c.id,
    label:
      i18n.language === 'tk' && c.name_tk
        ? c.name_tk
        : i18n.language === 'ru' && c.name_ru
        ? c.name_ru
        : c.name_en || c.code,
  }));

  const columns: ColumnsType<IExpenseRow> = [
    {
      title: t('sales_report.col_category'),
      dataIndex: 'category_code',
      render: (_: unknown, record: IExpenseRow) => {
        // When editing and no category selected yet (new row), show a Select picker
        if (canEdit && record.category === null) {
          return (
            <Select
              size="small"
              style={{ width: '100%' }}
              placeholder={t('sales_report.col_category')}
              options={catOptions}
              onChange={(v: number) => {
                const picked = categories.find((c) => c.id === v);
                onRowChange(record._key, 'category', v);
                onRowChange(record._key, 'category_code', picked?.code ?? '');
              }}
              showSearch
              optionFilterProp="label"
            />
          );
        }
        // Saved / already-picked row: show label from i18n key
        const label = record.category_code
          ? t(`sales_report.expense.${record.category_code}`, { defaultValue: record.category_code })
          : '—';
        return (
          <>
            <span>{label}</span>
            {record.category_code === 'OTHER' && canEdit && (
              <Input
                value={record.label_raw}
                onChange={(e) => onRowChange(record._key, 'label_raw', e.target.value)}
                size="small"
                placeholder={t('sales_report.other_label_placeholder')}
                style={{ marginTop: 4 }}
              />
            )}
            {record.category_code === 'OTHER' && !canEdit && record.label_raw && (
              <div style={{ fontSize: 12, color: '#595959' }}>{record.label_raw}</div>
            )}
          </>
        );
      },
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
