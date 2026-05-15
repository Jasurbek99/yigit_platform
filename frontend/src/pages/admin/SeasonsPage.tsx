import { useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconCalendar, IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import { toast } from 'sonner';
import { useSeasons, useCreateSeason, useUpdateSeason, useDeleteSeason } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import type { ISeason } from '@/types';

const { Text } = Typography;

interface ISeasonFormValues {
  name: string;
  start_date: Dayjs | null;
  end_date: Dayjs | null;
  is_active: boolean;
}

export default function SeasonsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCreate = canDo(user, 'season', 'create');
  const canEditSeason = canDo(user, 'season', 'edit');
  const canDeleteSeason = canDo(user, 'season', 'delete');

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ISeason | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ISeason | null>(null);
  const [form] = Form.useForm<ISeasonFormValues>();

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
    onSuccess: () => {
      toast.success(t('seasons.toast_deleted'));
      setDeleteTarget(null);
    },
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
      start_date: record.start_date ? dayjs(record.start_date) : null,
      end_date: record.end_date ? dayjs(record.end_date) : null,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleSubmit(values: ISeasonFormValues) {
    const payload = {
      name: values.name,
      start_date: values.start_date ? values.start_date.format('YYYY-MM-DD') : '',
      end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : '',
      is_active: values.is_active,
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
      search: false,
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('seasons.start_date'),
      dataIndex: 'start_date',
      width: 120,
      search: false,
      sorter: (a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''),
      render: (_, record) =>
        record.start_date ? dayjs(record.start_date).format('DD.MM.YYYY') : '—',
    },
    {
      title: t('seasons.end_date'),
      dataIndex: 'end_date',
      width: 120,
      search: false,
      sorter: (a, b) => (a.end_date ?? '').localeCompare(b.end_date ?? ''),
      render: (_, record) =>
        record.end_date ? dayjs(record.end_date).format('DD.MM.YYYY') : '—',
    },
    {
      title: t('seasons.is_active'),
      dataIndex: 'is_active',
      width: 100,
      search: false,
      sorter: (a, b) => {
        const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      },
      defaultSortOrder: 'descend',
      render: (_, record) =>
        record.is_active ? (
          <Tag color="green">{t('common.yes')}</Tag>
        ) : (
          <Tag color="default">{t('common.no')}</Tag>
        ),
    },
    ...((canEditSeason || canDeleteSeason)
      ? [
          {
            title: '',
            key: 'actions',
            width: 160,
            search: false,
            render: (_: unknown, record: ISeason) => (
              <Space size={4}>
                {canEditSeason && (
                  <Button
                    type="link"
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handleOpenEdit(record); }}
                  >
                    {t('common.edit')}
                  </Button>
                )}
                {canDeleteSeason && (
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(record); }}
                  >
                    {t('common.delete')}
                  </Button>
                )}
              </Space>
            ),
          } as ProColumns<ISeason>,
        ]
      : []),
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconCalendar size={18} color="#1677ff" />
            {t('seasons.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('seasons.subtitle')}
          </div>
        </div>
        {canCreate && (
          <Button type="primary" icon={<IconPlus size={14} />} onClick={handleOpenCreate}>
            {t('seasons.add')}
          </Button>
        )}
      </Space>

      {isError && (
        <Alert type="error" message={t('seasons.error_load')} showIcon style={{ marginBottom: 16 }} />
      )}

      <ProTable<ISeason>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        locale={{ emptyText: t('seasons.empty') }}
      />

      <Modal
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        title={editTarget ? t('seasons.edit_title') : t('seasons.add')}
        footer={null}
        destroyOnClose
      >
        <Form<ISeasonFormValues>
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ is_active: true }}
        >
          <Form.Item
            name="name"
            label={t('seasons.name')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="start_date"
            label={t('seasons.start_date')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="end_date"
            label={t('seasons.end_date')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label={t('seasons.is_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 8 }}>
            <Button onClick={() => { setModalOpen(false); form.resetFields(); }}>
              {t('common.cancel')}
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {t('common.save')}
            </Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onCancel={() => setDeleteTarget(null)}
        title={t('seasons.confirm_delete')}
        width={400}
        footer={null}
      >
        <Text>{deleteTarget?.name}</Text>
        <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button onClick={() => setDeleteTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            danger
            type="primary"
            loading={deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
          >
            {t('common.delete')}
          </Button>
        </Space>
      </Modal>
    </div>
  );
}
