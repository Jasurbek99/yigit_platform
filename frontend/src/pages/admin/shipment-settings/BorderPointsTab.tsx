import { useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Switch, Space, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  useBorderPoints,
  useCreateBorderPoint,
  useUpdateBorderPoint,
  useDeleteBorderPoint,
} from '@/hooks/useAdmin';
import type { IBorderPoint } from '@/types';

interface IProps {
  canWrite: boolean;
}

interface IFormValues {
  name: string;
  route_description: string | null;
  typical_transit_days: number | null;
  is_active: boolean;
}

export default function BorderPointsTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const { data: points = [], isLoading } = useBorderPoints();
  const [form] = Form.useForm<IFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IBorderPoint | null>(null);

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    form.resetFields();
  }

  const createPoint = useCreateBorderPoint({
    onSuccess: () => { message.success(t('shipment_settings.toast_created')); closeModal(); },
    onError: () => message.error(t('shipment_settings.toast_error')),
  });
  const updatePoint = useUpdateBorderPoint({
    onSuccess: () => { message.success(t('shipment_settings.toast_updated')); closeModal(); },
    onError: () => message.error(t('shipment_settings.toast_error')),
  });
  const deletePoint = useDeleteBorderPoint({
    onSuccess: () => message.success(t('shipment_settings.toast_deleted')),
    onError: () => message.error(t('shipment_settings.toast_error')),
  });

  function handleCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  }

  function handleEdit(record: IBorderPoint) {
    setEditTarget(record);
    form.setFieldsValue({
      name: record.name,
      route_description: record.route_description,
      typical_transit_days: record.typical_transit_days,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleDelete(id: number) {
    Modal.confirm({
      title: t('shipment_settings.confirm_delete'),
      onOk: () => deletePoint.mutate(id),
    });
  }

  function handleSubmit(values: IFormValues) {
    if (editTarget) {
      updatePoint.mutate({ id: editTarget.id, ...values });
    } else {
      createPoint.mutate(values);
    }
  }

  const columns = [
    {
      title: t('shipment_settings.col_name'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a: IBorderPoint, b: IBorderPoint) => a.name.localeCompare(b.name),
      defaultSortOrder: 'ascend' as const,
      render: (v: string) => <strong>{v}</strong>,
    },
    {
      title: t('shipment_settings.col_route'),
      dataIndex: 'route_description',
      key: 'route_description',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('shipment_settings.col_days'),
      dataIndex: 'typical_transit_days',
      key: 'typical_transit_days',
      width: 100,
      sorter: (a: IBorderPoint, b: IBorderPoint) =>
        (a.typical_transit_days ?? 0) - (b.typical_transit_days ?? 0),
      render: (v: number | null) => v ?? '—',
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
            render: (_: unknown, record: IBorderPoint) => (
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
      {canWrite && (
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {t('shipment_settings.add')}
          </Button>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={points}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="small"
        bordered
      />

      <Modal
        title={editTarget ? t('shipment_settings.edit') : t('shipment_settings.add')}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createPoint.isPending || updatePoint.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label={t('shipment_settings.col_name')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="route_description" label={t('shipment_settings.col_route')}>
            <Input />
          </Form.Item>
          <Form.Item name="typical_transit_days" label={t('shipment_settings.col_days')}>
            <InputNumber min={0} max={60} style={{ width: '100%' }} />
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
