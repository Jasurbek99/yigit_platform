import { Select, Table, Tag, Tooltip, Spin, message } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import type { ISheetRowSetting } from '@/types';
import { useSheetRowSettings, useSaveSheetRowSetting } from '@/hooks/useSheetRowSettings';
import { useAdminUsers } from '@/hooks/useAdmin';
import { ROLE_CHOICES } from '@/constants/roles';

interface IProps {
  canWrite: boolean;
}

// Build stable role options (translated once per render — the hook result is
// stable, and the label is re-evaluated each render via t() anyway).
function useRoleOptions() {
  const { t } = useTranslation();
  return ROLE_CHOICES.map((r) => ({ value: r.value, label: t(r.labelKey) }));
}

export default function SheetRowsTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useSheetRowSettings();
  const { data: allUsers = [] } = useAdminUsers();
  const saveRow = useSaveSheetRowSetting({
    onSuccess: () => message.success(t('sheet_rows.toast_saved')),
    onError: () => message.error(t('shipment_settings.toast_error')),
  });

  const roleOptions = useRoleOptions();

  const userOptions = allUsers.map((u) => ({
    value: u.id,
    label: `${u.first_name || u.username} ${u.last_name || ''}`.trim(),
  }));

  const columns: ColumnsType<ISheetRowSetting> = [
    {
      title: t('sheet_rows.col_num'),
      dataIndex: 'row_number',
      key: 'row_number',
      width: 48,
      render: (v: number) => <span style={{ color: '#8c8c8c', fontSize: 12 }}>{v}</span>,
    },
    {
      title: t('sheet_rows.col_field'),
      dataIndex: 'field_key',
      key: 'field_key',
      width: 200,
      render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>,
    },
    {
      title: t('sheet_rows.col_default_who'),
      key: 'default_who',
      width: 160,
      render: (_: unknown, record: ISheetRowSetting) => (
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          {record.default_who_key ? t(record.default_who_key) : '—'}
        </span>
      ),
    },
    {
      title: t('sheet_rows.col_trigger_role'),
      key: 'triggered_role',
      width: 200,
      render: (_: unknown, record: ISheetRowSetting) => (
        <Select
          size="small"
          value={record.triggered_role || null}
          options={[{ value: null, label: t('sheet_rows.trigger_none') }, ...roleOptions]}
          disabled={!canWrite || saveRow.isPending}
          onChange={(val: string | null) => {
            saveRow.mutate({ field_key: record.field_key, triggered_role: val ?? '' });
          }}
          style={{ width: '100%' }}
          allowClear
          placeholder={t('sheet_rows.trigger_none')}
          popupMatchSelectWidth={false}
          popupStyle={{ minWidth: 180 }}
        />
      ),
    },
    {
      title: t('sheet_rows.col_trigger_user'),
      key: 'triggered_user',
      width: 240,
      render: (_: unknown, record: ISheetRowSetting) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title={t('sheet_rows.tooltip_user_picker')}>
            <Select
              size="small"
              value={record.triggered_user ?? null}
              options={[{ value: null, label: t('sheet_rows.trigger_none') }, ...userOptions]}
              disabled={!canWrite || saveRow.isPending}
              onChange={(val: number | null) => {
                saveRow.mutate({ field_key: record.field_key, triggered_user: val ?? null });
              }}
              style={{ flex: 1 }}
              allowClear
              showSearch
              placeholder={t('sheet_rows.trigger_none')}
              filterOption={(input, option) =>
                (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
              }
              popupMatchSelectWidth={false}
              popupStyle={{ minWidth: 200 }}
            />
          </Tooltip>
          {record.triggered_user_active === false && (
            <Tag color="warning" style={{ fontSize: 11, flexShrink: 0 }}>
              {t('sheet_rows.user_inactive_warning')}
            </Tag>
          )}
        </div>
      ),
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
    <Table<ISheetRowSetting>
      columns={columns}
      dataSource={rows}
      rowKey="field_key"
      loading={false}
      pagination={false}
      size="small"
      bordered
      scroll={{ x: 'max-content' }}
    />
  );
}
