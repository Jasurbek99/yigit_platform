import { useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconUsers } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useAdminUsers,
  useUpdateUserRole,
  useCreateUser,
  useDeleteUser,
  useSetUserPassword,
} from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IAdminUser, UserRole } from '@/types';

const { Text } = Typography;

const ALL_ROLES: UserRole[] = [
  'admin',
  'export_manager',
  'loading_dept_head',
  'warehouse_chief',
  'weight_master',
  'document_team',
  'transport',
  'sales_rep',
  'finansist',
  'director',
  'accountant',
  'greenhouse_manager',
  'seller',
  'boss',
];

interface IUserEditFormValues {
  role: UserRole | null;
  is_active: boolean;
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'red',
  export_manager: 'blue',
  loading_dept_head: 'gold',
  warehouse_chief: 'cyan',
  weight_master: 'geekblue',
  document_team: 'blue',
  transport: 'orange',
  sales_rep: 'green',
  finansist: 'gold',
  director: 'volcano',
  accountant: 'purple',
  greenhouse_manager: 'lime',
  seller: 'cyan',
  boss: 'magenta',
};

export default function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin' || currentUser?.is_superuser === true;
  const isSuperuser = currentUser?.is_superuser === true;

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IAdminUser | null>(null);
  const [editForm] = Form.useForm<IUserEditFormValues>();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();

  const [passwordTarget, setPasswordTarget] = useState<IAdminUser | null>(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm] = Form.useForm();

  const { data, isLoading, isError } = useAdminUsers();
  const rows = data ?? [];

  const updateMutation = useUpdateUserRole({
    onSuccess: () => {
      toast.success(t('users_admin.toast_updated'));
      setEditModalOpen(false);
      editForm.resetFields();
    },
    onError: () => toast.error(t('users_admin.toast_error')),
  });

  const createUser = useCreateUser({
    onSuccess: () => {
      toast.success(t('users_admin.toast_created'));
      setCreateModalOpen(false);
      createForm.resetFields();
    },
    onError: () => toast.error(t('users_admin.toast_error')),
  });

  const deleteUser = useDeleteUser({
    onSuccess: () => toast.success(t('users_admin.toast_deleted')),
    onError: () => toast.error(t('users_admin.toast_error')),
  });

  const setPassword = useSetUserPassword({
    onSuccess: () => {
      toast.success(t('users_admin.toast_password'));
      setPasswordModalOpen(false);
      setPasswordTarget(null);
      passwordForm.resetFields();
    },
    onError: () => toast.error(t('users_admin.toast_error')),
  });

  function handleOpenEdit(record: IAdminUser) {
    setEditTarget(record);
    editForm.setFieldsValue({ role: record.role, is_active: record.is_active });
    setEditModalOpen(true);
  }

  function handleEditSubmit(values: IUserEditFormValues) {
    if (!editTarget || !values.role) return;
    updateMutation.mutate({ id: editTarget.id, role: values.role, is_active: values.is_active });
  }

  function handleOpenPasswordModal(record: IAdminUser) {
    setPasswordTarget(record);
    passwordForm.resetFields();
    setPasswordModalOpen(true);
  }

  function handleDeleteConfirm(record: IAdminUser) {
    Modal.confirm({
      title: t('users_admin.confirm_delete'),
      content: t('users_admin.confirm_delete_desc', { username: record.username }),
      okText: t('users_admin.delete_btn'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: () => deleteUser.mutate(record.id),
    });
  }

  const columns: ProColumns<IAdminUser>[] = [
    {
      title: t('users_admin.username'),
      dataIndex: 'username',
      width: 130,
      search: false,
      sorter: (a, b) => a.username.localeCompare(b.username),
      defaultSortOrder: 'ascend',
    },
    {
      title: t('users_admin.name'),
      dataIndex: 'first_name',
      width: 160,
      search: false,
      sorter: (a, b) =>
        `${a.first_name ?? ''} ${a.last_name ?? ''}`
          .trim()
          .localeCompare(`${b.first_name ?? ''} ${b.last_name ?? ''}`.trim()),
      render: (_, record) =>
        [record.first_name, record.last_name].filter(Boolean).join(' ') || (
          <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>
        ),
    },
    {
      title: t('users_admin.email'),
      dataIndex: 'email',
      width: 200,
      search: false,
      sorter: (a, b) => (a.email ?? '').localeCompare(b.email ?? ''),
      render: (_, record) =>
        record.email
          ? record.email
          : <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>,
    },
    {
      title: t('users_admin.role'),
      dataIndex: 'role',
      width: 160,
      search: false,
      sorter: (a, b) => a.role.localeCompare(b.role),
      render: (_, record) => (
        <Tag color={ROLE_COLORS[record.role] ?? 'default'}>
          {t(`roles.${record.role}`)}
        </Tag>
      ),
    },
    {
      title: t('users_admin.is_active'),
      dataIndex: 'is_active',
      width: 90,
      search: false,
      sorter: (a, b) => {
        const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        if (diff !== 0) return diff;
        return a.username.localeCompare(b.username);
      },
      render: (_, record) =>
        record.is_active ? (
          <Tag color="green">{t('common.yes')}</Tag>
        ) : (
          <Tag color="default">{t('common.no')}</Tag>
        ),
    },
    ...(isAdmin
      ? [
          {
            title: '',
            key: 'edit',
            width: 100,
            search: false,
            render: (_: unknown, record: IAdminUser) => (
              <Button
                type="link"
                size="small"
                onClick={(e) => { e.stopPropagation(); handleOpenEdit(record); }}
              >
                {t('users_admin.edit_role')}
              </Button>
            ),
          } as ProColumns<IAdminUser>,
        ]
      : []),
    ...(isSuperuser
      ? [
          {
            title: '',
            key: 'password',
            width: 120,
            search: false,
            render: (_: unknown, record: IAdminUser) => (
              <Button
                type="link"
                size="small"
                style={{ color: '#fa8c16' }}
                onClick={(e) => { e.stopPropagation(); handleOpenPasswordModal(record); }}
              >
                {t('users_admin.reset_password')}
              </Button>
            ),
          } as ProColumns<IAdminUser>,
          {
            title: '',
            key: 'delete',
            width: 80,
            search: false,
            render: (_: unknown, record: IAdminUser) =>
              record.id === currentUser?.id ? null : (
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={(e) => { e.stopPropagation(); handleDeleteConfirm(record); }}
                >
                  {t('users_admin.delete_btn')}
                </Button>
              ),
          } as ProColumns<IAdminUser>,
        ]
      : []),
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconUsers size={18} color="#1677ff" />
            {t('users_admin.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('users_admin.subtitle')}
          </div>
        </div>
        {isSuperuser && (
          <Button
            type="primary"
            onClick={() => { createForm.resetFields(); setCreateModalOpen(true); }}
          >
            {t('users_admin.create')}
          </Button>
        )}
      </Space>

      {isError && (
        <Alert type="error" message={t('users_admin.error_load')} showIcon style={{ marginBottom: 16 }} />
      )}

      <ProTable<IAdminUser>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        size="small"
        locale={{ emptyText: t('users_admin.empty') }}
      />

      <Modal
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        title={t('users_admin.edit_role')}
        footer={null}
        destroyOnClose
      >
        {editTarget && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            <strong>{editTarget.username}</strong>
            {editTarget.first_name || editTarget.last_name
              ? ` — ${[editTarget.first_name, editTarget.last_name].filter(Boolean).join(' ')}`
              : ''}
          </Text>
        )}
        <Form<IUserEditFormValues>
          form={editForm}
          layout="vertical"
          onFinish={handleEditSubmit}
        >
          <Form.Item
            name="role"
            label={t('users_admin.role')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Select
              options={ALL_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
            />
          </Form.Item>
          <Form.Item name="is_active" label={t('users_admin.is_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 8 }}>
            <Button onClick={() => { setEditModalOpen(false); editForm.resetFields(); }}>
              {t('common.cancel')}
            </Button>
            <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
              {t('common.save')}
            </Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={t('users_admin.create_title')}
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        okText={t('users_admin.create_title')}
        cancelText={t('common.cancel')}
        confirmLoading={createUser.isPending}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={(values) => createUser.mutate(values)}
          style={{ marginTop: 8 }}
        >
          <Form.Item
            name="username"
            label={t('users_admin.username')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('users_admin.password')}
            rules={[
              { required: true, message: t('common.required') },
              { min: 8, message: t('users_admin.password_min') },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="first_name" label={t('users_admin.first_name')}>
            <Input />
          </Form.Item>
          <Form.Item name="last_name" label={t('users_admin.last_name')}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t('users_admin.email')}>
            <Input type="email" />
          </Form.Item>
          <Form.Item
            name="role"
            label={t('users_admin.role')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Select
              options={ALL_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
            />
          </Form.Item>
          <Form.Item name="is_active" label={t('users_admin.is_active')} valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('users_admin.reset_password_title', { username: passwordTarget?.username ?? '' })}
        open={passwordModalOpen}
        onCancel={() => { setPasswordModalOpen(false); setPasswordTarget(null); passwordForm.resetFields(); }}
        onOk={() => passwordForm.submit()}
        okText={t('users_admin.set')}
        cancelText={t('common.cancel')}
        confirmLoading={setPassword.isPending}
        destroyOnClose
      >
        <p style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 12 }}>
          {t('users_admin.reset_password_hint')}
        </p>
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={(values) => {
            if (!passwordTarget) return;
            setPassword.mutate({ id: passwordTarget.id, password: values.password });
          }}
        >
          <Form.Item
            name="password"
            label={t('users_admin.new_password')}
            rules={[
              { required: true, message: t('common.required') },
              { min: 8, message: t('users_admin.password_min') },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
