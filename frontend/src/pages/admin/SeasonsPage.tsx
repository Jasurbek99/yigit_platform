import { useState } from 'react';
import { Button, Tag, Modal, Form, Input, Switch, Alert } from 'antd';
import { CalendarOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { DatePicker } from 'antd';
import { useSeasons, useCreateSeason, useUpdateSeason, useDeleteSeason } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { ISeason } from '@/types';

interface SeasonFormValues {
  name: string;
  start_date: string | dayjs.Dayjs;
  end_date: string | dayjs.Dayjs;
  is_active: boolean;
}

export default function SeasonsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isDirector = user?.role === 'director';

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ISeason | null>(null);
  const [form] = Form.useForm<SeasonFormValues>();

  const { data, isLoading, isError } = useSeasons();
  const rows = data ?? [];

  const createMutation = useCreateSeason({
    onSuccess: () => {
      toast.success(t('seasons.toast_created'));
      setModalOpen(false);
      form.resetFields();
    },
    onError: () => toast.error(t('seasons.toast_error')),
  });

  const updateMutation = useUpdateSeason({
    onSuccess: () => {
      toast.success(t('seasons.toast_updated'));
      setModalOpen(false);
      form.resetFields();
    },
    onError: () => toast.error(t('seasons.toast_error')),
  });

  const deleteMutation = useDeleteSeason({
    onSuccess: () => toast.success(t('seasons.toast_deleted')),
    onError: () => toast.error(t('seasons.toast_error')),
  });

  function handleOpenCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  }

  function handleOpenEdit(record: ISeason) {
    setEditTarget(record);
    form.setFieldsValue({
      name: record.name,
      start_date: record.start_date,
      end_date: record.end_date,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleDelete(id: number) {
    Modal.confirm({
      title: t('seasons.confirm_delete'),
      okType: 'danger',
      onOk: () => deleteMutation.mutate(id),
    });
  }

  function handleSubmit(values: SeasonFormValues) {
    const payload = {
      ...values,
      start_date: dayjs.isDayjs(values.start_date)
        ? values.start_date.format('YYYY-MM-DD')
        : values.start_date,
      end_date: dayjs.isDayjs(values.end_date)
        ? values.end_date.format('YYYY-MM-DD')
        : values.end_date,
    };
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const columns: ProColumns<ISeason>[] = [
    {
      title: t('seasons.name'),
      dataIndex: 'name',
      width: 180,
    },
    {
      title: t('seasons.start_date'),
      dataIndex: 'start_date',
      width: 120,
      valueType: 'date',
    },
    {
      title: t('seasons.end_date'),
      dataIndex: 'end_date',
      width: 120,
      valueType: 'date',
    },
    {
      title: t('seasons.is_active'),
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
            width: 120,
            render: (_: unknown, record: ISeason) => (
              <span>
                <Button type="link" size="small" onClick={() => handleOpenEdit(record)}>
                  {t('common.edit')}
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() => handleDelete(record.id)}
                >
                  {t('common.delete')}
                </Button>
              </span>
            ),
          },
        ] as ProColumns<ISeason>[])
      : []),
  ];

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarOutlined style={{ fontSize: 18, color: '#1677ff' }} />
            {t('seasons.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Eksport möwsümlerini dolandyrmak
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isDirector && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleOpenCreate}
            >
              {t('seasons.add')}
            </Button>
          )}
        </div>
      </div>

      {isError && (
        <Alert type="error" message={t('seasons.error_load')} style={{ marginBottom: 16 }} />
      )}

      <ProTable<ISeason>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        size="small"
        locale={{ emptyText: t('seasons.empty') }}
        headerTitle={false}
        toolBarRender={false}
      />

      <Modal
        open={modalOpen}
        title={editTarget ? t('seasons.edit_title') : t('seasons.add')}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label={t('seasons.name')}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="start_date"
            label={t('seasons.start_date')}
            rules={[{ required: true }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="end_date"
            label={t('seasons.end_date')}
            rules={[{ required: true }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label={t('seasons.is_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
