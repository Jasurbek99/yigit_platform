import { useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Switch, Select, Space, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useShipmentOptions,
  useCreateShipmentOption,
  useUpdateShipmentOption,
  useDeleteShipmentOption,
} from '@/hooks/useAdmin';
import type { IShipmentOptionType } from '@/types';

interface IProps {
  canWrite: boolean;
}

type Category =
  | 'vehicle_condition'
  | 'documents_status'
  | 'harvest_status'
  | 'transport_responsible';

interface IFormValues {
  code: string;
  label_tk: string;
  label_en: string | null;
  label_ru: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
}

const CATEGORIES: Category[] = [
  'vehicle_condition',
  'documents_status',
  'harvest_status',
  'transport_responsible',
];

export default function OptionListsTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<Category>('vehicle_condition');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IShipmentOptionType | null>(null);
  const [form] = Form.useForm<IFormValues>();

  const { data: options = [], isLoading } = useShipmentOptions(category);

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    form.resetFields();
  }

  const createOption = useCreateShipmentOption({
    onSuccess: () => { toast.success(t('shipment_settings.toast_created')); closeModal(); },
    onError: () => toast.error(t('shipment_settings.toast_error')),
  });
  const updateOption = useUpdateShipmentOption({
    onSuccess: () => { toast.success(t('shipment_settings.toast_updated')); closeModal(); },
    onError: () => toast.error(t('shipment_settings.toast_error')),
  });
  const deleteOption = useDeleteShipmentOption({
    onSuccess: () => toast.success(t('shipment_settings.toast_deleted')),
    onError: () => toast.error(t('shipment_settings.toast_error')),
  });

  function handleCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ sort_order: (options.length + 1) * 10, is_active: true });
    setModalOpen(true);
  }

  function handleEdit(record: IShipmentOptionType) {
    setEditTarget(record);
    form.setFieldsValue({
      code: record.code,
      label_tk: record.label_tk,
      label_en: record.label_en,
      label_ru: record.label_ru,
      icon: record.icon,
      sort_order: record.sort_order,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleDelete(id: number) {
    Modal.confirm({
      title: t('shipment_settings.confirm_delete'),
      onOk: () => deleteOption.mutate(id),
    });
  }

  function handleSubmit(values: IFormValues) {
    if (editTarget) {
      updateOption.mutate({ id: editTarget.id, ...values });
    } else {
      createOption.mutate({ ...values, category });
    }
  }

  const categoryOptions = CATEGORIES.map((cat) => ({
    value: cat,
    label: t(`shipment_settings.category_${cat}`),
  }));

  const columns = [
    {
      title: t('shipment_settings.col_code'),
      dataIndex: 'code',
      key: 'code',
      width: 160,
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t('shipment_settings.col_label_tk'),
      dataIndex: 'label_tk',
      key: 'label_tk',
    },
    {
      title: t('shipment_settings.col_label_en'),
      dataIndex: 'label_en',
      key: 'label_en',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('shipment_settings.col_label_ru'),
      dataIndex: 'label_ru',
      key: 'label_ru',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('shipment_settings.col_icon'),
      dataIndex: 'icon',
      key: 'icon',
      width: 80,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('shipment_settings.col_sort'),
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80,
      sorter: (a: IShipmentOptionType, b: IShipmentOptionType) => a.sort_order - b.sort_order,
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: t('shipment_settings.col_status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>
          {v ? t('common.active') : t('common.inactive')}
        </Tag>
      ),
    },
    ...(canWrite
      ? [
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, record: IShipmentOptionType) => (
              <Space size={4}>
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(record.id)}
                />
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <span>{t('shipment_settings.category_label')}:</span>
          <Select
            value={category}
            onChange={(v: Category) => setCategory(v)}
            options={categoryOptions}
            style={{ width: 220 }}
          />
        </Space>
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {t('shipment_settings.add')}
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        dataSource={options}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="small"
        bordered
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={editTarget ? t('shipment_settings.edit') : t('shipment_settings.add')}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createOption.isPending || updateOption.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="code"
            label={t('shipment_settings.col_code')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input disabled={editTarget !== null} placeholder={t('shipment_settings.placeholder_option_code')} />
          </Form.Item>
          <Form.Item
            name="label_tk"
            label={t('shipment_settings.col_label_tk')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="label_en" label={t('shipment_settings.col_label_en')}>
            <Input />
          </Form.Item>
          <Form.Item name="label_ru" label={t('shipment_settings.col_label_ru')}>
            <Input />
          </Form.Item>
          <Form.Item name="icon" label={t('shipment_settings.col_icon')}>
            <Input placeholder={t('shipment_settings.placeholder_option_icon')} />
          </Form.Item>
          <Form.Item name="sort_order" label={t('shipment_settings.col_sort')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {editTarget && (
            <Form.Item name="is_active" label={t('shipment_settings.col_status')} valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
