import { useState } from 'react';
import { Typography, Button, Tag, Modal, Form, Input, Switch, Alert } from 'antd';
import { BankOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { toast } from 'sonner';
import { useAdminFirms, useCreateFirm, useUpdateFirm } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IExportFirm } from '@/types';

interface FirmFormValues {
  code: string;
  name_tk: string;
  name_en: string | null;
  name_ru: string | null;
  is_active: boolean;
}

export default function ExportFirmsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isDirector = user?.role === 'director';

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IExportFirm | null>(null);
  const [form] = Form.useForm<FirmFormValues>();

  const { data, isLoading, isError } = useAdminFirms();
  const rows = data ?? [];

  const createMutation = useCreateFirm({
    onSuccess: () => {
      toast.success(t('firms_admin.toast_created'));
      setModalOpen(false);
      form.resetFields();
    },
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  const updateMutation = useUpdateFirm({
    onSuccess: () => {
      toast.success(t('firms_admin.toast_updated'));
      setModalOpen(false);
      form.resetFields();
    },
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  function handleOpenCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  }

  function handleOpenEdit(record: IExportFirm) {
    setEditTarget(record);
    form.setFieldsValue({
      code: record.code,
      name_tk: record.name_tk,
      name_en: record.name_en ?? '',
      name_ru: record.name_ru ?? '',
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleSubmit(values: FirmFormValues) {
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, ...values });
    } else {
      createMutation.mutate(values);
    }
  }

  const columns: ProColumns<IExportFirm>[] = [
    {
      title: t('firms_admin.code'),
      dataIndex: 'code',
      width: 100,
    },
    {
      title: t('firms_admin.name_tk'),
      dataIndex: 'name_tk',
      width: 180,
    },
    {
      title: t('firms_admin.name_en'),
      dataIndex: 'name_en',
      width: 180,
      render: (val: unknown) =>
        val ? String(val) : <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>,
    },
    {
      title: t('firms_admin.name_ru'),
      dataIndex: 'name_ru',
      width: 180,
      render: (val: unknown) =>
        val ? String(val) : <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>,
    },
    {
      title: t('firms_admin.is_active'),
      dataIndex: 'is_active',
      width: 100,
      render: (_, record) =>
        record.is_active ? (
          <Tag color="green">{t('common.yes')}</Tag>
        ) : (
          <Tag>{t('common.no')}</Tag>
        ),
    },
    ...(isDirector
      ? ([
          {
            title: '',
            key: 'actions',
            width: 100,
            render: (_: unknown, record: IExportFirm) => (
              <Button type="link" size="small" onClick={() => handleOpenEdit(record)}>
                {t('common.edit')}
              </Button>
            ),
          },
        ] as ProColumns<IExportFirm>[])
      : []),
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        <BankOutlined style={{ marginRight: 8 }} />
        {t('firms_admin.title')}
      </Typography.Title>

      {isError && (
        <Alert
          type="error"
          message={t('firms_admin.error_load')}
          style={{ marginBottom: 16 }}
        />
      )}

      <ProTable<IExportFirm>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        size="small"
        scroll={{ x: 760 }}
        locale={{ emptyText: t('firms_admin.empty') }}
        headerTitle={false}
        toolBarRender={
          isDirector
            ? () => [
                <Button
                  key="add"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleOpenCreate}
                >
                  {t('firms_admin.add')}
                </Button>,
              ]
            : false
        }
      />

      <Modal
        open={modalOpen}
        title={editTarget ? t('firms_admin.edit_title') : t('firms_admin.add')}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="code"
            label={t('firms_admin.code')}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="name_tk"
            label={t('firms_admin.name_tk')}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="name_en" label={t('firms_admin.name_en')}>
            <Input />
          </Form.Item>
          <Form.Item name="name_ru" label={t('firms_admin.name_ru')}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label={t('firms_admin.is_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
