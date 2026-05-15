import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Group,
  Pagination,
  Select,
  Stack,
  TextInput,
  Tooltip,
  Button,
} from '@mantine/core';
import { IconClipboardList, IconRefresh } from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useAuditLog } from '@/hooks/useAdmin';
import type { AuditAction, IAuditLog } from '@/types';

const PAGE_SIZE = 50;

const ACTION_COLOR: Record<AuditAction, string> = {
  transition: 'blue',
  create: 'green',
  update: 'orange',
};

export default function AuditLogPage() {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const [action, setAction] = useState<AuditAction | ''>('');
  const [modelName, setModelName] = useState('');
  const [objectIdInput, setObjectIdInput] = useState('');

  const objectIdParam = useMemo<number | ''>(() => {
    const trimmed = objectIdInput.trim();
    if (!trimmed) return '';
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : '';
  }, [objectIdInput]);

  const { data, isLoading, isError, refetch, isFetching } = useAuditLog({
    page,
    page_size: PAGE_SIZE,
    action,
    model_name: modelName.trim() || undefined,
    object_id: objectIdParam,
  });

  const rows = data?.results ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetFilters() {
    setAction('');
    setModelName('');
    setObjectIdInput('');
    setPage(1);
  }

  function onFilterChange<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  const actionOptions = [
    { value: '', label: t('audit_log.filter_all_actions') },
    { value: 'transition', label: t('audit_log.action_transition') },
    { value: 'create', label: t('audit_log.action_create') },
    { value: 'update', label: t('audit_log.action_update') },
  ];

  const columns = [
    {
      accessor: 'created_at' as keyof IAuditLog,
      title: t('audit_log.col_created_at'),
      width: 160,
      render: (r: IAuditLog) => (
        <Tooltip label={dayjs(r.created_at).format('DD.MM.YYYY HH:mm:ss')} withArrow>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {dayjs(r.created_at).format('DD.MM.YYYY HH:mm')}
          </span>
        </Tooltip>
      ),
    },
    {
      accessor: 'action' as keyof IAuditLog,
      title: t('audit_log.col_action'),
      width: 110,
      render: (r: IAuditLog) => (
        <Badge variant="light" color={ACTION_COLOR[r.action] ?? 'gray'}>
          {t(`audit_log.action_${r.action}`)}
        </Badge>
      ),
    },
    {
      accessor: 'user_name' as keyof IAuditLog,
      title: t('audit_log.col_user'),
      width: 140,
      render: (r: IAuditLog) =>
        r.user_name ?? (
          <span style={{ color: '#8c8c8c', fontStyle: 'italic' }}>
            {t('audit_log.system_user')}
          </span>
        ),
    },
    {
      accessor: 'model_name' as keyof IAuditLog,
      title: t('audit_log.col_model'),
      width: 140,
      render: (r: IAuditLog) => <code style={{ fontSize: 12 }}>{r.model_name}</code>,
    },
    {
      accessor: 'object_id' as keyof IAuditLog,
      title: t('audit_log.col_object_id'),
      width: 90,
      render: (r: IAuditLog) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.object_id}</span>
      ),
    },
    {
      accessor: 'object_repr' as keyof IAuditLog,
      title: t('audit_log.col_object_repr'),
      width: 200,
      ellipsis: true,
      render: (r: IAuditLog) => (
        <Tooltip label={r.object_repr} withArrow disabled={!r.object_repr}>
          <span>{r.object_repr || '—'}</span>
        </Tooltip>
      ),
    },
    {
      accessor: 'detail' as keyof IAuditLog,
      title: t('audit_log.col_detail'),
      render: (r: IAuditLog) =>
        r.detail ? (
          <span style={{ fontSize: 13 }}>{r.detail}</span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: '#1f1f1f',
              lineHeight: '1.3',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <IconClipboardList size={18} color="#1677ff" />
            {t('audit_log.title')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {t('audit_log.subtitle')}
          </div>
        </div>
        <Button
          variant="default"
          leftSection={<IconRefresh size={14} />}
          loading={isFetching && !isLoading}
          onClick={() => refetch()}
        >
          {t('audit_log.refresh')}
        </Button>
      </Group>

      {/* Filters */}
      <Group mb="md" gap="sm" wrap="wrap">
        <Select
          label={t('audit_log.filter_action')}
          data={actionOptions}
          value={action}
          onChange={(v) => onFilterChange(setAction, (v ?? '') as AuditAction | '')}
          allowDeselect={false}
          w={180}
        />
        <TextInput
          label={t('audit_log.filter_model')}
          placeholder={t('audit_log.placeholder_model')}
          value={modelName}
          onChange={(e) => onFilterChange(setModelName, e.currentTarget.value)}
          w={200}
        />
        <TextInput
          label={t('audit_log.filter_object_id')}
          placeholder={t('audit_log.placeholder_object_id')}
          value={objectIdInput}
          onChange={(e) => onFilterChange(setObjectIdInput, e.currentTarget.value)}
          w={140}
        />
        <Button variant="subtle" mt="lg" onClick={resetFilters}>
          {t('audit_log.filter_clear')}
        </Button>
      </Group>

      {isError && (
        <Alert color="red" mb="md">
          {t('audit_log.error_load')}
        </Alert>
      )}

      <Stack gap="sm">
        <DataTable
          idAccessor="id"
          records={rows}
          columns={columns}
          fetching={isLoading}
          noRecordsText={t('audit_log.empty')}
          verticalSpacing="xs"
          highlightOnHover
          styles={{ header: { backgroundColor: '#f5f5f5', fontSize: 13 } }}
        />

        {total > PAGE_SIZE && (
          <Group justify="space-between" align="center">
            <span style={{ fontSize: 13, color: '#8c8c8c' }}>
              {(page - 1) * PAGE_SIZE + 1}
              {'–'}
              {Math.min(page * PAGE_SIZE, total)}
              {' / '}
              {total}
            </span>
            <Pagination value={page} onChange={setPage} total={totalPages} size="sm" />
          </Group>
        )}
      </Stack>
    </div>
  );
}
