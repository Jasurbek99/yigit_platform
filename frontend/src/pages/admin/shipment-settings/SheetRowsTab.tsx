import { useRef, useCallback } from 'react';
import {
  Table,
  Switch,
  Select,
  Input,
  Tooltip,
  Modal,
  Spin,
  Alert,
  message,
  Space,
  Button,
} from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { ISheetRowSetting } from '@/types';
import {
  useSheetRowSettings,
  useSaveSheetRowSetting,
  useReorderSheetRows,
  useBulkPermissions,
  type ISaveSheetRowPayload,
  type IVersionConflictError,
} from '@/hooks/useSheetRowSettings';
import { useAdminUsers } from '@/hooks/useAdmin';
import { ROLE_CHOICES } from '@/constants/roles';
import type { AxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { SheetRowStylePopover } from './SheetRowStylePopover';
import { SheetRowTooltipPopover } from './SheetRowTooltipPopover';

dayjs.extend(relativeTime);

interface IProps {
  canWrite: boolean;
}

// ─── Debounce helper ──────────────────────────────────────────────────────────

function useDebouncedCallback<T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number,
): (...args: T) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (...args: T) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fn(...args), delay);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, delay],
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
// StylePopover and TooltipPopover were extracted to sibling files
// (SheetRowStylePopover.tsx, SheetRowTooltipPopover.tsx) per Phase 1
// reviewer note #8 — keeps this file under the 200-line guidance.

