import { useState } from 'react';
import { Table, Button, Modal, Form, Input, Tag } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useShipmentStatuses, useUpdateShipmentStatus } from '@/hooks/useAdmin';
import type { IShipmentStatusType } from '@/types';

interface IProps {
  canWrite: boolean;
}

interface IEditValues {
  name_tk: string;
  name_en: string | null;
  name_ru: string | null;
  required_role: string | null;
  phase: string | null;
}

export default function StatusesTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const { data: statuses = [], isLoading } = useShipmentStatuses();
  const [form] = Form.useForm<IEditValues>();
  const [editTarget, setEditTarget] = useState<IShipmentStatusType | null>(null);

  const updateStatus = useUpdateShipmentStatus({
    onSuccess: () => {
      toast.success(t('shipment_settings.toast_updated'));
      setEditTarget(null);
      form.resetFields();
    },
    onError: () => toast.error(t('shipment_settings.toast_error')),
  });

  function handleEdit(record: IShipmentStatusType) {
    setEditTarget(record);
    form.setFieldsValue({
      name_tk: record.name_tk,
      name_en: record.name_en,
      name_ru: record.name_ru,
      required_role: record.required_role,
      phase: record.phase,
    });
  }

  function handleSubmit(values: IEditValues) {
    if (!editTarget) return;
    updateStatus.mutate({ id: editTarget.id, ...values });
  }

  const columns = [
    {
      title: t('shipment_settings.col_step'),
      dataIndex: 'step_order',
      key: 'step_order',
      width: 60,
      sorter: (a: IShipmentStatusType, b: IShipmentStatusType) => a.step_order - b.step_order,
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: t('shipment_settings.col_code'),
      dataIndex: 'code',
      key: 'code',
      width: 160,
      render: (v: string) => <code>{v}</code>,
    },
    {
      title: t('shipment_settings.col_name_tk'),
      dataIndex: 'name_tk',
      key: 'name_tk',
    },
    {
      title: t('shipment_settings.col_name_en'),
      dataIndex: 'name_en',
      key: 'name_en',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('shipment_settings.col_name_ru'),
      dataIndex: 'name_ru',
      key: 'name_ru',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('shipment_settings.col_role'),
      dataIndex: 'required_role',
      key: 'required_role',
      render: (v: string | null) =>
        v ? <Tag>{v}</Tag> : <span style={{ color: '#999' }}>—</span>,
    },
    {
      title: t('shipment_settings.col_phase'),
      dataIndex: 'phase',
      key: 'phase',
      render: (v: string | null) => v ?? '—',
    },
    ...(canWrite
      ? [
          {
            title: '',
            key: 'actions',
            width: 60,
            render: (_: unknown, record: IShipmentStatusType) => (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Table
        columns={columns}
        dataSource={statuses}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="small"
        bordered
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={t('shipment_settings.edit')}
        open={editTarget !== null}
        onCancel={() => { setEditTarget(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={updateStatus.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name_tk"
            label={t('shipment_settings.col_name_tk')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="name_en" label={t('shipment_settings.col_name_en')}>
            <Input />
          </Form.Item>
          <Form.Item name="name_ru" label={t('shipment_settings.col_name_ru')}>
            <Input />
          </Form.Item>
          <Form.Item name="required_role" label={t('shipment_settings.col_role')}>
            <Input placeholder="e.g. document_team" />
          </Form.Item>
          <Form.Item name="phase" label={t('shipment_settings.col_phase')}>
            <Input placeholder="e.g. loading" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
