import { useState } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  useAdminTruckDestinations,
  useCreateTruckDestination,
  useUpdateTruckDestination,
  useDeleteTruckDestination,
  useCountries,
} from '@/hooks/useAdmin';
import type { ITruckDestination } from '@/types';

const { Title, Text } = Typography;

export default function TruckDestinationsPage() {
  const { t } = useTranslation();
  const { data: destinations = [], isLoading } = useAdminTruckDestinations();
  const { data: countries = [] } = useCountries();
  const createDest = useCreateTruckDestination({
    onSuccess: () => {
      message.success(t('truck_dest_admin.toast_created'));
      setModalOpen(false);
      form.resetFields();
    },
  });
  const updateDest = useUpdateTruckDestination({
    onSuccess: () => {
      message.success(t('truck_dest_admin.toast_updated'));
      setModalOpen(false);
      form.resetFields();
      setEditTarget(null);
    },
  });
  const deleteDest = useDeleteTruckDestination({
    onSuccess: () => message.success(t('truck_dest_admin.toast_deleted')),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ITruckDestination | null>(null);
  const [form] = Form.useForm();

  function handleCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ sort_order: (destinations.length + 1) * 10, is_active: true });
    setModalOpen(true);
  }

  function handleEdit(record: ITruckDestination) {
    setEditTarget(record);
    form.setFieldsValue({
      name: record.name,
      country: record.country,
      sort_order: record.sort_order,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleSubmit(values: { name: string; country?: number | null; sort_order?: number; is_active?: boolean }) {
    if (editTarget) {
      updateDest.mutate({ id: editTarget.id, ...values });
    } else {
      createDest.mutate(values);
    }
  }

  function handleDelete(id: number) {
    Modal.confirm({
      title: t('truck_dest_admin.confirm_delete'),
      onOk: () => deleteDest.mutate(id),
    });
  }

  const countryOptions = countries.map((c) => ({
    value: c.id,
    label: c.name_en || c.name_tk,
  }));

  const columns = [
    {
      title: t('truck_dest_admin.name'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: t('truck_dest_admin.country'),
      dataIndex: 'country_name',
      key: 'country_name',
      render: (text: string | null) => text || <Text type="secondary">—</Text>,
    },
    {
      title: t('truck_dest_admin.sort_order'),
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 100,
    },
    {
      title: t('truck_dest_admin.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>
          {active ? t('common.active') : t('common.inactive')}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: ITruckDestination) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{t('truck_dest_admin.title')}</Title>
          <Text type="secondary">{t('truck_dest_admin.subtitle')}</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          {t('truck_dest_admin.add')}
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={destinations}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="small"
        bordered
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={editTarget ? t('truck_dest_admin.edit') : t('truck_dest_admin.add')}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditTarget(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createDest.isPending || updateDest.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label={t('truck_dest_admin.name')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="country" label={t('truck_dest_admin.country')}>
            <Select
              options={countryOptions}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('truck_dest_admin.country_placeholder')}
            />
          </Form.Item>
          <Form.Item name="sort_order" label={t('truck_dest_admin.sort_order')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {editTarget && (
            <Form.Item name="is_active" label={t('truck_dest_admin.status')} valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
