import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Flex, Input, Typography } from 'antd';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { RoleSidebar } from '@/pages/admin/permissions/RoleSidebar';
import { useSheetRowSettings, useSaveRoleAccess } from '@/hooks/useSheetRowSettings';
import { ROLE_CHOICES } from '@/constants/roles';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IRowAccessTabProps {
  canWrite: boolean;
}

/**
 * The one place row access is granted (AD-17). Pick a role, tick the rows it may
 * edit. Ticking writes SheetRowSetting.role_triggers, which IS the edit
 * permission — the Sheet rows tab shows the same data read-only.
 */
export default function RowAccessTab({ canWrite }: IRowAccessTabProps) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading, isError } = useSheetRowSettings();
  const save = useSaveRoleAccess();

  const roles = useMemo(() => ROLE_CHOICES.map((r) => r.value), []);
  const [role, setRole] = useState<string>(roles[0]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string> | null>(null);

  const saved = useMemo(
    () => new Set(rows.filter((r) => r.triggered_roles.includes(role)).map((r) => r.field_key)),
    [rows, role],
  );
  const current = draft ?? saved;
  const isDirty = draft !== null;

  const visible = rows.filter(
    (r) => !search || r.field_key.toLowerCase().includes(search.toLowerCase()) || (r.label_en ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const handleToggle = (fieldKey: string, checked: boolean) => {
    const next = new Set(current);
    if (checked) next.add(fieldKey);
    else next.delete(fieldKey);
    setDraft(next);
  };

  const handleSelectRole = (next: string) => {
    setRole(next);
    setDraft(null);
  };

  const handleSave = () => {
    save.mutate(
      { role, field_keys: [...current].sort() },
      {
        onSuccess: () => setDraft(null),
        onError: () => toast.error(t('row_access.toast_save_error')),
      },
    );
  };

  return (
    <Flex gap={16} align="flex-start">
      <RoleSidebar roles={roles} selected={role} onSelect={handleSelectRole} />

      <Flex vertical gap={12} style={{ flex: 1 }}>
        <Alert type="info" showIcon message={t('row_access.hint')} />
        {isError && <Alert type="error" showIcon message={t('row_access.load_error')} />}

        <Flex gap={8} align="center">
          <Input.Search
            allowClear
            placeholder={t('row_access.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <Button
            type="primary"
            disabled={!canWrite || !isDirty}
            loading={save.isPending}
            onClick={handleSave}
          >
            {t('common.save')}
          </Button>
        </Flex>

        <Flex vertical gap={2} style={{ background: COLORS.white, borderRadius: 8, padding: 8 }}>
          {isLoading && <Text type="secondary">{t('common.loading')}</Text>}
          {visible.map((row) => (
            <Checkbox
              key={row.id}
              aria-label={row.field_key}
              checked={current.has(row.field_key)}
              disabled={!canWrite}
              onChange={(e) => handleToggle(row.field_key, e.target.checked)}
            >
              <Text style={{ fontSize: 12 }}>
                R{row.row_number} · {row.label_en || row.field_key}{' '}
                <Text type="secondary" style={{ fontSize: 11 }}>{row.field_key}</Text>
              </Text>
            </Checkbox>
          ))}
        </Flex>
      </Flex>
    </Flex>
  );
}
