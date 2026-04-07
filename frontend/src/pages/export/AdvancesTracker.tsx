import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from 'mantine-datatable';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { DatePickerInput } from '@mantine/dates';
import { IconCurrencyDollar, IconPlus } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import {
  useAdvances,
  useAdvanceDetail,
  useReconcileAdvance,
  useCreateAdvance,
} from '@/hooks/useAdvances';
import type { ICreateAdvancePayload } from '@/hooks/useAdvances';
import type {
  IFinansistAdvanceListItem,
  IAdvanceShipmentLink,
} from '@/types';
import { useAuth } from '@/hooks/useAuth';

// ─── Constants ────────────────────────────────────────────────────────────────

type ReconcileFilter = 'all' | 'pending' | 'reconciled';

const CAN_CREATE_ROLES = new Set(['finansist', 'export_manager', 'director']);

// ─── Linked Shipments Sub-table ───────────────────────────────────────────────

interface LinkedShipmentsProps {
  advanceId: number;
  noShipmentsLabel: string;
  cargoCodeLabel: string;
  allocatedAmountLabel: string;
}

function LinkedShipmentsPanel({
  advanceId,
  noShipmentsLabel,
  cargoCodeLabel,
  allocatedAmountLabel,
}: LinkedShipmentsProps) {
  const { data, isLoading } = useAdvanceDetail(advanceId);

  const links: IAdvanceShipmentLink[] = data?.shipment_links ?? [];

  if (!isLoading && links.length === 0) {
    return <Text c="dimmed" size="sm">{noShipmentsLabel}</Text>;
  }

  const cols = [
    {
      accessor: 'shipment_cargo_code' as keyof IAdvanceShipmentLink,
      title: cargoCodeLabel,
    },
    {
      accessor: 'allocated_amount' as keyof IAdvanceShipmentLink,
      title: allocatedAmountLabel,
      render: (record: IAdvanceShipmentLink) =>
        record.allocated_amount != null ? `$${record.allocated_amount.toLocaleString()}` : '—',
    },
  ];

  return (
    <DataTable
      idAccessor="shipment"
      records={links}
      columns={cols}
      fetching={isLoading}
      noRecordsText={noShipmentsLabel}
      verticalSpacing="xs"
      styles={{ root: { maxWidth: 480 } }}
    />
  );
}

// ─── New Advance Modal ────────────────────────────────────────────────────────

interface NewAdvanceFormValues {
  batch_code: string;
  advance_date: Date | null;
  total_amount: number | string;
  currency: string;
  purpose: string;
  notes: string;
}

interface NewAdvanceModalProps {
  open: boolean;
  onClose: () => void;
}

