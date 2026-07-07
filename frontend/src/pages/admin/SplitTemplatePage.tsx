import { useState } from 'react';
import { Alert, Button, Form, Modal, Space, Tag, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useSplitTemplatesAll,
  useCreateSplitTemplate,
  useUpdateSplitTemplate,
  useDeleteSplitTemplate,
} from '@/hooks/useSplitTemplates';
import { SplitTemplateModal } from './SplitTemplateModal';
import type { ISplitTemplateFormValues } from './SplitTemplateModal';
import type { ISplitTemplate } from '@/types/splitTemplate';

const { Title, Text } = Typography;

function extractApiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
  if (!data) return fallback;
  if (typeof data.error === 'string') return data.error;
  if (Array.isArray(data.weights) && data.weights.length) return String(data.weights[0]);
  if (typeof data.detail === 'string') return data.detail;
  return fallback;
}

export default function SplitTemplatePage(): JSX.Element {
  const { t } = useTranslation();
  const { data: templates = [], isLoading, isError } = useSplitTemplatesAll();

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ISplitTemplate | null>(null);
  const [form] = Form.useForm<ISplitTemplateFormValues>();

  const createTemplate = useCreateSplitTemplate({
    onSuccess: () => { toast.success(t('split_template.toast_created')); closeModal(); },
    onError: (err) => toast.error(extractApiError(err, t('split_template.toast_error'))),
  });
  const updateTemplate = useUpdateSplitTemplate({
    onSuccess: () => { toast.success(t('split_template.toast_updated')); closeModal(); },
    onError: (err) => toast.error(extractApiError(err, t('split_template.toast_error'))),
  });
  const deleteTemplate = useDeleteSplitTemplate({
    onSuccess: () => toast.success(t('split_template.toast_deleted')),
    onError: (err) => toast.error(extractApiError(err, t('split_template.toast_error'))),
  });

  function closeModal(): void {
    setModalOpen(false);
    setEditTarget(null);
    form.resetFields();
  }

  function handleDelete(record: ISplitTemplate): void {
    Modal.confirm({
      title: t('split_template.confirm_delete_title'),
      content: t('split_template.confirm_delete_body'),
      okType: 'danger',
      onOk: () => deleteTemplate.mutate(record.id),
    });
  }

  function handleFormFinish(values: ISplitTemplateFormValues): void {
    if (editTarget) updateTemplate.mutate({ id: editTarget.id, ...values });
    else createTemplate.mutate(values);
  }

  const columns: ProColumns<ISplitTemplate>[] = [
    {
      title: t('split_template.col_sort_order'), dataIndex: 'sort_order', width: 70, search: false,
      sorter: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0), defaultSortOrder: 'ascend',
    },
    {
      title: t('split_template.col_name'), dataIndex: 'name', search: false,
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('split_template.col_weights'), dataIndex: 'weights_list', search: false,
      render: (_, r) => (
        <Space size={4} wrap>
          {r.weights_list.map((w, i) => <Tag key={i}>{Number(w).toLocaleString()}</Tag>)}
        </Space>
      ),
    },
    {
      title: t('split_template.col_total'), dataIndex: 'total_kg', width: 110, search: false,
      sorter: (a, b) => parseFloat(a.total_kg) - parseFloat(b.total_kg),
      render: (_, r) => `${parseFloat(r.total_kg).toLocaleString()} kg`,
    },
    {
      title: t('split_template.col_status'), dataIndex: 'is_active', width: 100, search: false,
      render: (_, r) => (
        <Tag color={r.is_active ? 'green' : 'default'}>
          {r.is_active ? t('common.active') : t('common.inactive')}
        </Tag>
      ),
    },
    {
      title: '', key: 'actions', width: 90, search: false,
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />}
            onClick={() => { setEditTarget(record); setModalOpen(true); }} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)} />
        </Space>
      ),
    },
  ];

  if (isError) {
    return <Alert message={t('split_template.error_load')} type="error" style={{ marginTop: 40 }} />;
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('split_template.title')}</Title>
        <Text type="secondary">{t('split_template.subtitle')}</Text>
      </div>

      <ProTable<ISplitTemplate>
        rowKey="id"
        dataSource={templates}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />}
            onClick={() => { setEditTarget(null); setModalOpen(true); }}>
            {t('split_template.add')}
          </Button>,
        ]}
      />

      <SplitTemplateModal
        open={modalOpen}
        editTarget={editTarget}
        confirmLoading={createTemplate.isPending || updateTemplate.isPending}
        onOk={() => form.submit()}
        onCancel={closeModal}
        onFinish={handleFormFinish}
        form={form}
      />
    </div>
  );
}
