/**
 * FixedExpensesTable — pre-seeded expense table for the new SalesReportPage.
 *
 * Renders one fixed row per active IExpenseCategory from the API template.
 * Amount inputs are blank by default; saved amounts populate by merging
 * existing report.expenses (matched by category id) with the template.
 * No "Add" button — all rows come from the admin-managed template.
 * The label_raw input only appears for the 'OTHER' category.
 */
import React from 'react';
import { Input, InputNumber, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type { IExpenseCategory } from '@/types';
import type { IExpenseRow } from './salesReportUtils';
import { fmtLocal } from './salesReportUtils';

interface IFixedExpensesTableProps {
  readonly rows: IExpenseRow[];
  readonly categories: IExpenseCategory[];
  readonly canEdit: boolean;
  readonly lang: 'tk' | 'ru' | 'en';
  readonly onRowChange: (
    key: number,
    field: keyof Omit<IExpenseRow, '_key'>,
    value: unknown,
  ) => void;
}

function getCategoryLabel(cat: IExpenseCategory, lang: 'tk' | 'ru' | 'en'): string {
  if (lang === 'tk' && cat.name_tk) return cat.name_tk;
  if (lang === 'ru' && cat.name_ru) return cat.name_ru;
  if (cat.name_en) return cat.name_en;
  return cat.code;
}

export function FixedExpensesTable({
  rows,
  categories,
  canEdit,
  lang,
  onRowChange,
}: IFixedExpensesTableProps): React.ReactElement {
  const { t } = useTranslation();

  const columns: ColumnsType<IExpenseRow> = [
    {
      title: t('sales_report.col_category'),
      dataIndex: 'category_code',
      render: (_: unknown, record: IExpenseRow) => {
        const cat = categories.find((c) => c.id === record.category);
        const label = cat ? getCategoryLabel(cat, lang) : record.category_code || '—';
        return (
          <>
            <span>{label}</span>
            {(record.category_code === 'OTHER' || record.category_code === 'NAKLIYE') && (
              <div style={{ marginTop: 4 }}>
                {canEdit ? (
                  <Input
                    value={record.label_raw}
                    onChange={(e) => onRowChange(record._key, 'label_raw', e.target.value)}
                    size="small"
                    placeholder={t('sales_report.expense_note_placeholder')}
                  />
                ) : (
                  record.label_raw ? (
                    <span style={{ fontSize: 12, color: '#595959' }}>{record.label_raw}</span>
                  ) : null
                )}
              </div>
            )}
          </>
        );
      },
    },
    {
      title: t('sales_report.col_amount_local'),
      dataIndex: 'amount_local',
      width: 240,
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
  ];

  return (
    <Table<IExpenseRow>
      columns={columns}
      dataSource={rows}
      rowKey="_key"
      pagination={false}
      size="small"
      rowClassName={(record) =>
        record.amount_local == null || record.amount_local === 0 ? 'expense-row-empty' : ''
      }
    />
  );
}
