import { useMemo } from 'react';
import { Alert, Checkbox, Empty, Flex, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { TFieldMatrix } from '../rolePermissionModel';
import { matchesSearch } from '../searchFilter';

interface IFieldsSectionProps {
  role: string;
  search: string;
  resourceFields: Record<string, string[]>;
  matrix: TFieldMatrix;
  onToggle: (resource: string, field: string, checked: boolean) => void;
  onToggleAll: (resource: string, checked: boolean) => void;
}

/**
 * Which individual fields a role may edit, per resource.
 *
 * The `*` wildcard means "every field". While it is set the individual boxes are
 * shown checked but disabled, rather than silently expanded into an explicit
 * list — that keeps what is saved identical to what is displayed.
 */
export function FieldsSection({
  role, search, resourceFields, matrix, onToggle, onToggleAll,
}: IFieldsSectionProps) {
  const { t } = useTranslation();

  const resources = useMemo(
    () => Object.keys(resourceFields).filter((code) => matchesSearch(search, code)),
    [resourceFields, search],
  );

  return (
    <Flex vertical gap={14}>
      <Alert
        type="info"
        showIcon
        style={{ fontSize: 12 }}
        message={t('permissions_admin.field_perms_desc')}
      />
      {resources.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('permissions_admin.nothing_found')}
        />
      ) : resources.map((resource) => {
        const granted = matrix[resource]?.[role] ?? [];
        const hasWildcard = granted.includes('*');
        return (
          <div key={resource}>
            <Flex align="center" gap={8}>
              <Tag style={{ fontSize: 11 }}>{resource}</Tag>
              <Checkbox
                checked={hasWildcard}
                onChange={(e) => onToggleAll(resource, e.target.checked)}
                style={{ fontSize: 12 }}
              >
                {t('permissions_admin.all_fields')}
              </Checkbox>
            </Flex>
            <Flex wrap gap={4} style={{ marginTop: 6 }}>
              {(resourceFields[resource] ?? []).map((field) => (
                <Checkbox
                  key={field}
                  checked={hasWildcard || granted.includes(field)}
                  disabled={hasWildcard}
                  onChange={(e) => onToggle(resource, field, e.target.checked)}
                  style={{ width: 220, fontSize: 11, marginInlineStart: 0 }}
                >
                  {field}
                </Checkbox>
              ))}
            </Flex>
          </div>
        );
      })}
    </Flex>
  );
}