export default function SheetRowsTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading } = useSheetRowSettings();
  const { data: allUsers = [] } = useAdminUsers();
  const saveRow = useSaveSheetRowSetting();
  const reorderRows = useReorderSheetRows();
  const bulkPermissions = useBulkPermissions();

  const roleOptions = ROLE_CHOICES.map((r) => ({ value: r.value, label: t(r.labelKey) }));

  const userOptions = allUsers.map((u) => ({
    value: u.id,
    label: `${u.first_name || u.username} ${u.last_name || ''}`.trim(),
  }));

  // ── Save helper: fires PATCH, handles 409 ────────────────────────────────

  const handleSave = useCallback(
    (record: ISheetRowSetting, patch: Partial<ISaveSheetRowPayload>) => {
      if (!canWrite) return;
      saveRow.mutate(
        { id: record.id, version: record.version, ...patch },
        {
          onError: (err: AxiosError<IVersionConflictError>) => {
            if (err.response?.status === 409) {
              Modal.confirm({
                title: t('sheet_rows.conflict_title'),
                content: t('sheet_rows.conflict_message'),
                okText: t('sheet_rows.conflict_refresh'),
                cancelButtonProps: { style: { display: 'none' } },
                onOk: () => {
                  queryClient.invalidateQueries({ queryKey: ['admin', 'sheet-rows'] });
                },
              });
            } else {
              void message.error(t('shipment_settings.toast_error'));
            }
          },
          onSuccess: () => {
            void message.success(t('sheet_rows.toast_saved'));
          },
        },
      );
    },
    [canWrite, saveRow, t, queryClient],
  );

  // ── Debounced label save (800ms) ─────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useDebouncedCallback(
    (record: ISheetRowSetting, patch: Partial<ISaveSheetRowPayload>) => {
      handleSave(record, patch);
    },
    800,
  );

  // ── Reorder helpers ───────────────────────────────────────────────────────

  const moveRow = useCallback(
    (record: ISheetRowSetting, direction: 'up' | 'down') => {
      if (!canWrite) return;
      const idx = rows.findIndex((r) => r.id === record.id);
      if (idx < 0) return;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= rows.length) return;
      const newOrder = rows.map((r) => r.id);
      // Swap
      [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
      reorderRows.mutate(
        { order: newOrder },
        {
          onError: () => void message.error(t('sheet_rows.toast_reorder_error')),
        },
      );
    },
    [canWrite, rows, reorderRows, t],
  );

  // ── Extra users helper (diff → bulk permissions) ─────────────────────────

  const handleExtraUsersChange = useCallback(
    (record: ISheetRowSetting, newIds: number[]) => {
      if (!canWrite) return;
      const oldIds = record.extra_users.map((u) => u.id).filter((id): id is number => id !== null);
      const grants = newIds.filter((id) => !oldIds.includes(id));
      const revokes = oldIds.filter((id) => !newIds.includes(id));
      if (grants.length === 0 && revokes.length === 0) return;
      bulkPermissions.mutate(
        { row_id: record.id, grants, revokes },
        {
          onSuccess: () => void message.success(t('sheet_rows.toast_saved')),
          onError: () => void message.error(t('shipment_settings.toast_error')),
        },
      );
    },
    [canWrite, bulkPermissions, t],
  );

  // ─────────────────────────────────────────────────────────────────────────

  const columns: ColumnsType<ISheetRowSetting> = [
    {
      title: '',
      key: 'reorder',
      width: 56,
      render: (_: unknown, record: ISheetRowSetting, index: number) => (
        <Space size={2}>
          <Tooltip title={t('sheet_rows.move_up')}>
            <Button
              size="small"
              type="text"
              icon={<ArrowUpOutlined />}
              disabled={!canWrite || index === 0}
              onClick={() => moveRow(record, 'up')}
            />
          </Tooltip>
          <Tooltip title={t('sheet_rows.move_down')}>
            <Button
              size="small"
              type="text"
              icon={<ArrowDownOutlined />}
              disabled={!canWrite || index === rows.length - 1}
              onClick={() => moveRow(record, 'down')}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: t('sheet_rows.col_id'),
      dataIndex: 'id',
      key: 'id',
      width: 48,
      render: (v: number) => (
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8c8c8c' }}>{v}</span>
      ),
    },
    {
      title: t('sheet_rows.col_field'),
      dataIndex: 'field_key',
      key: 'field_key',
      width: 180,
      render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code>,
    },
    {
      title: t('sheet_rows.col_labels'),
      key: 'labels',
      width: 280,
      render: (_: unknown, record: ISheetRowSetting) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(['tk', 'ru', 'en'] as const).map((lang) => {
            const field = `label_${lang}` as 'label_tk' | 'label_ru' | 'label_en';
            return (
              <Input
                key={lang}
                size="small"
                value={record[field]}
                disabled={!canWrite}
                placeholder={lang.toUpperCase()}
                addonBefore={
                  <span style={{ fontSize: 10, width: 20, display: 'inline-block', textAlign: 'center' }}>
                    {lang.toUpperCase()}
                  </span>
                }
                onChange={(e) =>
                  debouncedSave(record, { [field]: e.target.value } as Partial<ISaveSheetRowPayload>)
                }
              />
            );
          })}
        </div>
      ),
    },
    {
      title: t('sheet_rows.col_tooltip'),
      key: 'tooltip',
      width: 100,
      render: (_: unknown, record: ISheetRowSetting) => (
        <SheetRowTooltipPopover
          record={record}
          canWrite={canWrite}
          onSave={(patch) => handleSave(record, patch)}
        />
      ),
    },
    {
      title: t('sheet_rows.col_visible'),
      key: 'is_visible',
      width: 80,
      render: (_: unknown, record: ISheetRowSetting) => (
        <Switch
          size="small"
          checked={record.is_visible}
          disabled={!canWrite}
          onChange={(val) => handleSave(record, { is_visible: val })}
        />
      ),
    },
    {
      title: t('sheet_rows.col_locked'),
      key: 'is_locked',
      width: 90,
      render: (_: unknown, record: ISheetRowSetting) => (
        <Tooltip title={t('sheet_rows.locked_tooltip_extra_users')}>
          <Switch
            size="small"
            checked={record.is_locked}
            disabled={!canWrite}
            onChange={(val) => handleSave(record, { is_locked: val })}
          />
        </Tooltip>
      ),
    },
    {
      title: t('sheet_rows.col_style'),
      key: 'style',
      width: 140,
      render: (_: unknown, record: ISheetRowSetting) => (
        <SheetRowStylePopover
          record={record}
          canWrite={canWrite}
          onSave={(patch) => handleSave(record, patch)}
        />
      ),
    },
    {
      title: t('sheet_rows.col_trigger_roles'),
      key: 'triggered_roles',
      width: 220,
      render: (_: unknown, record: ISheetRowSetting) => (
        <Select
          mode="multiple"
          size="small"
          value={record.triggered_roles}
          options={roleOptions}
          disabled={!canWrite}
          onChange={(val: string[]) => handleSave(record, { triggered_roles: val })}
          style={{ width: '100%' }}
          placeholder={t('sheet_rows.trigger_none')}
          popupMatchSelectWidth={false}
          popupStyle={{ minWidth: 200 }}
          maxTagCount="responsive"
        />
      ),
    },
    {
      title: t('sheet_rows.col_extra_users'),
      key: 'extra_users',
      width: 220,
      render: (_: unknown, record: ISheetRowSetting) => {
        const currentIds = record.extra_users
          .map((u) => u.id)
          .filter((id): id is number => id !== null);
        return (
          <Select
            mode="multiple"
            size="small"
            value={currentIds}
            options={userOptions}
            disabled={!canWrite}
            onChange={(val: number[]) => handleExtraUsersChange(record, val)}
            style={{ width: '100%' }}
            placeholder={t('sheet_rows.extra_users_placeholder')}
            showSearch
            filterOption={(input, option) =>
              (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
            }
            popupMatchSelectWidth={false}
            popupStyle={{ minWidth: 200 }}
            maxTagCount="responsive"
          />
        );
      },
    },
    {
      title: t('sheet_rows.col_updated'),
      key: 'updated',
      width: 140,
      render: (_: unknown, record: ISheetRowSetting) => {
        const byName = record.updated_by_name ?? '—';
        const fromNow = record.updated_at ? dayjs(record.updated_at).fromNow() : '—';
        return (
          <Tooltip title={`${byName} · ${record.updated_at ?? ''}`}>
            <span style={{ fontSize: 11, color: '#8c8c8c' }}>
              {byName} · {fromNow}
            </span>
          </Tooltip>
        );
      },
    },
  ];

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      {/* L1/L2/L3 information plate */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('sheet_rows.info_plate_title')}
        description={t('sheet_rows.info_plate_desc')}
      />
      <Table<ISheetRowSetting>
        columns={columns}
        dataSource={rows}
        rowKey="id"
        loading={false}
        pagination={false}
        size="small"
        bordered
        scroll={{ x: 'max-content' }}
        rowClassName={(record) => (!record.is_visible ? 'sheet-row-hidden' : '')}
      />
    </div>
  );
}
