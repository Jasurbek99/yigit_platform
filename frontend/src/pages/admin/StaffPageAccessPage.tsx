import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Flex, Spin, Switch, Table, Tag, Typography } from 'antd';
import { IconShieldHalf, IconAlertTriangle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useManagedPagePermissions, useSaveManagedPagePermissions } from '@/hooks/useAdmin';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

const ROLE_COLOR: Record<string, string> = {
  loading_dept_head_deputy: 'gold',
  weight_master: 'geekblue',
};

export default function StaffPageAccessPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useManagedPagePermissions();

  const saveMutation = useSaveManagedPagePermissions({
    onSuccess: () => toast.success(t('staff_access.toast_saved')),
    onError: () => toast.error(t('staff_access.toast_error')),
  });

  const [draft, setDraft] = useState<Record<string, Record<string, boolean>> | null>(null);

  const matrix = useMemo(() => draft ?? data?.matrix ?? {}, [draft, data?.matrix]);

  const handleToggle = useCallback(
    (role: string, pageCode: string, checked: boolean) => {
      setDraft((prev) => {
        const base = prev ?? data?.matrix ?? {};
        return {
          ...base,
          [role]: { ...(base[role] ?? {}), [pageCode]: checked },
        };
      });
    },
    [data?.matrix],
  );

  const handleSave = useCallback(() => {
    if (!data) return;
    // Build a clean matrix containing only the roles and pages returned from the server.
    const cleanMatrix: Record<string, Record<string, boolean>> = {};
    for (const role of data.roles) {
      cleanMatrix[role] = {};
      for (const page of data.pages) {
        cleanMatrix[role][page.code] = matrix[role]?.[page.code] ?? false;
      }
    }
    saveMutation.mutate(cleanMatrix, {
      onSuccess: () => setDraft(null),
    });
  }, [data, matrix, saveMutation]);

  if (isLoading) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  if (isError || !data) {
    return (
      <Alert
        type="error"
        message={t('staff_access.error_load')}
        showIcon
        style={{ marginTop: 16 }}
      />
    );
  }

  // No manageable roles → show an informational message
  if (data.roles.length === 0) {
    return (
      <Text type="secondary" style={{ display: 'block', marginTop: 40, textAlign: 'center' }}>
        {t('staff_access.empty')}
      </Text>
    );
  }

  const columns = [
    {
      title: t('staff_access.col_page'),
      dataIndex: 'label',
      key: 'label',
      fixed: 'left' as const,
      width: 220,
      render: (label: string) => (
        <Text style={{ fontSize: 13 }}>{label}</Text>
      ),
    },
    ...data.roles.map((role) => ({
      title: (
        <Tag color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 11 }}>
          {t(`roles.${role}`)}
        </Tag>
      ),
      key: role,
      width: 140,
      align: 'center' as const,
      render: (_: unknown, record: { code: string }) => (
        <Switch
          size="small"
          checked={matrix[role]?.[record.code] ?? false}
          onChange={(checked) => handleToggle(role, record.code, checked)}
        />
      ),
    })),
  ];

  return (
    <div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: COLORS.textDark,
          lineHeight: '1.3',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <IconShieldHalf size={18} color={COLORS.primary} />
        {t('staff_access.title')}
      </div>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
        {t('staff_access.subtitle')}
      </Text>

      <Table
        rowKey="code"
        dataSource={data.pages}
        columns={columns}
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        style={{ background: COLORS.white, borderRadius: 8 }}
      />

      {draft && (
        <Flex
          justify="space-between"
          align="center"
          gap={12}
          style={{
            position: 'sticky',
            bottom: 16,
            marginTop: 16,
            padding: '10px 16px',
            background: COLORS.white,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
            zIndex: 10,
          }}
        >
          <Text type="warning" style={{ fontSize: 13 }}>
            <IconAlertTriangle size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {t('staff_access.unsaved_changes')}
          </Text>
          <Button
            type="primary"
            onClick={handleSave}
            loading={saveMutation.isPending}
          >
            {t('staff_access.save')}
          </Button>
        </Flex>
      )}
    </div>
  );
}
