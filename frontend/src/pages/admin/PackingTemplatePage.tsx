import { useState } from 'react';
import { Alert, Button, Form, Modal, Space, Tag, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  usePackingTemplatesAll, useCreatePackingTemplate, useUpdatePackingTemplate, useDeletePackingTemplate,
} from '@/hooks/usePackingTemplates';
import { PackingTemplateModal } from './PackingTemplateModal';
import type { IPackingTemplateFormValues } from './PackingTemplateModal';
import type { IPackingTemplate } from '@/types/packingTemplate';

const { Title, Text } = Typography;

function extractApiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
  if (data && typeof data.error === 'string') return data.error;
  if (data && typeof data.detail === 'string') return data.detail;
  return fallback;
}

export default function PackingTemplatePage(): JSX.Element {
  const { t } = useTranslation();
  const { data: templates = [], isLoading, isError } = usePackingTemplatesAll();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IPackingTemplate | null>(null);
  const [form] = Form.useForm<IPackingTemplateFormValues>();

  const close = () => { setModalOpen(false); setEditTarget(null); form.resetFields(); };
  const create = useCreatePackingTemplate({
    onSuccess: () => { toast.success(t('packing_template.toast_created')); close(); },
    onError: (e) => toast.error(extractApiError(e, t('packing_template.toast_error'))),
  });
  const update = useUpdatePackingTemplate({
    onSuccess: () => { toast.success(t('packing_template.toast_updated')); close(); },
    onError: (e) => toast.error(extractApiError(e, t('packing_template.toast_error'))),
  });
  const del = useDeletePackingTemplate({
    onSuccess: () => toast.success(t('packing_template.toast_deleted')),
    onError: (e) => toast.error(extractApiError(e, t('packing_template.toast_error'))),
  });

  const onFinish = (v: IPackingTemplateFormValues) => {
    const payload = { ...v, shares: (v.shares ?? []).filter(Boolean) };
    if (editTarget) update.mutate({ id: editTarget.id, ...payload });
    else create.mutate(payload);
  };

  const columns: ProColumns<IPackingTemplate>[] = [
    { title: t('packing_template.col_sort_order'), dataIndex: 'sort_order', width: 70, search: false,
      sorter: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0), defaultSortOrder: 'ascend' },
    { title: t('packing_template.col_name'), dataIndex: 'name', search: false,
      sorter: (a, b) => a.name.localeCompare(b.name) },
    { title: t('packing_template.col_product_type'), dataIndex: 'product_type_display', width: 100, search: false },
    { title: t('packing_template.col_net_kg'), dataIndex: 'net_kg', width: 100, search: false,
      render: (_, r) => r.net_kg != null ? `${parseFloat(r.net_kg).toLocaleString()} kg` : '—' },
    { title: t('packing_template.firm_shares'), dataIndex: 'shares', search: false,
      render: (_, r) => (
        <Space size={4} wrap>
          {r.shares.map((s, i) => <Tag key={i}>{s.net_kg != null ? Number(s.net_kg).toLocaleString() : '—'}</Tag>)}
        </Space>
      ) },
    { title: t('packing_template.col_status'), dataIndex: 'is_active', width: 90, search: false,
      render: (_, r) => <Tag color={r.is_active ? 'green' : 'default'}>{r.is_active ? t('common.active') : t('common.inactive')}</Tag> },
    { title: '', key: 'actions', width: 90, search: false,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditTarget(r); setModalOpen(true); }} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => Modal.confirm({
            title: t('packing_template.confirm_delete_title'),
            content: t('packing_template.confirm_delete_body'),
            okType: 'danger', onOk: () => del.mutate(r.id),
          })} />
        </Space>
      ) },
  ];

  if (isError) return <Alert message={t('packing_template.error_load')} type="error" style={{ marginTop: 40 }} />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('packing_template.title')}</Title>
        <Text type="secondary">{t('packing_template.subtitle')}</Text>
      </div>
      <ProTable<IPackingTemplate>
        rowKey="id" dataSource={templates} columns={columns} loading={isLoading}
        search={false} options={false} pagination={false} size="small" scroll={{ x: 'max-content' }}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => { setEditTarget(null); setModalOpen(true); }}>
            {t('packing_template.add')}
          </Button>,
        ]}
      />
      <PackingTemplateModal
        open={modalOpen} editTarget={editTarget}
        confirmLoading={create.isPending || update.isPending}
        onOk={() => form.submit()} onCancel={close} onFinish={onFinish} form={form}
      />
    </div>
  );
}
