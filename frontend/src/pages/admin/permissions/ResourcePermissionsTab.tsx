import { useCallback, useMemo, useState } from 'react';
import { Button, Checkbox, Flex, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useResourcePermissions, useSaveResourcePermissions } from '@/hooks/useAdmin';
import { ROLE_COLOR } from './roleColors';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

type PermFlags = { view: boolean; create: boolean; edit: boolean; delete: boolean };

export function ResourcePermissionsTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useResourcePermissions();
  const saveMutation = useSaveResourcePermissions({
    onSuccess: () => toast.success(t('permissions_admin.toast_matrix_saved')),
    onError: () => toast.error(t('permissions_admin.toast_matrix_error')),
  });

  const [draft, setDraft] = useState<Record<string, Record<string, PermFlags>> | null>(null);

  const matrix = useMemo(() => draft ?? data?.matrix ?? {}, [draft, data?.matrix]);

  const handleToggle = useCallback((role: string, resourceCode: string, action: keyof PermFlags, checked: boolean) => {
    setDraft((prev) => {
      const base = prev ?? data?.matrix ?? {};
      const current = base[role]?.[resourceCode] ?? { view: false, create: false, edit: false, delete: false };
      return {
        ...base,
        [role]: {
          ...(base[role] ?? {}),
          [resourceCode]: { ...current, [action]: checked },
        },
      };
    });
  }, [data?.matrix]);

  const handleSave = useCallback(() => {
    saveMutation.mutate(matrix, {
      onSuccess: () => setDraft(null),
    });
  }, [matrix, saveMutation]);

  if (isLoading || !data) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  const actions: (keyof PermFlags)[] = ['view', 'create', 'edit', 'delete'];
  const actionLabels: Record<keyof PermFlags, string> = {
    view: t('permissions_admin.label_view'),
    create: t('permissions_admin.label_create'),
    edit: t('permissions_admin.label_edit'),
    delete: t('permissions_admin.label_delete'),
  };

  const columns = [
    {
      title: t('permissions_admin.col_resource'),
      dataIndex: 'label',
      key: 'label',
      fixed: 'left' as const,
      width: 180,
      render: (label: string, record: { code: string }) => (
        <Tooltip title={record.code}>
          <Text style={{ fontSize: 12 }}>{label}</Text>
        </Tooltip>
      ),
    },
    ...data.roles.map((role) => ({
      title: <Tag color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 10 }}>{role}</Tag>,
      key: role,
      width: 120,
      align: 'center' as const,
      render: (_: unknown, record: { code: string }) => {
        const perms = matrix[role]?.[record.code] ?? { view: false, create: false, edit: false, delete: false };
        return (
          <Flex gap={2} justify="center">
            {actions.map((action) => (
              <Tooltip key={action} title={action}>
                <Checkbox
                  checked={perms[action]}
                  onChange={(e) => handleToggle(role, record.code, action, e.target.checked)}
                  style={{ marginInlineEnd: 0 }}
                >
                  <span style={{ fontSize: 10 }}>{actionLabels[action]}</span>
                </Checkbox>
              </Tooltip>
            ))}
          </Flex>
        );
      },
    })),
  ];

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {t('permissions_admin.resource_perms_desc')}
      </Text>
      <Table
        rowKey="code"
        dataSource={data.resources}
        columns={columns}
        size="small"
        pagination={false}
        sticky
        scroll={{ x: 'max-content', y: 'calc(100vh - 260px)' }}
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
    </div>
  );
}
