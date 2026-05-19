import { useCallback, useState } from 'react';
import {
  Table,
  Switch,
  Select,
  Input,
  Tag,
  Tooltip,
  Modal,
  Spin,
  Alert,
  Space,
  Button,
  Form,
} from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { toast } from 'sonner';
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
  useCreateCustomSheetRow,
  useSoftDeleteSheetRow,
  type ISaveSheetRowPayload,
  type IVersionConflictError,
} from '@/hooks/useSheetRowSettings';
import { useAdminUsers } from '@/hooks/useAdmin';
import { ROLE_CHOICES } from '@/constants/roles';
import type { AxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { SheetRowStylePopover } from './SheetRowStylePopover';
import { SheetRowTooltipPopover } from './SheetRowTooltipPopover';
import { InlineSavedInput } from './InlineSavedInput';
import { COLORS } from '@/constants/styles';

dayjs.extend(relativeTime);

interface IProps {
  canWrite: boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────
// StylePopover and TooltipPopover were extracted to sibling files
// (SheetRowStylePopover.tsx, SheetRowTooltipPopover.tsx) per Phase 1
// reviewer note #8 — keeps this file under the 200-line guidance.

// ─── Phase 5c: "Add custom row" modal ───────────────────────────────────────

interface ICustomRowModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal that asks the admin for a slug + 3-language label, then POSTs to
 * the create-custom-row endpoint. The `custom_` prefix is shown explicitly
 * so two admins don't accidentally collide on names — the uniqueness check
 * happens server-side and the error surfaces in the toast.
 */
function CustomRowModal({ open, onClose }: ICustomRowModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{
    slug: string;
    label_en: string;
    label_ru?: string;
    label_tk?: string;
  }>();
  const createMutation = useCreateCustomSheetRow();

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const fieldKey = `custom_${values.slug.trim()}`;
      createMutation.mutate(
        {
          field_key: fieldKey,
          label_en: values.label_en.trim(),
          label_ru: values.label_ru?.trim() || undefined,
          label_tk: values.label_tk?.trim() || undefined,
        },
        {
          onSuccess: () => {
            toast.success(t('sheet_rows.custom_created', { field_key: fieldKey }));
            form.resetFields();
            onClose();
          },
          onError: (err) => {
            const apiMsg = err?.response?.data?.error;
            toast.error(apiMsg ?? t('sheet_rows.custom_create_error'));
          },
        },
      );
    } catch {
      // form validation error — antd already highlights the fields
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={handleSubmit}
      okText={t('sheet_rows.custom_modal_ok')}
      title={t('sheet_rows.custom_modal_title')}
      confirmLoading={createMutation.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          label={t('sheet_rows.custom_slug_label')}
          name="slug"
          rules={[
            { required: true, message: t('sheet_rows.custom_slug_required') },
            {
              pattern: /^[a-z0-9_]{1,53}$/,
              message: t('sheet_rows.custom_slug_invalid'),
            },
          ]}
          extra={t('sheet_rows.custom_slug_hint')}
        >
          <Input addonBefore="custom_" placeholder={t('sheet_rows.placeholder_field_key')} />
        </Form.Item>
        <Form.Item
          label={t('sheet_rows.custom_label_en')}
          name="label_en"
          rules={[{ required: true, message: t('sheet_rows.custom_label_required') }]}
        >
          <Input placeholder={t('sheet_rows.placeholder_label_en')} />
        </Form.Item>
        <Form.Item label={t('sheet_rows.custom_label_ru')} name="label_ru">
          <Input placeholder={t('sheet_rows.placeholder_label_ru')} />
        </Form.Item>
        <Form.Item label={t('sheet_rows.custom_label_tk')} name="label_tk">
          <Input placeholder={t('sheet_rows.placeholder_label_tk')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function SheetRowsTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const { data: rows = [], isLoading } = useSheetRowSettings();
  const { data: allUsers = [] } = useAdminUsers();
  const saveRow = useSaveSheetRowSetting();
  const reorderRows = useReorderSheetRows();
  const bulkPermissions = useBulkPermissions();
  const softDelete = useSoftDeleteSheetRow();

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
              toast.error(t('shipment_settings.toast_error'));
            }
          },
          onSuccess: () => {
            toast.success(t('sheet_rows.toast_saved'));
          },
        },
      );
    },
    [canWrite, saveRow, t, queryClient],
  );

  // (Inline label / who / tooltip inputs use InlineSavedInput, which calls
  // handleSave on blur or Enter — no debounce needed and no per-keystroke
  // PATCH spam.)

  // ── Soft-delete custom row (Phase 5c) ───────────────────────────────────
  const handleDeleteCustomRow = useCallback(
    (record: ISheetRowSetting) => {
      if (!canWrite || !record.is_custom) return;
      // Guard against a rapid second click opening a duplicate Modal that
      // races with the in-flight DELETE — the second mutate() would 404
      // (soft-delete is idempotent server-side) and surface as a spurious
      // error toast.
      if (softDelete.isPending) return;
      Modal.confirm({
        title: t('sheet_rows.custom_delete_confirm_title', { field_key: record.field_key }),
        content: t('sheet_rows.custom_delete_confirm_body'),
        okText: t('sheet_rows.custom_delete_confirm_ok'),
        okButtonProps: { danger: true },
        cancelText: t('common.cancel'),
        onOk: () =>
          new Promise<void>((resolve, reject) => {
            softDelete.mutate({ id: record.id }, {
              onSuccess: () => {
                toast.success(t('sheet_rows.custom_deleted', { field_key: record.field_key }));
                resolve();
              },
              onError: () => {
                toast.error(t('sheet_rows.custom_delete_error'));
                reject();
              },
            });
          }),
      });
    },
    [canWrite, softDelete, t],
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
          onError: () => toast.error(t('sheet_rows.toast_reorder_error')),
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
          onSuccess: () => toast.success(t('sheet_rows.toast_saved')),
          onError: () => toast.error(t('shipment_settings.toast_error')),
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
      width: 88,
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
          {/*
            Delete is shown ONLY for is_custom rows. DEFAULT_SHEET_ROWS-backed
            rows are tied to model fields and protected by the 30-day
            cooldown — they're not safely deletable from this UI.
          */}
          {record.is_custom && (
            <Tooltip title={t('sheet_rows.custom_delete_tooltip')}>
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={!canWrite}
                onClick={() => handleDeleteCustomRow(record)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: t('sheet_rows.col_id'),
      dataIndex: 'id',
      key: 'id',
      width: 48,
      render: (v: number) => (
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: COLORS.textSecondary }}>{v}</span>
      ),
    },
    {
      title: t('sheet_rows.col_field'),
      dataIndex: 'field_key',
      key: 'field_key',
      width: 180,
      render: (v: string, record: ISheetRowSetting) => (
        <Space size={4}>
          <code style={{ fontSize: 11 }}>{v}</code>
          {record.is_custom && (
            <Tag color="purple" style={{ marginInlineEnd: 0, fontSize: 10 }}>
              {t('sheet_rows.custom_badge')}
            </Tag>
          )}
        </Space>
      ),
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
              <InlineSavedInput
                key={lang}
                value={record[field]}
                disabled={!canWrite}
                placeholder={lang.toUpperCase()}
                addonBefore={
                  <span style={{ fontSize: 10, width: 20, display: 'inline-block', textAlign: 'center' }}>
                    {lang.toUpperCase()}
                  </span>
                }
                onSave={(next) =>
                  handleSave(record, { [field]: next } as Partial<ISaveSheetRowPayload>)
                }
              />
            );
          })}
        </div>
      ),
    },
    {
      title: t('sheet_rows.col_who'),
      key: 'who',
      width: 280,
      render: (_: unknown, record: ISheetRowSetting) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(['tk', 'ru', 'en'] as const).map((lang) => {
            const field = `who_${lang}` as 'who_tk' | 'who_ru' | 'who_en';
            return (
              <InlineSavedInput
                key={lang}
                value={record[field]}
                disabled={!canWrite}
                placeholder={lang.toUpperCase()}
                addonBefore={
                  <span style={{ fontSize: 10, width: 20, display: 'inline-block', textAlign: 'center' }}>
                    {lang.toUpperCase()}
                  </span>
                }
                onSave={(next) =>
                  handleSave(record, { [field]: next } as Partial<ISaveSheetRowPayload>)
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
            <span style={{ fontSize: 11, color: COLORS.textSecondary }}>
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
      {canWrite && (
        <div style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCustomModalOpen(true)}
          >
            {t('sheet_rows.add_custom_row')}
          </Button>
          <span style={{ marginLeft: 8, color: COLORS.textSecondary, fontSize: 12 }}>
            {t('sheet_rows.add_custom_hint')}
          </span>
        </div>
      )}
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
      <CustomRowModal
        open={customModalOpen}
        onClose={() => setCustomModalOpen(false)}
      />
    </div>
  );
}
