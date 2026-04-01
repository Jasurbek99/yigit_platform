import { useState } from 'react';
import { Button, Tag, Modal, Form, Select, Switch, Alert } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { toast } from 'sonner';
import { useAdminUsers, useUpdateUserRole } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IAdminUser, UserRole } from '@/types';

const ALL_ROLES: UserRole[] = [
  'export_manager',
  'warehouse_chief',
  'document_team',
  'transport',
  'sales_rep',
  'finansist',
  'director',
  'accountant',
  'greenhouse_manager',
];

interface UserEditFormValues {
  role: UserRole;
  is_active: boolean;
}

const ROLE_COLORS: Record<UserRole, string> = {
  export_manager: 'blue',
  warehouse_chief: 'cyan',
  document_team: 'geekblue',
  transport: 'orange',
  sales_rep: 'green',
  finansist: 'gold',
  director: 'red',
  accountant: 'purple',
  greenhouse_manager: 'lime',
};

export default function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const isDirector = currentUser?.role === 'director';

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IAdminUser | null>(null);
  const [form] = Form.useForm<UserEditFormValues>();

  const { data, isLoading, isError } = useAdminUsers();
  const rows = data ?? [];

  const updateMutation = useUpdateUserRole({
    onSuccess: () => {
      toast.success(t('users_admin.toast_updated'));
      setModalOpen(false);
      form.resetFields();
    },
    onError: () => toast.error(t('users_admin.toast_error')),
  });

  function handleOpenEdit(record: IAdminUser) {
    setEditTarget(record);
    form.setFieldsValue({ role: record.role, is_active: record.is_active });
    setModalOpen(true);
  }

  function handleSubmit(values: UserEditFormValues) {
    if (!editTarget) return;
    updateMutation.mutate({ id: editTarget.id, ...values });
  }

  const columns: ProColumns<IAdminUser>[] = [
    {
      title: t('users_admin.username'),
      dataIndex: 'username',
      width: 130,
    },
    {
      title: t('users_admin.name'),
      key: 'full_name',
      width: 160,
      render: (_, record) =>
        [record.first_name, record.last_name].filter(Boolean).join(' ') || (
          <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>
        ),
    },
    {
      title: t('users_admin.email'),
      dataIndex: 'email',
      width: 200,
      render: (val: unknown) =>
        val ? String(val) : <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>,
    },
    {
      title: t('users_admin.role'),
      dataIndex: 'role',
      width: 160,
      render: (_, record) => (
        <Tag color={ROLE_COLORS[record.role]}>{t(`roles.${record.role}`)}</Tag>
      ),
    },
    {
      title: t('users_admin.is_active'),
      dataIndex: 'is_active',
      width: 90,
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
            width: 80,
            render: (_: unknown, record: IAdminUser) => (
              <Button type="link" size="small" onClick={() => handleOpenEdit(record)}>
                {t('users_admin.edit_role')}
              </Button>
            ),
          },
        ] as ProColumns<IAdminUser>[])
      : []),
  ];

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <TeamOutlined style={{ fontSize: 18, color: '#1677ff' }} />
            {t('users_admin.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Ulanyjylary we rugsatlary dolandyrmak
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* action buttons */}
        </div>
      </div>

      {isError && (
        <Alert
          type="error"
          message={t('users_admin.error_load')}
          style={{ marginBottom: 16 }}
        />
      )}

      <ProTable<IAdminUser>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        size="small"
        scroll={{ x: 700 }}
        locale={{ emptyText: t('users_admin.empty') }}
        headerTitle={false}
        toolBarRender={false}
      />

      <Modal
        open={modalOpen}
        title={t('users_admin.edit_role')}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={updateMutation.isPending}
        destroyOnClose
      >
        {editTarget && (
          <div style={{ marginBottom: 16, color: '#595959' }}>
            <strong>{editTarget.username}</strong>
            {editTarget.first_name || editTarget.last_name
              ? ` — ${[editTarget.first_name, editTarget.last_name].filter(Boolean).join(' ')}`
              : ''}
          </div>
        )}
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="role" label={t('users_admin.role')} rules={[{ required: true }]}>
            <Select>
              {ALL_ROLES.map((r) => (
                <Select.Option key={r} value={r}>
                  {t(`roles.${r}`)}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="is_active" label={t('users_admin.is_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
