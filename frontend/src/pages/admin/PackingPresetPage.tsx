import { useState } from 'react';
import { Alert, Button, Form, Modal, Space, Tag, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  usePackingPresetsAll,
  useCreatePackingPreset,
  useUpdatePackingPreset,
  useDeletePackingPreset,
} from '@/hooks/usePackingPresets';
import { PackingPresetModal } from './PackingPresetModal';
import type { IPackingPresetFormValues } from './PackingPresetModal';
import type { IPackingPreset } from '@/types/packingPreset';

const { Title, Text } = Typography;

function extractApiError(err: unknown, fallback: string): string {
  const response = (err as { response?: { data?: Record<string, unknown> } }).response;
  const data = response?.data;
  if (!data) return fallback;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.detail === 'string') return data.detail;
  return fallback;
}

export default function PackingPresetPage(): JSX.Element {
  const { t } = useTranslation();
  const { data: presets = [], isLoading, isError } = usePackingPresetsAll();

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IPackingPreset | null>(null);
  const [form] = Form.useForm<IPackingPresetFormValues>();

  const createPreset = useCreatePackingPreset({
    onSuccess: () => {
      toast.success(t('packing_preset.toast_created'));
      setModalOpen(false);
      setEditTarget(null);
      form.resetFields();
    },
    onError: (err) => {
      toast.error(extractApiError(err, t('packing_preset.toast_error')));
    },
  });

  const updatePreset = useUpdatePackingPreset({
    onSuccess: () => {
      toast.success(t('packing_preset.toast_updated'));
      setModalOpen(false);
      setEditTarget(null);
      form.resetFields();
    },
    onError: (err) => {
      toast.error(extractApiError(err, t('packing_preset.toast_error')));
    },
  });

  const deletePreset = useDeletePackingPreset({
    onSuccess: () => toast.success(t('packing_preset.toast_deleted')),
    onError: (err) => {
      toast.error(extractApiError(err, t('packing_preset.toast_error')));
    },
  });

  function handleCreate(): void {
    setEditTarget(null);
    setModalOpen(true);
  }

  function handleEdit(record: IPackingPreset): void {
    setEditTarget(record);
    setModalOpen(true);
  }

  function handleDelete(record: IPackingPreset): void {
    Modal.confirm({
      title: t('packing_preset.confirm_delete_title'),
      content: t('packing_preset.confirm_delete_body'),
      okType: 'danger',
      onOk: () => deletePreset.mutate(record.id),
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

  function handleFormFinish(values: IPackingPresetFormValues): void {
    if (editTarget) {
      updatePreset.mutate({ id: editTarget.id, ...values });
    } else {
      createPreset.mutate(values);
    }
  }

  const columns: ProColumns<IPackingPreset>[] = [
    {
      title: t('packing_preset.col_sort_order'),
      dataIndex: 'sort_order',
      width: 70,
      search: false,
      sorter: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      defaultSortOrder: 'ascend',
    },
    {
      title: t('packing_preset.col_name'),
      dataIndex: 'name',
      search: false,
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('packing_preset.col_product_type'),
      dataIndex: 'product_type_display',
      width: 120,
      search: false,
      sorter: (a, b) => a.product_type.localeCompare(b.product_type),
    },
    {
      title: t('packing_preset.col_net_kg'),
      dataIndex: 'net_kg',
      width: 110,
      search: false,
      sorter: (a, b) => parseFloat(a.net_kg) - parseFloat(b.net_kg),
      render: (_, record) => `${parseFloat(record.net_kg).toLocaleString()} kg`,
    },
    {
      title: t('packing_preset.col_gross_kg'),
      dataIndex: 'gross_kg',
      width: 115,
      search: false,
      sorter: (a, b) => parseFloat(a.gross_kg) - parseFloat(b.gross_kg),
      render: (_, record) => `${parseFloat(record.gross_kg).toLocaleString()} kg`,
    },
    {
      title: t('packing_preset.col_box_count'),
      dataIndex: 'box_count',
      width: 90,
      search: false,
      sorter: (a, b) => a.box_count - b.box_count,
    },
    {
      title: t('packing_preset.col_pallet_count'),
      dataIndex: 'pallet_count',
      width: 100,
      search: false,
      sorter: (a, b) => parseFloat(a.pallet_count) - parseFloat(b.pallet_count),
    },
    {
      title: t('packing_preset.col_pallet_weight_kg'),
      dataIndex: 'pallet_weight_kg',
      width: 120,
      search: false,
      sorter: (a, b) => parseFloat(a.pallet_weight_kg) - parseFloat(b.pallet_weight_kg),
      render: (_, record) => `${parseFloat(record.pallet_weight_kg).toLocaleString()} kg`,
    },
    {
      title: t('packing_preset.col_status'),
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
        message={t('packing_preset.error_load')}
        type="error"
        style={{ marginTop: 40 }}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {t('packing_preset.title')}
        </Title>
        <Text type="secondary">{t('packing_preset.subtitle')}</Text>
      </div>

      <ProTable<IPackingPreset>
        rowKey="id"
        dataSource={presets}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {t('packing_preset.add')}
          </Button>,
        ]}
      />

      <PackingPresetModal
        open={modalOpen}
        editTarget={editTarget}
        confirmLoading={createPreset.isPending || updatePreset.isPending}
        onOk={handleModalOk}
        onCancel={handleModalCancel}
        onFinish={handleFormFinish}
        form={form}
      />
    </div>
  );
}
