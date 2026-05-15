import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Input,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { IconClipboardList, IconRefresh } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { useAuditLog } from '@/hooks/useAdmin';
import type { AuditAction, IAuditLog } from '@/types';

const { Text } = Typography;

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

  const rows = useMemo(() => data?.results ?? [], [data?.results]);
  const total = data?.count ?? 0;

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

  const columns: ProColumns<IAuditLog>[] = [
    {
      title: t('audit_log.col_created_at'),
      dataIndex: 'created_at',
      width: 160,
      search: false,
      render: (_, r) => (
        <Tooltip title={dayjs(r.created_at).format('DD.MM.YYYY HH:mm:ss')}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {dayjs(r.created_at).format('DD.MM.YYYY HH:mm')}
          </span>
        </Tooltip>
      ),
    },
    {
      title: t('audit_log.col_action'),
      dataIndex: 'action',
      width: 110,
      search: false,
      render: (_, r) => (
        <Tag color={ACTION_COLOR[r.action] ?? 'default'}>
          {t(`audit_log.action_${r.action}`)}
        </Tag>
      ),
    },
    {
      title: t('audit_log.col_user'),
      dataIndex: 'user_name',
      width: 140,
      search: false,
      render: (_, r) =>
        r.user_name ?? (
          <span style={{ color: '#8c8c8c', fontStyle: 'italic' }}>
            {t('audit_log.system_user')}
          </span>
        ),
    },
    {
      title: t('audit_log.col_model'),
      dataIndex: 'model_name',
      width: 140,
      search: false,
      render: (_, r) => <code style={{ fontSize: 12 }}>{r.model_name}</code>,
    },
    {
      title: t('audit_log.col_object_id'),
      dataIndex: 'object_id',
      width: 90,
      search: false,
      render: (_, r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.object_id}</span>
      ),
    },
    {
      title: t('audit_log.col_object_repr'),
      dataIndex: 'object_repr',
      width: 200,
      ellipsis: true,
      search: false,
      render: (_, r) => (
        <Tooltip title={r.object_repr || ''}>
          <span>{r.object_repr || '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: t('audit_log.col_detail'),
      dataIndex: 'detail',
      search: false,
      render: (_, r) =>
        r.detail ? (
          <span style={{ fontSize: 13 }}>{r.detail}</span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
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
          icon={<IconRefresh size={14} />}
          loading={isFetching && !isLoading}
          onClick={() => refetch()}
        >
          {t('audit_log.refresh')}
        </Button>
      </Space>

      <Space wrap style={{ marginBottom: 16 }} align="end">
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            {t('audit_log.filter_action')}
          </Text>
          <Select
            value={action}
            onChange={(v) => onFilterChange(setAction, (v ?? '') as AuditAction | '')}
            options={actionOptions}
            style={{ width: 180 }}
          />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            {t('audit_log.filter_model')}
          </Text>
          <Input
            placeholder={t('audit_log.placeholder_model')}
            value={modelName}
            onChange={(e) => onFilterChange(setModelName, e.currentTarget.value)}
            style={{ width: 200 }}
          />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            {t('audit_log.filter_object_id')}
          </Text>
          <Input
            placeholder={t('audit_log.placeholder_object_id')}
            value={objectIdInput}
            onChange={(e) => onFilterChange(setObjectIdInput, e.currentTarget.value)}
            style={{ width: 140 }}
          />
        </div>
        <Button type="link" onClick={resetFilters}>
          {t('audit_log.filter_clear')}
        </Button>
      </Space>

      {isError && (
        <Alert type="error" message={t('audit_log.error_load')} showIcon style={{ marginBottom: 16 }} />
      )}

      <ProTable<IAuditLog>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        size="small"
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          onChange: (p) => setPage(p),
          showSizeChanger: false,
          showTotal: (totalCount, range) => `${range[0]}–${range[1]} / ${totalCount}`,
        }}
        locale={{ emptyText: t('audit_log.empty') }}
      />
    </div>
  );
}
