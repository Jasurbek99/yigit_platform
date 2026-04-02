import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Select, Stack, Switch, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconUsers } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
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
  role: UserRole | null;
  is_active: boolean;
}

const ROLE_COLORS: Record<UserRole, string> = {
  export_manager: 'blue',
  warehouse_chief: 'cyan',
  document_team: 'indigo',
  transport: 'orange',
  sales_rep: 'green',
  finansist: 'yellow',
  director: 'red',
  accountant: 'violet',
  greenhouse_manager: 'lime',
};

export default function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const isDirector = currentUser?.role === 'director';

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IAdminUser | null>(null);

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
    ...(isDirector
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
            Ulanyjylary we rugsatlary dolandyrmak
          </div>
        </div>
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

      <Modal
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
      </Modal>
    </div>
  );
}
