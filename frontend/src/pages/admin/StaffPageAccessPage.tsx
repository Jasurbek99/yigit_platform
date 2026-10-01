import { useState } from 'react';
import { Alert, Button, Flex, Input, Spin, Typography } from 'antd';
import { IconShieldHalf, IconSearch } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useManagedPagePermissions, useSaveManagedPagePermissions } from '@/hooks/useAdmin';
import { COLORS } from '@/constants/styles';
import { RoleSidebar } from './permissions/RoleSidebar';
import { PagesSection } from './permissions/sections/PagesSection';
import {
  countPageChanges,
  countVisiblePages,
  togglePage,
  type TPageMatrix,
} from './permissions/rolePermissionModel';

const { Text } = Typography;

/**
 * Delegated page access (ADR-022): pick a managed role on the left, tick its
 * pages on the right — the same role-first layout as /admin/permissions.
 *
 * Used to be a page × role switch matrix, which for an admin meant ~20 role
 * columns and a horizontal scroll over an ungrouped list.
 */
export default function StaffPageAccessPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useManagedPagePermissions();
  const saveMutation = useSaveManagedPagePermissions({
    onSuccess: () => toast.success(t('staff_access.toast_saved')),
    onError: () => toast.error(t('staff_access.toast_error')),
  });

  const [draft, setDraft] = useState<TPageMatrix | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const saved = data?.matrix ?? {};
  const matrix = draft ?? saved;
  const dirtyCount = countPageChanges(saved, draft);
  const role = selectedRole ?? data?.roles[0] ?? null;

  const handleToggle = (pageCode: string, checked: boolean) => {
    if (!role) return;
    setDraft((prev) => togglePage(prev ?? saved, role, pageCode, checked));
  };

  const handleSave = () => {
    if (!data) return;
    // Send only the roles and pages the server returned — the PUT rejects anything else.
    const cleanMatrix: TPageMatrix = {};
    for (const managedRole of data.roles) {
      cleanMatrix[managedRole] = {};
      for (const page of data.pages) {
        cleanMatrix[managedRole][page.code] = matrix[managedRole]?.[page.code] ?? false;
      }
    }
    saveMutation.mutate(cleanMatrix, { onSuccess: () => setDraft(null) });
  };

  if (isLoading) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  if (isError || !data) {
    return <Alert type="error" message={t('staff_access.error_load')} showIcon style={{ marginTop: 16 }} />;
  }

  if (!role) {
    return (
      <Text type="secondary" style={{ display: 'block', marginTop: 40, textAlign: 'center' }}>
        {t('staff_access.empty')}
      </Text>
    );
  }

  return (
    <div>
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 16 }} gap={16} wrap>
        <div style={{ maxWidth: 640 }}>
          <Flex align="center" gap={8} style={{ fontSize: 20, fontWeight: 600, color: COLORS.textDark }}>
            <IconShieldHalf size={18} color={COLORS.primary} />
            {t('staff_access.title')}
          </Flex>
          <Text type="secondary" style={{ fontSize: 13 }}>{t('staff_access.subtitle')}</Text>
        </div>

        <Flex align="center" gap={12}>
          <Input
            allowClear
            prefix={<IconSearch size={14} color={COLORS.textSecondary} />}
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {dirtyCount > 0
              ? t('permissions_admin.unsaved', { count: dirtyCount })
              : t('permissions_admin.no_changes')}
          </Text>
          <Button
            type="primary"
            onClick={handleSave}
            loading={saveMutation.isPending}
            disabled={dirtyCount === 0}
          >
            {t('staff_access.save')}
          </Button>
        </Flex>
      </Flex>

      <Flex gap={16} align="flex-start">
        <RoleSidebar
          roles={data.roles}
          selected={role}
          onSelect={setSelectedRole}
          getLabel={(code) => t(`roles.${code}`)}
        />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: COLORS.white,
            borderRadius: 8,
            padding: 16,
            maxHeight: 'calc(100vh - 190px)',
            overflowY: 'auto',
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            {t('permissions_admin.pages_count', {
              visible: countVisiblePages(matrix, role, data.pages),
              total: data.pages.length,
            })}
          </Text>
          <PagesSection
            role={role}
            search={search}
            pages={data.pages}
            matrix={matrix}
            onToggle={handleToggle}
          />
        </div>
      </Flex>
    </div>
  );
}
