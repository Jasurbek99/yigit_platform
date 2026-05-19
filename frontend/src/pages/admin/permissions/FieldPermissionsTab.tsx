import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Flex, Select, Spin, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useFieldPermissions, useSaveFieldPermissions } from '@/hooks/useAdmin';
import { ROLE_COLOR } from './roleColors';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

export function FieldPermissionsTab() {
  const { t } = useTranslation();
  const [selectedResource, setSelectedResource] = useState<string | undefined>(undefined);
  const { data, isLoading } = useFieldPermissions(selectedResource);
  const saveMutation = useSaveFieldPermissions({
    onSuccess: () => toast.success(t('permissions_admin.toast_matrix_saved')),
    onError: () => toast.error(t('permissions_admin.toast_matrix_error')),
  });

  const [draft, setDraft] = useState<Record<string, string[]> | null>(null);

  const resourceFields = data?.resource_fields ?? {};
  const fields = selectedResource ? (resourceFields[selectedResource] ?? []) : [];
  const currentMatrix = useMemo(
    () => (selectedResource ? (draft ?? data?.matrix?.[selectedResource] ?? {}) : {}),
    [selectedResource, draft, data?.matrix],
  );

  const roles = data?.roles ?? [];

  const resourceOptions = Object.entries(resourceFields).map(([code, fieldList]) => ({
    value: code,
    label: `${code} (${fieldList.length} fields)`,
  }));

  const handleToggle = useCallback((role: string, fieldName: string, checked: boolean) => {
    setDraft((prev) => {
      const base = prev ?? (selectedResource ? data?.matrix?.[selectedResource] ?? {} : {});
      const currentFields = base[role] ?? [];
      const newFields = checked
        ? [...currentFields.filter((f) => f !== fieldName), fieldName]
        : currentFields.filter((f) => f !== fieldName);
      return { ...base, [role]: newFields };
    });
  }, [selectedResource, data?.matrix]);

  const handleToggleAll = useCallback((role: string, checked: boolean) => {
    setDraft((prev) => {
      const base = prev ?? (selectedResource ? data?.matrix?.[selectedResource] ?? {} : {});
      return { ...base, [role]: checked ? ['*'] : [] };
    });
  }, [selectedResource, data?.matrix]);

  const handleSave = useCallback(() => {
    if (!selectedResource) return;
    saveMutation.mutate(
      { resource: selectedResource, matrix: currentMatrix },
      { onSuccess: () => setDraft(null) },
    );
  }, [selectedResource, currentMatrix, saveMutation]);

  const handleResourceChange = useCallback((value: string) => {
    setSelectedResource(value);
    setDraft(null);
  }, []);

  if (isLoading && selectedResource) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  // Rows: fields, with a '*' meta-row at the top for the bulk toggle.
  const allFieldRows = [
    { field: '*', label: t('permissions_admin.all_fields') },
    ...fields.map((f) => ({ field: f, label: f })),
  ];

  const columns = [
    {
      title: t('permissions_admin.col_field'),
      dataIndex: 'label',
      key: 'label',
      fixed: 'left' as const,
      width: 180,
      render: (label: string, record: { field: string }) => (
        <Text style={{ fontSize: 12, fontWeight: record.field === '*' ? 600 : 400 }}>{label}</Text>
      ),
    },
    ...roles.map((role) => ({
      title: <Tag color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 10 }}>{role}</Tag>,
      key: role,
      width: 90,
      align: 'center' as const,
      render: (_: unknown, record: { field: string }) => {
        const roleFields = currentMatrix[role] ?? [];
        const isAllFields = roleFields.includes('*');

        if (record.field === '*') {
          return (
            <Checkbox
              checked={isAllFields}
              onChange={(e) => handleToggleAll(role, e.target.checked)}
            />
          );
        }
        return (
          <Checkbox
            checked={isAllFields || roleFields.includes(record.field)}
            disabled={isAllFields}
            onChange={(e) => handleToggle(role, record.field, e.target.checked)}
          />
        );
      },
    })),
  ];

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {t('permissions_admin.field_perms_desc')}
      </Text>
      <Select
        placeholder={t('permissions_admin.select_resource')}
        options={resourceOptions}
        value={selectedResource}
        onChange={handleResourceChange}
        style={{ width: 300, marginBottom: 16 }}
      />
      {selectedResource && fields.length > 0 ? (
        <>
          <Table
            rowKey="field"
            dataSource={allFieldRows}
            columns={columns}
            size="small"
            pagination={false}
            sticky
            scroll={{ x: 'max-content', y: 'calc(100vh - 320px)' }}
            style={{ background: COLORS.white, borderRadius: 8 }}
          />
          <Flex justify="flex-end" style={{ marginTop: 16 }}>
            <Button
              type="primary"
              onClick={handleSave}
              loading={saveMutation.isPending}
              disabled={!draft}
            >
              {t('permissions_admin.save_matrix')}
            </Button>
          </Flex>
        </>
      ) : selectedResource ? (
        <Alert message={t('permissions_admin.no_field_config')} type="info" />
      ) : null}
    </div>
  );
}
