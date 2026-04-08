import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Progress,
  Select,
  SimpleGrid,
  Skeleton,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminFirms } from '@/hooks/useAdmin';
import {
  useQuotaDashboard,
  useCreateQuota,
  useUpdateQuota,
  useDeleteQuota,
} from '@/hooks/usePlanning';
import { QuotaFirmSummaryTab } from './QuotaFirmSummary';
import type { IQuotaAllocation, QuotaStatus } from '@/types';

function pctColor(pct: number): string {
  if (pct >= 95) return 'red';
  if (pct >= 80) return 'orange';
  return 'green';
}

function fmtKg(val: number | null | undefined): string {
  if (val == null) return '—';
  return `${Number(val).toLocaleString()} kg`;
}

function statusBadge(status: QuotaStatus, t: (key: string) => string) {
  const map: Record<QuotaStatus, { color: string; label: string }> = {
    active: { color: 'green', label: t('quota.status_active') },
    expired: { color: 'gray', label: t('quota.status_expired') },
    exhausted: { color: 'red', label: t('quota.status_exhausted') },
  };
  const { color, label } = map[status] ?? map.active;
  return (
    <Badge variant="light" color={color}>
      {label}
    </Badge>
  );
}

function StatCard({
  title,
  value,
  color,
}: {
  title: string;
  value: string | number;
  color?: string;
}) {
  return (
    <Card padding="md">
      <Text size="xs" c="dimmed" mb={4}>
        {title}
      </Text>
      <Text fw={700} size="xl" c={color}>
        {value}
      </Text>
    </Card>
  );
}

interface IFormValues {
  export_firm: string;
  domestic_sale_kg: number;
  domestic_sale_date: Date | null;
  granted_kg: number;
  valid_from: Date | null;
  valid_to: Date | null;
  notes: string;
}

const MULTIPLIER = 10;

function toISODate(d: Date | null): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

