import { useState } from 'react';
import { Button, Card, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { CustomsExpenseModal } from '@/components/customsExpense/CustomsExpenseModal';
import { fmtDate } from '@/pages/export/ShipmentDetailHelpers.helpers';
import type { TableColumnsType } from 'antd';
import type { ICustomsExpense, IShipmentDetail } from '@/types';

interface IShipmentCustomsExpensesCardProps {
  shipment: IShipmentDetail;
  canWrite: boolean;
}

const money = (value: number): string =>
  `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} TMT`;

/**
 * Per-shipment customs / document cash-advance expenses, with the running
 * total in the table footer. Batch fees (shipment=null) are not nested on the
 * detail payload and so never appear here.
 */
export function ShipmentCustomsExpensesCard({
  shipment,
  canWrite,
}: IShipmentCustomsExpensesCardProps) {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const expenses = shipment.customs_expenses ?? [];

  const columns: TableColumnsType<ICustomsExpense> = [
    {
      title: t('customs_expense.col_date'),
      dataIndex: 'expense_date',
      width: 110,
      render: (v: string) => fmtDate(v),
    },
    {
      title: t('customs_expense.col_category'),
      dataIndex: 'category',
      render: (_: unknown, row: ICustomsExpense) => (
        <Tag color="blue">
          {t(`customs_expense.category.${row.category}`, { defaultValue: row.category_display })}
        </Tag>
      ),
    },
    {
      title: t('customs_expense.col_amount'),
      dataIndex: 'amount',
      align: 'right',
      render: (v: string) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {money(Number(v))}
        </span>
      ),
    },
    {
      title: t('customs_expense.col_label'),
      dataIndex: 'label_raw',
      responsive: ['md'],
      render: (_: unknown, row: ICustomsExpense) =>
        row.label_raw ?? row.notes ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title={
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {t('customs_expense.detail_section_title')}
        </span>
      }
      extra={
        canWrite ? (
          <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
            {t('customs_expense.detail_add_expense')}
          </Button>
        ) : null
      }
    >
      {expenses.length > 0 ? (
        <Table<ICustomsExpense>
          rowKey="id"
          dataSource={expenses}
          size="small"
          pagination={false}
          columns={columns}
          footer={() => (
            <div style={{ textAlign: 'right', fontWeight: 700, padding: '4px 0' }}>
              {t('customs_expense.total_label')}:{' '}
              {money(expenses.reduce((sum, e) => sum + Number(e.amount), 0))}
            </div>
          )}
        />
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {t('customs_expense.detail_no_expenses')}
        </Typography.Text>
      )}

      <CustomsExpenseModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        editTarget={null}
        prefilledShipmentId={shipment.id}
        prefilledExportCode={shipment.export_code}
      />
    </Card>
  );
}
