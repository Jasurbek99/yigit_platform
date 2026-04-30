import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal as MantineModal, Select, Stack, Switch, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconUsers } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Form, Input, Modal, Select as AntSelect, Switch as AntSwitch } from 'antd';
import { useAdminUsers, useUpdateUserRole, useCreateUser, useDeleteUser, useSetUserPassword } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IAdminUser, UserRole } from '@/types';

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

interface UserEditFormValues {
  role: UserRole | null;
  is_active: boolean;
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'red',
  export_manager: 'blue',
  loading_dept_head: 'gold',
  warehouse_chief: 'cyan',
  weight_master: 'geekblue',
  document_team: 'indigo',
  transport: 'orange',
  sales_rep: 'green',
  finansist: 'yellow',
  director: 'volcano',
  accountant: 'violet',
  greenhouse_manager: 'lime',
  seller: 'teal',
  boss: 'purple',
};

export default function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin' || currentUser?.is_superuser === true;
  const isSuperuser = currentUser?.is_superuser === true;

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IAdminUser | null>(null);

  // ─── Superuser: create user state ────────────────────────────────────────
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();

  // ─── Superuser: reset password state ─────────────────────────────────────
  const [passwordTarget, setPasswordTarget] = useState<IAdminUser | null>(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm] = Form.useForm();

  const form = useForm<UserEditFormValues>({
    initialValues: {
      role: null,
      is_active: true,
    },
    validate: {
      role: (v) => (!v ? t('common.required') : null),
    },
  });

  const { data, isLoading, isError } = useAdminUsers();
  const rows = data ?? [];

  const updateMutation = useUpdateUserRole({
    onSuccess: () => {
      toast.success(t('users_admin.toast_updated'));
      setModalOpen(false);
      form.reset();
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
    form.setValues({ role: record.role, is_active: record.is_active });
    setModalOpen(true);
  }

  function handleSubmit() {
    const result = form.validate();
    if (result.hasErrors || !editTarget || !form.values.role) return;
    updateMutation.mutate({ id: editTarget.id, role: form.values.role, is_active: form.values.is_active });
  }

  function handleCreateSubmit() {
    createForm.validateFields().then((values) => {
      createUser.mutate(values);
    });
  }

  function handleOpenPasswordModal(record: IAdminUser) {
    setPasswordTarget(record);
    passwordForm.resetFields();
    setPasswordModalOpen(true);
  }

  function handlePasswordSubmit() {
    if (!passwordTarget) return;
    passwordForm.validateFields().then((values) => {
      setPassword.mutate({ id: passwordTarget.id, password: values.password });
    });
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

  const columns = [
    {
      accessor: 'username' as keyof IAdminUser,
      title: t('users_admin.username'),
      width: 130,
    },
    {
      accessor: 'first_name' as keyof IAdminUser,
      title: t('users_admin.name'),
      width: 160,
      render: (record: IAdminUser) =>
        [record.first_name, record.last_name].filter(Boolean).join(' ') || (
          <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>
        ),
    },
    {
      accessor: 'email' as keyof IAdminUser,
      title: t('users_admin.email'),
      width: 200,
      render: (record: IAdminUser) =>
        record.email
          ? record.email
          : <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>,
    },
    {
      accessor: 'role' as keyof IAdminUser,
      title: t('users_admin.role'),
      width: 160,
      render: (record: IAdminUser) => (
        <Badge variant="light" color={ROLE_COLORS[record.role] ?? 'gray'}>
          {t(`roles.${record.role}`)}
        </Badge>
      ),
    },
    {
      accessor: 'is_active' as keyof IAdminUser,
      title: t('users_admin.is_active'),
      width: 90,
      render: (record: IAdminUser) =>
        record.is_active ? (
          <Badge variant="light" color="green">{t('common.yes')}</Badge>
        ) : (
          <Badge variant="light" color="gray">{t('common.no')}</Badge>
        ),
    },
    ...(isAdmin
      ? [
          {
            accessor: 'id' as keyof IAdminUser,
            title: '',
            width: 100,
            render: (record: IAdminUser) => (
              <Button variant="subtle" size="compact-xs" onClick={(e) => { e.stopPropagation(); handleOpenEdit(record); }}>
                {t('users_admin.edit_role')}
              </Button>
            ),
          },
        ]
      : []),
    ...(isSuperuser
      ? [
          {
            accessor: '_pw' as keyof IAdminUser,
            title: '',
            width: 120,
            render: (record: IAdminUser) => (
              <Button
                variant="subtle"
                size="compact-xs"
                color="orange"
                onClick={(e) => { e.stopPropagation(); handleOpenPasswordModal(record); }}
              >
                {t('users_admin.reset_password')}
              </Button>
            ),
          },
          {
            accessor: '_del' as keyof IAdminUser,
            title: '',
            width: 80,
            render: (record: IAdminUser) =>
              record.id === currentUser?.id ? null : (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  color="red"
                  onClick={(e) => { e.stopPropagation(); handleDeleteConfirm(record); }}
                >
                  {t('users_admin.delete_btn')}
                </Button>
              ),
          },
        ]
      : []),
  ];

  return (
    <div>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
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
            variant="filled"
            size="compact-sm"
            onClick={() => { createForm.resetFields(); setCreateModalOpen(true); }}
          >
            {t('users_admin.create')}
          </Button>
        )}
      </Group>

      {isError && (
        <Alert color="red" mb="md">{t('users_admin.error_load')}</Alert>
      )}

      <DataTable
        idAccessor="id"
        records={rows}
        columns={columns}
        fetching={isLoading}
        noRecordsText={t('users_admin.empty') ?? 'Maglumat ýok'}
        verticalSpacing="xs"
        styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
      />

      <MantineModal
        opened={modalOpen}
        onClose={() => { setModalOpen(false); form.reset(); }}
        title={t('users_admin.edit_role')}
      >
        {editTarget && (
          <Text size="sm" mb="md" c="dimmed">
            <strong>{editTarget.username}</strong>
            {editTarget.first_name || editTarget.last_name
              ? ` — ${[editTarget.first_name, editTarget.last_name].filter(Boolean).join(' ')}`
              : ''}
          </Text>
        )}
        <Stack>
          <Select
            label={t('users_admin.role')}
            data={ALL_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
            {...form.getInputProps('role')}
          />
          <Switch
            label={t('users_admin.is_active')}
            {...form.getInputProps('is_active', { type: 'checkbox' })}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => { setModalOpen(false); form.reset(); }}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={updateMutation.isPending}
              onClick={handleSubmit}
            >
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </MantineModal>

      {/* ── Superuser: Create User Modal (Ant Design) ─────────────────── */}
      <Modal
        title={t('users_admin.create_title')}
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={handleCreateSubmit}
        okText={t('users_admin.create_title')}
        cancelText={t('common.cancel')}
        confirmLoading={createUser.isPending}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 8 }}>
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
            <AntSelect
              options={ALL_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
            />
          </Form.Item>
          <Form.Item name="is_active" label={t('users_admin.is_active')} valuePropName="checked" initialValue={true}>
            <AntSwitch />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Superuser: Set Password Modal (Ant Design) ────────────────── */}
      <Modal
        title={t('users_admin.reset_password_title', { username: passwordTarget?.username ?? '' })}
        open={passwordModalOpen}
        onCancel={() => { setPasswordModalOpen(false); setPasswordTarget(null); passwordForm.resetFields(); }}
        onOk={handlePasswordSubmit}
        okText={t('users_admin.set')}
        cancelText={t('common.cancel')}
        confirmLoading={setPassword.isPending}
        destroyOnClose
      >
        <p style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 12 }}>
          {t('users_admin.reset_password_hint')}
        </p>
        <Form form={passwordForm} layout="vertical">
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
