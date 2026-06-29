import { useState } from 'react';
import { Alert, Button, Form, Modal, Space, Tag, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useExpenseCategoriesAll,
  useCreateExpenseCategory,
  useUpdateExpenseCategory,
  useDeleteExpenseCategory,
} from '@/hooks/useExpenseCategories';
import { ExpenseTemplateModal } from './ExpenseTemplateModal';
import type { IExpenseCategoryFormValues } from './ExpenseTemplateModal';
import type { IExpenseCategory } from '@/types';

const { Title, Text } = Typography;

function extractApiError(err: unknown, fallback: string): string {
  const response = (err as { response?: { data?: Record<string, unknown> } }).response;
  const data = response?.data;
  if (!data) return fallback;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.detail === 'string') return data.detail;
  return fallback;
}

export default function ExpenseTemplatePage(): JSX.Element {
  const { t } = useTranslation();
  const { data: categories = [], isLoading, isError } = useExpenseCategoriesAll();

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IExpenseCategory | null>(null);
  const [form] = Form.useForm<IExpenseCategoryFormValues>();

  const createCategory = useCreateExpenseCategory({
    onSuccess: () => {
      toast.success(t('expense_template.toast_created'));
      setModalOpen(false);
      setEditTarget(null);
      form.resetFields();
    },
    onError: (err) => {
      toast.error(extractApiError(err, t('expense_template.toast_error')));
    },
  });

  const updateCategory = useUpdateExpenseCategory({
    onSuccess: () => {
      toast.success(t('expense_template.toast_updated'));
      setModalOpen(false);
      setEditTarget(null);
      form.resetFields();
    },
    onError: (err) => {
      toast.error(extractApiError(err, t('expense_template.toast_error')));
    },
  });

  const deleteCategory = useDeleteExpenseCategory({
    onSuccess: () => toast.success(t('expense_template.toast_deleted')),
    onError: (err) => {
      toast.error(extractApiError(err, t('expense_template.toast_delete_in_use')));
    },
  });

  function handleCreate(): void {
    setEditTarget(null);
    setModalOpen(true);
  }

  function handleEdit(record: IExpenseCategory): void {
    setEditTarget(record);
    setModalOpen(true);
  }

  function handleDelete(record: IExpenseCategory): void {
    Modal.confirm({
      title: t('expense_template.confirm_delete_title'),
      content: t('expense_template.confirm_delete_body'),
      okType: 'danger',
      onOk: () => deleteCategory.mutate(record.id),
    });
  }

  function handleModalOk(): void {
    form.submit();
  }

  function handleModalCancel(): void {
    setModalOpen(false);
    setEditTarget(null);
    form.resetFields();
  }

  function handleFormFinish(values: IExpenseCategoryFormValues): void {
    const payload = {
      ...values,
      logo_code: values.logo_code || null,
    };
    if (editTarget) {
      updateCategory.mutate({ id: editTarget.id, ...payload });
    } else {
      createCategory.mutate(payload);
    }
  }

  const columns: ProColumns<IExpenseCategory>[] = [
    {
      title: t('expense_template.col_sort_order'),
      dataIndex: 'sort_order',
      width: 80,
      search: false,
      sorter: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      defaultSortOrder: 'ascend',
    },
    {
      title: t('expense_template.col_code'),
      dataIndex: 'code',
      search: false,
      sorter: (a, b) => a.code.localeCompare(b.code),
      render: (_, record) => <Text code>{record.code}</Text>,
    },
    {
      title: t('expense_template.col_name_tk'),
      dataIndex: 'name_tk',
      search: false,
      sorter: (a, b) => a.name_tk.localeCompare(b.name_tk),
    },
    {
      title: t('expense_template.col_name_ru'),
      dataIndex: 'name_ru',
      search: false,
      sorter: (a, b) => (a.name_ru || '').localeCompare(b.name_ru || ''),
    },
    {
      title: t('expense_template.col_name_en'),
      dataIndex: 'name_en',
      search: false,
      sorter: (a, b) => (a.name_en || '').localeCompare(b.name_en || ''),
    },
    {
      title: t('expense_template.col_logo_code'),
      dataIndex: 'logo_code',
      width: 130,
      search: false,
      render: (_, record) =>
        record.logo_code ? (
          <Text code>{record.logo_code}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('expense_template.col_status'),
      dataIndex: 'is_active',
      width: 100,
      search: false,
      sorter: (a, b) => {
        const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        return diff !== 0 ? diff : a.sort_order - b.sort_order;
      },
      render: (_, record) => (
        <Tag color={record.is_active ? 'green' : 'default'}>
          {record.is_active ? t('common.active') : t('common.inactive')}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      search: false,
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          />
        </Space>
      ),
    },
  ];

  if (isError) {
    return (
      <Alert
        message={t('expense_template.error_load')}
        type="error"
        style={{ marginTop: 40 }}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {t('expense_template.title')}
        </Title>
        <Text type="secondary">{t('expense_template.subtitle')}</Text>
      </div>

      <ProTable<IExpenseCategory>
        rowKey="id"
        dataSource={categories}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {t('expense_template.add')}
          </Button>,
        ]}
      />

      <ExpenseTemplateModal
        open={modalOpen}
        editTarget={editTarget}
        confirmLoading={createCategory.isPending || updateCategory.isPending}
        onOk={handleModalOk}
        onCancel={handleModalCancel}
        onFinish={handleFormFinish}
        form={form}
      />
    </div>
  );
}
