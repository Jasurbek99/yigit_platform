import { Tabs } from 'antd';
import { IconShield } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { PageVisibilityTab } from './permissions/PageVisibilityTab';
import { ResourcePermissionsTab } from './permissions/ResourcePermissionsTab';
import { FieldPermissionsTab } from './permissions/FieldPermissionsTab';
import { COLORS } from '@/constants/styles';

export default function PermissionsPage() {
  const { t } = useTranslation();

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
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

      <Tabs
        defaultActiveKey="page_visibility"
        items={[
          {
            key: 'page_visibility',
            label: t('permissions_admin.tab_page_visibility'),
            children: <PageVisibilityTab />,
          },
          {
            key: 'resource_perms',
            label: t('permissions_admin.tab_resource_perms'),
            children: <ResourcePermissionsTab />,
          },
          {
            key: 'field_perms',
            label: t('permissions_admin.tab_field_perms'),
            children: <FieldPermissionsTab />,
          },
        ]}
      />
    </div>
  );
}
