import { useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Space, Alert, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  useTruckSplits,
  useCreateTruckSplit,
  useUpdateTruckSplit,
  useDeleteTruckSplit,
} from '@/hooks/useAdmin';
import type { ITruckSplitDefault } from '@/types';

interface IProps {
  canWrite: boolean;
}

interface IFormValues {
  num_firms: number;
  kg_per_firm: string;
  notes: string | null;
}

export default function TruckSplitsTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const { data: splits = [], isLoading } = useTruckSplits();
  const [form] = Form.useForm<IFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ITruckSplitDefault | null>(null);

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    form.resetFields();
  }

  const createSplit = useCreateTruckSplit({
    onSuccess: () => { message.success(t('shipment_settings.toast_created')); closeModal(); },
    onError: () => message.error(t('shipment_settings.toast_error')),
  });
  const updateSplit = useUpdateTruckSplit({
    onSuccess: () => { message.success(t('shipment_settings.toast_updated')); closeModal(); },
    onError: () => message.error(t('shipment_settings.toast_error')),
  });
  const deleteSplit = useDeleteTruckSplit({
    onSuccess: () => message.success(t('shipment_settings.toast_deleted')),
    onError: () => message.error(t('shipment_settings.toast_error')),
  });

  function handleCreate() {
    setEditTarget(null);
    form.resetFields();
    setModalOpen(true);
  }

  function handleEdit(record: ITruckSplitDefault) {
    setEditTarget(record);
    form.setFieldsValue({
      num_firms: record.num_firms,
      kg_per_firm: record.kg_per_firm,
      notes: record.notes,
    });
    setModalOpen(true);
  }

  function handleDelete(id: number) {
    Modal.confirm({
      title: t('shipment_settings.confirm_delete'),
      onOk: () => deleteSplit.mutate(id),
    });
  }

  function handleSubmit(values: IFormValues) {
    const payload = {
      num_firms: values.num_firms,
      kg_per_firm: String(values.kg_per_firm),
      notes: values.notes ?? null,
    };
    if (editTarget) {
      updateSplit.mutate({ id: editTarget.id, ...payload });
    } else {
      createSplit.mutate(payload);
    }
  }

  const columns = [
    {
      title: t('truck_split.col_num_firms'),
      dataIndex: 'num_firms',
      key: 'num_firms',
      width: 120,
      sorter: (a: ITruckSplitDefault, b: ITruckSplitDefault) => a.num_firms - b.num_firms,
      defaultSortOrder: 'ascend' as const,
      render: (v: number) => <strong>{v}</strong>,
    },
    {
      title: t('truck_split.col_kg'),
      dataIndex: 'kg_per_firm',
      key: 'kg_per_firm',
      sorter: (a: ITruckSplitDefault, b: ITruckSplitDefault) =>
        Number(a.kg_per_firm) - Number(b.kg_per_firm),
      render: (v: string) => `${Number(v).toLocaleString()} kg`,
    },
    {
      title: t('truck_split.col_notes'),
      dataIndex: 'notes',
      key: 'notes',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('truck_split.col_updated_by'),
      dataIndex: 'updated_by_name',
      key: 'updated_by_name',
      width: 140,
      render: (v: string | null) => v ?? '—',
    },
    ...(canWrite
      ? [
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, record: ITruckSplitDefault) => (
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
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('truck_split.help_title')}
        description={t('truck_split.help_body')}
      />

      {canWrite && (
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {t('shipment_settings.add')}
          </Button>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={splits}
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
        confirmLoading={createSplit.isPending || updateSplit.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="num_firms"
            label={t('truck_split.col_num_firms')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <InputNumber min={1} max={20} style={{ width: '100%' }} disabled={!!editTarget} />
          </Form.Item>
          <Form.Item
            name="kg_per_firm"
            label={t('truck_split.col_kg')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <InputNumber min={0.01} step={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label={t('truck_split.col_notes')}>
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
