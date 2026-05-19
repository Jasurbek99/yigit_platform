import { useCallback, useMemo, useState } from 'react';
import { Button, Checkbox, Flex, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { usePagePermissions, useSavePagePermissions } from '@/hooks/useAdmin';
import { ROLE_COLOR } from './roleColors';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

export function PageVisibilityTab() {
  const { t } = useTranslation();
  const { data, isLoading } = usePagePermissions();
  const saveMutation = useSavePagePermissions({
    onSuccess: () => toast.success(t('permissions_admin.toast_matrix_saved')),
    onError: () => toast.error(t('permissions_admin.toast_matrix_error')),
  });

  const [draft, setDraft] = useState<Record<string, Record<string, boolean>> | null>(null);

  const matrix = useMemo(() => draft ?? data?.matrix ?? {}, [draft, data?.matrix]);

  const handleToggle = useCallback((role: string, pageCode: string, checked: boolean) => {
    setDraft((prev) => {
      const base = prev ?? data?.matrix ?? {};
      return {
        ...base,
        [role]: { ...(base[role] ?? {}), [pageCode]: checked },
      };
    });
  }, [data?.matrix]);

  const handleSave = useCallback(() => {
    saveMutation.mutate(matrix, {
      onSuccess: () => setDraft(null),
    });
  }, [matrix, saveMutation]);

  if (isLoading || !data) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  const columns = [
    {
      title: t('permissions_admin.col_page'),
      dataIndex: 'label',
      key: 'label',
      fixed: 'left' as const,
      width: 200,
      render: (label: string, record: { code: string; label: string }) => (
        <Tooltip title={record.code}>
          <Text style={{ fontSize: 12 }}>{label}</Text>
        </Tooltip>
      ),
    },
    ...data.roles.map((role) => ({
      title: <Tag color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 10 }}>{role}</Tag>,
      key: role,
      width: 90,
      align: 'center' as const,
      render: (_: unknown, record: { code: string }) => (
        <Checkbox
          checked={matrix[role]?.[record.code] ?? false}
          onChange={(e) => handleToggle(role, record.code, e.target.checked)}
        />
      ),
    })),
  ];

  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        {t('permissions_admin.page_vis_desc')}
      </Text>
      <Table
        rowKey="code"
        dataSource={data.pages}
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
