import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import dayjs, { type Dayjs } from 'dayjs';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useCustomsExpenses, useDeleteCustomsExpense } from '@/hooks/useCustomsExpenses';
import { CUSTOMS_EXPENSE_CATEGORIES } from '@/types';
import type { ICustomsExpense, CustomsExpenseCategory } from '@/types';
import { CustomsExpenseModal } from './CustomsExpenseModal';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

/** Roles allowed to create/update/delete customs expenses. */
const CAN_WRITE_ROLES = new Set([
  'finansist',
  'admin',
  'director',
  'document_team',
  'export_manager',
]);

interface ICustomsExpensesTabProps {
  canWrite: boolean;
  dateFrom: Dayjs | null;
  dateTo: Dayjs | null;
}

export function CustomsExpensesTab({
  canWrite,
  dateFrom,
  dateTo,
}: ICustomsExpensesTabProps): React.ReactElement {
  const { t } = useTranslation();

  const [categoryFilter, setCategoryFilter] = useState<CustomsExpenseCategory | ''>('');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ICustomsExpense | null>(null);

  const filters = {
    category: categoryFilter || undefined,
    date_from: dateFrom ? dateFrom.format('YYYY-MM-DD') : undefined,
    date_to: dateTo ? dateTo.format('YYYY-MM-DD') : undefined,
    search: search || undefined,
  };

  const { data, isLoading } = useCustomsExpenses(filters);
  const deleteExpense = useDeleteCustomsExpense();

  const expenses = data?.results ?? [];

  function handleEdit(record: ICustomsExpense): void {
    setEditTarget(record);
  }

  function handleDelete(record: ICustomsExpense): void {
    Modal.confirm({
      title: t('customs_expense.confirm_delete'),
      okType: 'danger',
      onOk: () => {
        deleteExpense.mutate(record.id, {
          onSuccess: () => toast.success(t('customs_expense.delete_success')),
          onError: () => toast.error(t('customs_expense.error_delete')),
        });
      },
    });
  }

  function handleModalClose(): void {
    setAddOpen(false);
    setEditTarget(null);
  }

  const categoryOptions = CUSTOMS_EXPENSE_CATEGORIES.map((code) => ({
    value: code,
    label: t(`customs_expense.category.${code}`),
  }));

  const columns: ProColumns<ICustomsExpense>[] = [
    {
      title: t('customs_expense.col_date'),
      dataIndex: 'expense_date',
      width: 110,
      search: false,
      sorter: (a, b) => a.expense_date.localeCompare(b.expense_date),
      defaultSortOrder: 'descend',
      render: (_, record) => dayjs(record.expense_date).format('DD.MM.YYYY'),
    },
    {
      title: t('customs_expense.col_category'),
      dataIndex: 'category',
      width: 200,
      search: false,
      render: (_, record) => (
        <Tag color="blue">
          {t(`customs_expense.category.${record.category}`, {
            defaultValue: record.category_display,
          })}
        </Tag>
      ),
    },
    {
      title: t('customs_expense.col_amount'),
      dataIndex: 'amount',
      width: 140,
      search: false,
      align: 'right',
      sorter: (a, b) => Number(a.amount) - Number(b.amount),
      render: (_, record) => (
        <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {Number(record.amount).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} TMT
        </Text>
      ),
    },
    {
      title: t('customs_expense.col_shipment'),
      dataIndex: 'shipment_code',
      width: 150,
      search: false,
      responsive: ['md'],
      render: (_, record) => {
        if (record.shipment && record.shipment_code) {
          return (
            <Link to={`/export/shipments/${record.shipment}`}>
              {record.shipment_code}
            </Link>
          );
        }
        if (record.shipment_code_raw) {
          return <Text type="secondary">{record.shipment_code_raw}</Text>;
        }
        return <Text type="secondary">—</Text>;
      },
    },
    {
      title: t('customs_expense.col_vehicle_plate'),
      dataIndex: 'vehicle_plate',
      width: 130,
      search: false,
      responsive: ['md'],
      render: (_, record) => record.vehicle_plate ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('customs_expense.col_route'),
      dataIndex: 'route_label',
      search: false,
      responsive: ['lg'],
      render: (_, record) => record.route_label ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('customs_expense.col_quantity'),
      dataIndex: 'quantity',
      width: 80,
      search: false,
      responsive: ['lg'],
      align: 'right',
      render: (_, record) =>
        record.quantity != null ? record.quantity : <Text type="secondary">—</Text>,
    },
    {
      title: t('customs_expense.col_notes'),
      dataIndex: 'notes',
      search: false,
      responsive: ['lg'],
      render: (_, record) => record.notes ?? <Text type="secondary">—</Text>,
    },
    ...(canWrite
      ? [
          {
            title: '',
            key: 'actions',
            width: 80,
            search: false,
            render: (_: unknown, record: ICustomsExpense) => (
              <Space size={4}>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined style={{ color: COLORS.primary }} />}
                  onClick={() => handleEdit(record)}
                />
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(record)}
                />
              </Space>
            ),
          } as ProColumns<ICustomsExpense>,
        ]
      : []),
  ];

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select<CustomsExpenseCategory | ''>
            value={categoryFilter}
            onChange={setCategoryFilter}
            allowClear
            placeholder={t('customs_expense.filter_category')}
            options={[{ value: '', label: t('common.all') }, ...categoryOptions]}
            style={{ minWidth: 220 }}
          />
          <Input.Search
            placeholder={t('customs_expense.search_placeholder')}
            onSearch={(v) => setSearch(v)}
            onChange={(e) => { if (!e.target.value) setSearch(''); }}
            allowClear
            style={{ width: 240 }}
          />
          {canWrite && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddOpen(true)}
            >
              {t('customs_expense.add')}
            </Button>
          )}
        </Space>
      </div>

      <ProTable<ICustomsExpense>
        rowKey="id"
        dataSource={expenses}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        size="small"
        locale={{ emptyText: t('customs_expense.empty') }}
      />

      <CustomsExpenseModal
        open={addOpen || editTarget !== null}
        onClose={handleModalClose}
        editTarget={editTarget}
      />
    </>
  );
}

// Re-export the role set so AdvancesTracker can reference it without duplication
export { CAN_WRITE_ROLES as CUSTOMS_EXPENSE_WRITE_ROLES };