export default function QuotaDashboard() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string | null>('quotas');
  const [firmFilter, setFirmFilter] = useState<number | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuota, setEditingQuota] = useState<IQuotaAllocation | null>(null);

  const filters: { export_firm?: number; status?: string } = {};
  if (firmFilter) filters.export_firm = firmFilter;
  if (statusFilter) filters.status = statusFilter;

  const { data: quotas, isLoading, isError } = useQuotaDashboard(filters);

  function handleFirmClick(firmId: number) {
    setFirmFilter(firmId);
    setActiveTab('quotas');
  }

  function clearFirmFilter() {
    setFirmFilter(undefined);
  }
  const { data: firms = [] } = useAdminFirms();
  const createMutation = useCreateQuota();
  const updateMutation = useUpdateQuota();
  const deleteMutation = useDeleteQuota();

  const firmOptions = firms.map((f) => ({
    value: String(f.id),
    label: f.name_en || f.name_tk,
  }));

  const form = useForm<IFormValues>({
    initialValues: {
      export_firm: '',
      domestic_sale_kg: 0,
      domestic_sale_date: null,
      granted_kg: 0,
      valid_from: null,
      valid_to: null,
      notes: '',
    },
    validate: {
      export_firm: (v) => (v ? null : t('common.required')),
      domestic_sale_kg: (v) => (v > 0 ? null : t('common.required')),
      granted_kg: (v) => (v > 0 ? null : t('common.required')),
      valid_from: (v) => (v ? null : t('common.required')),
      valid_to: (v, values) => {
        if (!v) return t('common.required');
        if (values.valid_from && v < values.valid_from) return t('quota.valid_to_error');
        return null;
      },
    },
  });

  const expectedKg = form.values.domestic_sale_kg * MULTIPLIER;

  function openCreate() {
    setEditingQuota(null);
    form.reset();
    setModalOpen(true);
  }

  function openEdit(record: IQuotaAllocation) {
    setEditingQuota(record);
    form.setValues({
      export_firm: String(record.export_firm),
      domestic_sale_kg: record.domestic_sale_kg,
      domestic_sale_date: record.domestic_sale_date ? new Date(record.domestic_sale_date) : null,
      granted_kg: record.granted_kg,
      valid_from: new Date(record.valid_from),
      valid_to: new Date(record.valid_to),
      notes: record.notes || '',
    });
    setModalOpen(true);
  }

  function handleDelete(record: IQuotaAllocation) {
    if (!confirm(t('quota.confirm_delete'))) return;
    deleteMutation.mutate(record.id, {
      onSuccess: () => notifications.show({ message: t('quota.toast_deleted'), color: 'green' }),
    });
  }

  function handleSubmit(values: IFormValues) {
    const payload = {
      export_firm: Number(values.export_firm),
      domestic_sale_kg: values.domestic_sale_kg,
      domestic_sale_date: toISODate(values.domestic_sale_date) || null,
      expected_kg: values.domestic_sale_kg * MULTIPLIER,
      granted_kg: values.granted_kg,
      valid_from: toISODate(values.valid_from),
      valid_to: toISODate(values.valid_to),
      notes: values.notes,
    };

    if (editingQuota) {
      updateMutation.mutate(
        { id: editingQuota.id, ...payload },
        {
          onSuccess: () => {
            notifications.show({ message: t('quota.toast_updated'), color: 'green' });
            setModalOpen(false);
          },
        },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          notifications.show({ message: t('quota.toast_created'), color: 'green' });
          setModalOpen(false);
        },
      });
    }
  }

  // Auto-fill granted_kg with expected when creating
  useEffect(() => {
    if (!editingQuota && form.values.domestic_sale_kg > 0) {
      form.setFieldValue('granted_kg', form.values.domestic_sale_kg * MULTIPLIER);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values.domestic_sale_kg, editingQuota]);

  const activeQuotas = quotas?.filter((q) => q.status_label === 'active') ?? [];
  const totalGranted = activeQuotas.reduce((s, q) => s + Number(q.granted_kg), 0);
  const totalUsed = activeQuotas.reduce((s, q) => s + Number(q.used_kg), 0);
  const criticalCount = activeQuotas.filter((q) => q.used_pct >= 95).length;
  const warningCount = activeQuotas.filter((q) => q.used_pct >= 80 && q.used_pct < 95).length;

  const columns = [
    {
      accessor: 'export_firm_name' as keyof IQuotaAllocation,
      title: t('quota.firm'),
      width: 150,
      render: (record: IQuotaAllocation) => record.export_firm_name ?? '—',
    },
    {
      accessor: 'domestic_sale_kg' as keyof IQuotaAllocation,
      title: t('quota.domestic_sale'),
      width: 110,
      render: (record: IQuotaAllocation) => fmtKg(record.domestic_sale_kg),
    },
    {
      accessor: 'expected_kg' as keyof IQuotaAllocation,
      title: t('quota.expected'),
      width: 110,
      render: (record: IQuotaAllocation) => fmtKg(record.expected_kg),
    },
    {
      accessor: 'granted_kg' as keyof IQuotaAllocation,
      title: t('quota.granted'),
      width: 110,
      render: (record: IQuotaAllocation) => fmtKg(record.granted_kg),
    },
    {
      accessor: 'difference_kg' as keyof IQuotaAllocation,
      title: t('quota.difference'),
      width: 100,
      render: (record: IQuotaAllocation) => {
        const diff = Number(record.difference_kg);
        const color = diff < 0 ? '#ff4d4f' : diff > 0 ? '#52c41a' : undefined;
        return (
          <span style={{ color }}>
            {diff > 0 ? '+' : ''}
            {fmtKg(diff)}
          </span>
        );
      },
    },
    {
      accessor: 'used_kg' as keyof IQuotaAllocation,
      title: t('quota.used'),
      width: 110,
      render: (record: IQuotaAllocation) => fmtKg(record.used_kg),
    },
    {
      accessor: 'remaining_kg' as keyof IQuotaAllocation,
      title: t('quota.remaining'),
      width: 110,
      render: (record: IQuotaAllocation) => (
        <span
          style={{
            color:
              record.remaining_kg <= 0
                ? '#ff4d4f'
                : record.remaining_kg < 5000
                  ? '#fa8c16'
                  : '#52c41a',
          }}
        >
          {fmtKg(record.remaining_kg)}
        </span>
      ),
    },
    {
      accessor: 'used_pct' as keyof IQuotaAllocation,
      title: t('quota.used_pct'),
      width: 140,
      render: (record: IQuotaAllocation) => (
        <Progress
          value={Math.min(record.used_pct, 100)}
          color={pctColor(record.used_pct)}
          size="sm"
        />
      ),
    },
    {
      accessor: 'valid_from' as keyof IQuotaAllocation,
      title: t('quota.validity'),
      width: 160,
      render: (record: IQuotaAllocation) => `${record.valid_from} — ${record.valid_to}`,
    },
    {
      accessor: 'status_label' as keyof IQuotaAllocation,
      title: t('quota.status'),
      width: 100,
      render: (record: IQuotaAllocation) => statusBadge(record.status_label, t),
    },
    {
      accessor: 'actions',
      title: '',
      width: 80,
      render: (record: IQuotaAllocation) => (
        <Group gap={4} wrap="nowrap">
          <Tooltip label={t('common.edit')}>
            <ActionIcon variant="subtle" size="sm" onClick={() => openEdit(record)}>
              <IconEdit size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('common.delete')}>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="red"
              onClick={() => handleDelete(record)}
              loading={deleteMutation.isPending}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ),
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: '#1f1f1f',
              lineHeight: '1.3',
            }}
          >
            {t('quota.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('quota.subtitle')}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onChange={setActiveTab} mb="md">
        <Tabs.List>
          <Tabs.Tab value="quotas">{t('quota.tab_quotas')}</Tabs.Tab>
          <Tabs.Tab value="by-firm">{t('quota.tab_by_firm')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="quotas" pt="md">
          {/* Toolbar */}
          <Group justify="space-between" mb="md">
            <Group gap="sm">
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                data={[
                  { value: 'active', label: t('quota.status_active') },
                  { value: 'expired', label: t('quota.status_expired') },
                  { value: 'exhausted', label: t('quota.status_exhausted') },
                ]}
                placeholder={t('quota.all_statuses')}
                clearable
                style={{ width: 180 }}
              />
              {firmFilter && (
                <Button variant="light" size="xs" onClick={clearFirmFilter}>
                  {t('quota.clear_firm_filter')}
                </Button>
              )}
            </Group>
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              {t('quota.add_button')}
            </Button>
          </Group>

          {isError && (
            <Alert color="red" mb="md">
              {t('quota.error_load')}
            </Alert>
          )}

          {/* Summary cards — active quotas only */}
          <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
            <StatCard
              title={t('quota.total_granted')}
              value={`${Number(totalGranted).toLocaleString()} kg`}
            />
            <StatCard
              title={t('quota.total_used')}
              value={`${Number(totalUsed).toLocaleString()} kg`}
              color="blue"
            />
            <StatCard title={t('quota.warning_firms')} value={warningCount} color="orange" />
            <StatCard title={t('quota.critical_firms')} value={criticalCount} color="red" />
          </SimpleGrid>

          {isLoading ? (
            <Skeleton height={300} />
          ) : (
            <DataTable
              idAccessor="id"
              records={quotas ?? []}
              columns={columns}
              noRecordsText={t('quota.empty') ?? 'Maglumat ýok'}
              verticalSpacing="xs"
              styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
            />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="by-firm" pt="md">
          <QuotaFirmSummaryTab onFirmClick={handleFirmClick} />
        </Tabs.Panel>
      </Tabs>

      {/* Create / Edit modal */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingQuota ? t('quota.edit_title') : t('quota.add_title')}
        size="lg"
      >
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Select
            label={t('quota.firm')}
            data={firmOptions}
            searchable
            required
            mb="sm"
            {...form.getInputProps('export_firm')}
          />

          <Group grow mb="sm">
            <NumberInput
              label={t('quota.domestic_sale')}
              suffix=" kg"
              min={0}
              required
              {...form.getInputProps('domestic_sale_kg')}
            />
            <DateInput
              label={t('quota.domestic_sale_date')}
              valueFormat="YYYY-MM-DD"
              clearable
              {...form.getInputProps('domestic_sale_date')}
            />
          </Group>

          <Group grow mb="sm">
            <NumberInput
              label={t('quota.expected')}
              suffix=" kg"
              value={expectedKg}
              readOnly
              variant="filled"
            />
            <NumberInput
              label={t('quota.granted')}
              suffix=" kg"
              min={0}
              required
              {...form.getInputProps('granted_kg')}
            />
          </Group>

          {expectedKg > 0 && form.values.granted_kg > 0 && (
            <Text size="xs" c={form.values.granted_kg < expectedKg ? 'red' : 'green'} mb="sm">
              {t('quota.difference')}: {form.values.granted_kg >= expectedKg ? '+' : ''}
              {(form.values.granted_kg - expectedKg).toLocaleString()} kg
            </Text>
          )}

          <Group grow mb="sm">
            <DateInput
              label={t('quota.valid_from')}
              valueFormat="YYYY-MM-DD"
              required
              {...form.getInputProps('valid_from')}
            />
            <DateInput
              label={t('quota.valid_to')}
              valueFormat="YYYY-MM-DD"
              required
              {...form.getInputProps('valid_to')}
            />
          </Group>

          <TextInput
            label={t('quota.notes')}
            mb="md"
            {...form.getInputProps('notes')}
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {editingQuota ? t('common.save') : t('common.add')}
            </Button>
          </Group>
        </form>
      </Modal>
    </div>
  );
}
