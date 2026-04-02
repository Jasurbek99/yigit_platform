import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Stack, Switch, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconBuildingBank, IconPlus } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAdminFirms, useCreateFirm, useUpdateFirm } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IExportFirm } from '@/types';

interface FirmFormValues {
  code: string;
  name_tk: string;
  name_en: string;
  name_ru: string;
  is_active: boolean;
}

export default function ExportFirmsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isDirector = user?.role === 'director';

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IExportFirm | null>(null);

  const form = useForm<FirmFormValues>({
    initialValues: {
      code: '',
      name_tk: '',
      name_en: '',
      name_ru: '',
      is_active: true,
    },
    validate: {
      code: (v) => (!v ? t('common.required') : null),
      name_tk: (v) => (!v ? t('common.required') : null),
    },
  });

  const { data, isLoading, isError } = useAdminFirms();
  const rows = data ?? [];

  const createMutation = useCreateFirm({
    onSuccess: () => {
      toast.success(t('firms_admin.toast_created'));
      setModalOpen(false);
      form.reset();
    },
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  const updateMutation = useUpdateFirm({
    onSuccess: () => {
      toast.success(t('firms_admin.toast_updated'));
      setModalOpen(false);
      form.reset();
    },
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  function handleOpenCreate() {
    setEditTarget(null);
    form.reset();
    form.setValues({ is_active: true });
    setModalOpen(true);
  }

  function handleOpenEdit(record: IExportFirm) {
    setEditTarget(record);
    form.setValues({
      code: record.code,
      name_tk: record.name_tk,
      name_en: record.name_en ?? '',
      name_ru: record.name_ru ?? '',
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleSubmit() {
    const result = form.validate();
    if (result.hasErrors) return;

    const values = form.values;
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, ...values });
    } else {
      createMutation.mutate(values);
    }
  }

  const columns = [
    {
      accessor: 'code' as keyof IExportFirm,
      title: t('firms_admin.code'),
      width: 100,
    },
    {
      accessor: 'name_tk' as keyof IExportFirm,
      title: t('firms_admin.name_tk'),
      width: 180,
    },
    {
      accessor: 'name_en' as keyof IExportFirm,
      title: t('firms_admin.name_en'),
      width: 180,
      render: (record: IExportFirm) =>
        record.name_en
          ? record.name_en
          : <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>,
    },
    {
      accessor: 'name_ru' as keyof IExportFirm,
      title: t('firms_admin.name_ru'),
      width: 180,
      render: (record: IExportFirm) =>
        record.name_ru
          ? record.name_ru
          : <span style={{ color: '#bfbfbf' }}>{t('common.empty')}</span>,
    },
    {
      accessor: 'is_active' as keyof IExportFirm,
      title: t('firms_admin.is_active'),
      width: 100,
      render: (record: IExportFirm) =>
        record.is_active ? (
          <Badge variant="light" color="green">{t('common.yes')}</Badge>
        ) : (
          <Badge variant="light" color="gray">{t('common.no')}</Badge>
        ),
    },
    ...(isDirector
      ? [
          {
            accessor: 'id' as keyof IExportFirm,
            title: '',
            width: 80,
            render: (record: IExportFirm) => (
              <Button variant="subtle" size="compact-xs" onClick={(e) => { e.stopPropagation(); handleOpenEdit(record); }}>
                {t('common.edit')}
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
            <IconBuildingBank size={18} color="#1677ff" />
            {t('firms_admin.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Eksport firmalaryny dolandyrmak
          </div>
        </div>
        {isDirector && (
          <Button leftSection={<IconPlus size={14} />} onClick={handleOpenCreate}>
            {t('firms_admin.add')}
          </Button>
        )}
      </Group>

      {isError && (
        <Alert color="red" mb="md">{t('firms_admin.error_load')}</Alert>
      )}

      <DataTable
        idAccessor="id"
        records={rows}
        columns={columns}
        fetching={isLoading}
        noRecordsText={t('firms_admin.empty') ?? 'Maglumat ýok'}
        verticalSpacing="xs"
        styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
      />

      <Modal
        opened={modalOpen}
        onClose={() => { setModalOpen(false); form.reset(); }}
        title={editTarget ? t('firms_admin.edit_title') : t('firms_admin.add')}
      >
        <Stack>
          <TextInput
            label={t('firms_admin.code')}
            {...form.getInputProps('code')}
          />
          <TextInput
            label={t('firms_admin.name_tk')}
            {...form.getInputProps('name_tk')}
          />
          <TextInput
            label={t('firms_admin.name_en')}
            {...form.getInputProps('name_en')}
          />
          <TextInput
            label={t('firms_admin.name_ru')}
            {...form.getInputProps('name_ru')}
          />
          <Switch
            label={t('firms_admin.is_active')}
            {...form.getInputProps('is_active', { type: 'checkbox' })}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => { setModalOpen(false); form.reset(); }}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={createMutation.isPending || updateMutation.isPending}
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
