import { Alert, Flex, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { ROLE_COLOR } from '@/pages/admin/permissions/roleColors';

const { Text } = Typography;

interface ISheetRowAccessSectionProps {
  triggeredRoles: string[];
}

/**
 * Read-only since AD-17 (2026-09-02). Row access is granted on the Row access
 * tab and nowhere else — a select here would be a second writer for the same
 * SheetRowRoleTrigger rows, which is what the two-places bug was.
 *
 * The lock switch is gone too: with trigger config present the answer is
 * has_any_trigger whether or not the row is locked, so the control no longer
 * changed any outcome.
 */
export function SheetRowAccessSection({ triggeredRoles }: ISheetRowAccessSectionProps) {
  const { t } = useTranslation();

  return (
    <Flex vertical gap={8}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('sheet_rows.access_readonly_label')}
      </Text>

      {triggeredRoles.length === 0 ? (
        <Alert type="warning" showIcon message={t('sheet_rows.access_none')} />
      ) : (
        <Flex wrap gap={4}>
          {triggeredRoles.map((role) => (
            <Tag key={role} color={ROLE_COLOR[role] ?? 'default'} style={{ fontSize: 11 }}>
              {role}
            </Tag>
          ))}
        </Flex>
      )}

      <Text type="secondary" style={{ fontSize: 11 }}>
        {t('sheet_rows.access_edit_hint')}
      </Text>
    </Flex>
  );
}
