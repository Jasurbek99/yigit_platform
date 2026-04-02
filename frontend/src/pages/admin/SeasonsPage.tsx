import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { DatePickerInput } from '@mantine/dates';
import { IconCalendar, IconPlus } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useSeasons, useCreateSeason, useUpdateSeason, useDeleteSeason } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { ISeason } from '@/types';

interface SeasonFormValues {
  name: string;
  start_date: Date | null;
  end_date: Date | null;
  is_active: boolean;
}

export default function SeasonsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isDirector = user?.role === 'director';

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ISeason | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ISeason | null>(null);

  const form = useForm<SeasonFormValues>({
    initialValues: {
      name: '',
      start_date: null,
      end_date: null,
      is_active: true,
    },
    validate: {
      name: (v) => (!v ? t('common.required') : null),
      start_date: (v) => (!v ? t('common.required') : null),
      end_date: (v) => (!v ? t('common.required') : null),
    },
  });

  const { data, isLoading, isError } = useSeasons();
  const rows = data ?? [];

  const createMutation = useCreateSeason({
    onSuccess: () => {
      toast.success(t('seasons.toast_created'));
      setModalOpen(false);
      form.reset();
    },
    onError: () => toast.error(t('seasons.toast_error')),
  });

  const updateMutation = useUpdateSeason({
    onSuccess: () => {
      toast.success(t('seasons.toast_updated'));
      setModalOpen(false);
      form.reset();
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
    form.reset();
    form.setValues({ is_active: true });
    setModalOpen(true);
  }

  function handleOpenEdit(record: ISeason) {
    setEditTarget(record);
    form.setValues({
      name: record.name,
      start_date: record.start_date ? new Date(record.start_date) : null,
      end_date: record.end_date ? new Date(record.end_date) : null,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleSubmit() {
    const result = form.validate();
    if (result.hasErrors) return;

    const values = form.values;
    const payload = {
      name: values.name,
      start_date: values.start_date ? dayjs(values.start_date).format('YYYY-MM-DD') : '',
      end_date: values.end_date ? dayjs(values.end_date).format('YYYY-MM-DD') : '',
      is_active: values.is_active,
    };

    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const columns = [
    {
      accessor: 'name' as keyof ISeason,
      title: t('seasons.name'),
      width: 180,
    },
    {
      accessor: 'start_date' as keyof ISeason,
      title: t('seasons.start_date'),
      width: 120,
      render: (record: ISeason) =>
        record.start_date ? dayjs(record.start_date).format('DD.MM.YYYY') : '—',
    },
    {
      accessor: 'end_date' as keyof ISeason,
      title: t('seasons.end_date'),
      width: 120,
      render: (record: ISeason) =>
        record.end_date ? dayjs(record.end_date).format('DD.MM.YYYY') : '—',
    },
    {
      accessor: 'is_active' as keyof ISeason,
      title: t('seasons.is_active'),
      width: 100,
      render: (record: ISeason) =>
        record.is_active ? (
          <Badge variant="light" color="green">{t('common.yes')}</Badge>
        ) : (
          <Badge variant="light" color="gray">{t('common.no')}</Badge>
        ),
    },
    ...(isDirector
      ? [
          {
            accessor: 'id' as keyof ISeason,
            title: '',
            width: 160,
            render: (record: ISeason) => (
              <Group gap="xs">
                <Button variant="subtle" size="compact-xs" onClick={(e) => { e.stopPropagation(); handleOpenEdit(record); }}>
                  {t('common.edit')}
                </Button>
                <Button variant="subtle" size="compact-xs" color="red" onClick={(e) => { e.stopPropagation(); setDeleteTarget(record); }}>
                  {t('common.delete')}
                </Button>
              </Group>
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
            <IconCalendar size={18} color="#1677ff" />
            {t('seasons.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            Eksport möwsümlerini dolandyrmak
          </div>
        </div>
        {isDirector && (
          <Button leftSection={<IconPlus size={14} />} onClick={handleOpenCreate}>
            {t('seasons.add')}
          </Button>
        )}
      </Group>

      {isError && (
        <Alert color="red" mb="md">{t('seasons.error_load')}</Alert>
      )}

      <DataTable
        idAccessor="id"
        records={rows}
        columns={columns}
        fetching={isLoading}
        noRecordsText={t('seasons.empty') ?? 'Maglumat ýok'}
        verticalSpacing="xs"
        styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
      />

      {/* Create/Edit Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => { setModalOpen(false); form.reset(); }}
        title={editTarget ? t('seasons.edit_title') : t('seasons.add')}
      >
        <Stack>
          <TextInput
            label={t('seasons.name')}
            {...form.getInputProps('name')}
          />
          <DatePickerInput
            label={t('seasons.start_date')}
            valueFormat="DD.MM.YYYY"
            {...form.getInputProps('start_date')}
            value={form.values.start_date}
            onChange={(val) => form.setFieldValue('start_date', val)}
          />
          <DatePickerInput
            label={t('seasons.end_date')}
            valueFormat="DD.MM.YYYY"
            {...form.getInputProps('end_date')}
            value={form.values.end_date}
            onChange={(val) => form.setFieldValue('end_date', val)}
          />
          <Switch
            label={t('seasons.is_active')}
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

      {/* Delete Confirmation Modal */}
      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('seasons.confirm_delete')}
        size="sm"
      >
        <Stack>
          <Text size="sm">{deleteTarget?.name}</Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="red"
              loading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
