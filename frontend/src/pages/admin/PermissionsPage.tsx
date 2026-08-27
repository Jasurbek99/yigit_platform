import { useState } from 'react';
import { Button, Flex, Input, Spin, Typography } from 'antd';
import { IconShield, IconSearch } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';
import { RoleSidebar } from './permissions/RoleSidebar';
import { RolePermissionEditor } from './permissions/RolePermissionEditor';
import { useRolePermissionDrafts } from './permissions/useRolePermissionDrafts';

const { Text } = Typography;

/**
 * The single permission screen: pick a role on the left, edit everything it may
 * do on the right (pages, resources, fields).
 *
 * Replaces three separate tabs, each of which rendered its own role-column
 * matrix with its own Save button. The data still lives behind the same three
 * endpoints — no backend change was needed.
 */
export default function PermissionsPage() {
  const { t } = useTranslation();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const drafts = useRolePermissionDrafts(selectedRole);
  const role = selectedRole ?? drafts.roles[0] ?? null;

  if (drafts.isLoading || !drafts.isReady) {
    return <Spin style={{ display: 'block', marginTop: 40 }} />;
  }

  return (
    <div>
      <Flex justify="space-between" align="flex-start" style={{ marginBottom: 16 }} gap={16}>
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
            }}
          >
            <IconShield size={18} color={COLORS.primary} />
            {t('nav.admin_permissions')}
          </div>
          <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
            {t('permissions_admin.subtitle')}
          </div>
        </div>

        <Flex align="center" gap={12}>
          <Input
            allowClear
            prefix={<IconSearch size={14} color={COLORS.textSecondary} />}
            placeholder={t('permissions_admin.search_ph')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {drafts.dirtyCount > 0
              ? t('permissions_admin.unsaved', { count: drafts.dirtyCount })
              : t('permissions_admin.no_changes')}
          </Text>
          <Button
            type="primary"
            onClick={drafts.save}
            loading={drafts.isSaving}
            disabled={drafts.dirtyCount === 0}
          >
            {t('permissions_admin.save_all')}
          </Button>
        </Flex>
      </Flex>

      <Flex gap={16} align="flex-start">
        <RoleSidebar roles={drafts.roles} selected={role} onSelect={setSelectedRole} />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: COLORS.white,
            borderRadius: 8,
            padding: 8,
            maxHeight: 'calc(100vh - 190px)',
            overflowY: 'auto',
          }}
        >
          {role ? (
            <RolePermissionEditor
              role={role}
              search={search}
              pages={drafts.pages}
              pageMatrix={drafts.pageMatrix}
              onTogglePage={drafts.onTogglePage}
              resources={drafts.resources}
              resourceMatrix={drafts.resourceMatrix}
              onToggleResource={drafts.onToggleResource}
              resourceFields={drafts.resourceFields}
              fieldMatrix={drafts.fieldMatrix}
              onToggleField={drafts.onToggleField}
              onToggleAllFields={drafts.onToggleAllFields}
            />
          ) : (
            <Text type="secondary">{t('permissions_admin.select_role')}</Text>
          )}
        </div>
      </Flex>
    </div>
  );
}