function NewAdvanceModal({ open, onClose }: NewAdvanceModalProps) {
  const { t } = useTranslation();
  const createAdvance = useCreateAdvance();

  const form = useForm<NewAdvanceFormValues>({
    initialValues: {
      batch_code: '',
      advance_date: null,
      total_amount: '',
      currency: 'USD',
      purpose: '',
      notes: '',
    },
    validate: {
      advance_date: (v) => (!v ? t('common.required') : null),
      total_amount: (v) => (!v ? t('common.required') : null),
      currency: (v) => (!v ? t('common.required') : null),
    },
  });

  function handleSubmit() {
    const result = form.validate();
    if (result.hasErrors) return;

    const values = form.values;
    const payload: ICreateAdvancePayload = {
      batch_code: values.batch_code || undefined,
      advance_date: values.advance_date
        ? dayjs(values.advance_date).format('YYYY-MM-DD')
        : '',
      total_amount: Number(values.total_amount),
      currency: values.currency,
      purpose: values.purpose || undefined,
      notes: values.notes || undefined,
    } as ICreateAdvancePayload;

    createAdvance.mutate(payload, {
      onSuccess: () => {
        toast.success(t('advances.create_success'));
        form.reset();
        onClose();
      },
      onError: () => {
        toast.error(t('advances.error_load'));
      },
    });
  }

  function handleCancel() {
    form.reset();
    onClose();
  }

  return (
    <Modal
      opened={open}
      onClose={handleCancel}
      title={t('advances.new_advance')}
    >
      <Stack>
        <TextInput
          label={t('advances.batch_code')}
          placeholder="ADV-2026-XXX"
          {...form.getInputProps('batch_code')}
        />
        <DatePickerInput
          label={t('advances.date')}
          valueFormat="DD.MM.YYYY"
          {...form.getInputProps('advance_date')}
          value={form.values.advance_date}
          onChange={(val) => form.setFieldValue('advance_date', val)}
        />
        <NumberInput
          label={t('advances.amount')}
          min={0}
          decimalScale={2}
          prefix="$"
          {...form.getInputProps('total_amount')}
        />
        <TextInput
          label={t('advances.currency')}
          {...form.getInputProps('currency')}
        />
        <TextInput
          label={t('advances.purpose')}
          {...form.getInputProps('purpose')}
        />
        <Textarea
          label={t('advances.notes')}
          rows={3}
          {...form.getInputProps('notes')}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={createAdvance.isPending}
            onClick={handleSubmit}
          >
            {t('advances.new_advance')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function StatCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <Card padding="md">
      <Text size="xs" c="dimmed" mb={4}>{title}</Text>
      <Text fw={700} size="xl" c={color}>{value}</Text>
    </Card>
  );
}

export default function AdvancesTracker() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<ReconcileFilter>('all');
  const [newAdvanceOpen, setNewAdvanceOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);

  const reconcileFilter =
    filter === 'all' ? undefined : filter === 'reconciled' ? true : false;

  // ── Server data ────────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useAdvances({ reconciled: reconcileFilter });
  const reconcileAdvance = useReconcileAdvance();

  // ── Derived ────────────────────────────────────────────────────────────────
  const advances = data?.results ?? [];

  const { totalCount, totalAmount, unreconciledCount, unreconciledAmount } =
    useMemo(() => {
      const all = data?.results ?? [];
      const unreconciled = all.filter((a) => !a.reconciled);
      return {
        totalCount: data?.count ?? 0,
        totalAmount: all.reduce((sum, a) => sum + a.total_amount, 0),
        unreconciledCount: unreconciled.length,
        unreconciledAmount: unreconciled.reduce(
          (sum, a) => sum + a.total_amount,
          0,
        ),
      };
    }, [data]);

  const canCreate = user ? CAN_CREATE_ROLES.has(user.role) : false;

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleReconcile(id: number) {
    reconcileAdvance.mutate(id, {
      onSuccess: () => toast.success(t('advances.reconciled')),
      onError: () => toast.error(t('advances.error_load')),
    });
  }

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = [
    {
      accessor: 'batch_code' as keyof IFinansistAdvanceListItem,
      title: t('advances.batch_code'),
      width: 150,
      render: (record: IFinansistAdvanceListItem) =>
        record.batch_code ? (
          <Anchor component="span" style={{ fontFamily: 'monospace' }}>{record.batch_code}</Anchor>
        ) : (
          <Text c="dimmed">—</Text>
        ),
    },
    {
      accessor: 'advance_date' as keyof IFinansistAdvanceListItem,
      title: t('advances.date'),
      width: 110,
      render: (record: IFinansistAdvanceListItem) =>
        dayjs(record.advance_date).format('DD.MM.YYYY'),
    },
    {
      accessor: 'total_amount' as keyof IFinansistAdvanceListItem,
      title: t('advances.amount'),
      width: 130,
      render: (record: IFinansistAdvanceListItem) => (
        <Text fw={600}>${record.total_amount.toLocaleString()}</Text>
      ),
    },
    {
      accessor: 'currency' as keyof IFinansistAdvanceListItem,
      title: t('advances.currency'),
      width: 90,
      render: (record: IFinansistAdvanceListItem) => record.currency,
    },
    {
      accessor: 'purpose' as keyof IFinansistAdvanceListItem,
      title: t('advances.purpose'),
      render: (record: IFinansistAdvanceListItem) =>
        record.purpose ?? <Text c="dimmed">—</Text>,
    },
    {
      accessor: 'shipment_count' as keyof IFinansistAdvanceListItem,
      title: t('advances.shipments'),
      width: 100,
      render: (record: IFinansistAdvanceListItem) => (
        <Badge variant="light" color={record.shipment_count > 0 ? 'blue' : 'gray'}>
          {record.shipment_count}
        </Badge>
      ),
    },
    {
      accessor: 'allocated_total' as keyof IFinansistAdvanceListItem,
      title: t('advances.allocated'),
      width: 130,
      render: (record: IFinansistAdvanceListItem) => {
        const isOver = record.allocated_total > record.total_amount;
        return (
          <Text c={isOver ? 'red' : undefined}>
            ${record.allocated_total.toLocaleString()}
          </Text>
        );
      },
    },
    {
      accessor: 'reconciled' as keyof IFinansistAdvanceListItem,
      title: t('advances.status'),
      width: 120,
      render: (record: IFinansistAdvanceListItem) =>
        record.reconciled ? (
          <Badge variant="light" color="green">{t('advances.reconciled')}</Badge>
        ) : (
          <Badge variant="light" color="orange">{t('advances.pending')}</Badge>
        ),
    },
    {
      accessor: 'issued_by_name' as keyof IFinansistAdvanceListItem,
      title: t('advances.issued_by'),
      width: 120,
      render: (record: IFinansistAdvanceListItem) => record.issued_by_name,
    },
    {
      accessor: 'id' as keyof IFinansistAdvanceListItem,
      title: t('advances.reconcile'),
      width: 100,
      render: (record: IFinansistAdvanceListItem) =>
        !record.reconciled && canCreate ? (
          <Button
            size="compact-xs"
            variant="subtle"
            loading={
              reconcileAdvance.isPending &&
              reconcileAdvance.variables === record.id
            }
            onClick={(e) => {
              e.stopPropagation();
              handleReconcile(record.id);
            }}
          >
            {t('advances.reconcile')}
          </Button>
        ) : null,
    },
  ];

  // ── Early returns ──────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Alert color="red" m="md">{t('advances.error_load')}</Alert>
    );
  }

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '0 4px' }}>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: '#1f1f1f', lineHeight: '1.3', display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconCurrencyDollar size={18} color="#1677ff" />
            {t('advances.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('advances.subtitle')}
          </div>
        </div>
        {canCreate && (
          <Button
            leftSection={<IconPlus size={14} />}
            onClick={() => setNewAdvanceOpen(true)}
          >
            {t('advances.new_advance')}
          </Button>
        )}
      </Group>

      {/* Summary cards */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
        <StatCard title={t('advances.total_advances')} value={totalCount} />
        <StatCard title={t('advances.total_amount')} value={`$${totalAmount.toLocaleString()}`} />
        <StatCard
          title={t('advances.unreconciled')}
          value={unreconciledCount}
          color={unreconciledCount > 0 ? 'orange' : undefined}
        />
        <StatCard
          title={t('advances.unreconciled_amount')}
          value={`$${unreconciledAmount.toLocaleString()}`}
          color={unreconciledAmount > 0 ? 'orange' : undefined}
        />
      </SimpleGrid>

      {/* Filter */}
      <Group mb="md">
        <SegmentedControl
          value={filter}
          data={[
            { label: t('advances.all'), value: 'all' },
            { label: t('advances.pending'), value: 'pending' },
            { label: t('advances.reconciled'), value: 'reconciled' },
          ]}
          onChange={(v) => setFilter(v as ReconcileFilter)}
        />
      </Group>

      {/* Table with row expansion */}
      <DataTable
        idAccessor="id"
        records={advances}
        columns={columns}
        fetching={isLoading}
        noRecordsText={t('advances.empty') ?? 'Maglumat ýok'}
        verticalSpacing="xs"
        styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
        rowExpansion={{
          content: ({ record }) => (
            <div style={{ padding: '8px 0 8px 16px' }}>
              <Text c="dimmed" size="sm" mb="xs">
                {t('advances.linked_shipments')}
              </Text>
              <LinkedShipmentsPanel
                advanceId={record.id}
                noShipmentsLabel={t('advances.no_shipments')}
                cargoCodeLabel={t('advances.cargo_code')}
                allocatedAmountLabel={t('advances.allocated_amount')}
              />
            </div>
          ),
          expanded: {
            recordIds: expandedIds,
            onRecordIdsChange: (ids: unknown[]) => setExpandedIds(ids as number[]),
          },
        }}
      />

      {/* New advance modal */}
      <NewAdvanceModal
        open={newAdvanceOpen}
        onClose={() => setNewAdvanceOpen(false)}
      />
    </div>
  );
}
