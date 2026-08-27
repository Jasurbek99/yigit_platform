import { Alert, Select, Switch } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';

interface IOption {
  value: string;
  label: string;
}

interface IUserOption {
  value: number;
  label: string;
}

interface ISheetRowAccessSectionProps {
  isLocked: boolean;
  triggeredRoles: string[];
  extraUserIds: number[];
  roleOptions: IOption[];
  userOptions: IUserOption[];
  disabled: boolean;
  onChange: (patch: {
    is_locked?: boolean;
    triggered_roles?: string[];
    extra_user_ids?: number[];
  }) => void;
}

/**
 * The one place that explains what a lock, a trigger role and an extra user
 * actually do together. The wording mirrors `can_edit_sheet_field` /
 * `get_sheet_edit_map` exactly:
 *   - no lock, no triggers  → the field permission alone decides;
 *   - any trigger set       → only those roles/users, AND they still need the
 *                             field permission (the gate is AND, never OR) —
 *                             the lock makes NO difference in this case;
 *   - lock, no triggers     → nobody (admin / director / export_manager bypass
 *                             every branch).
 */
export function SheetRowAccessSection({
  isLocked,
  triggeredRoles,
  extraUserIds,
  roleOptions,
  userOptions,
  disabled,
  onChange,
}: ISheetRowAccessSectionProps) {
  const { t } = useTranslation();
  const hasTriggers = triggeredRoles.length > 0 || extraUserIds.length > 0;
  const accessDescKey = hasTriggers
    ? 'sheet_rows.access_desc_triggered'
    : isLocked
      ? 'sheet_rows.access_desc_locked_empty'
      : 'sheet_rows.access_desc_open';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch
          checked={isLocked}
          disabled={disabled}
          onChange={(val) => onChange({ is_locked: val })}
        />
        <span>{t('sheet_rows.locked_label')}</span>
      </div>

      <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
        {t('sheet_rows.access_lock_note')}
      </div>

      <Alert
        type={hasTriggers || !isLocked ? 'info' : 'warning'}
        showIcon
        message={t(accessDescKey)}
      />

      <div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>
          {t('sheet_rows.col_trigger_roles')}
        </div>
        <Select
          mode="multiple"
          value={triggeredRoles}
          options={roleOptions}
          disabled={disabled}
          onChange={(val: string[]) => onChange({ triggered_roles: val })}
          style={{ width: '100%' }}
          placeholder={t('sheet_rows.trigger_none')}
          showSearch
          optionFilterProp="label"
        />
      </div>

      <div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>
          {t('sheet_rows.col_extra_users')}
        </div>
        <Select
          mode="multiple"
          value={extraUserIds}
          options={userOptions}
          disabled={disabled}
          onChange={(val: number[]) => onChange({ extra_user_ids: val })}
          style={{ width: '100%' }}
          placeholder={t('sheet_rows.extra_users_placeholder')}
          showSearch
          filterOption={(input, option) =>
            ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      </div>

      <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
        {t('sheet_rows.access_role_group_note')}
      </div>
    </div>
  );
}
