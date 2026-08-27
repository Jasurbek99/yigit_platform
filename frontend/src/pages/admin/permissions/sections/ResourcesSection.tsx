import { useMemo } from 'react';
import { Checkbox, Empty, Flex, Tooltip, Typography } from 'antd';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';
import { DEAD_RESOURCES } from '../deadResources';
import {
  EMPTY_PERM,
  PERM_ACTIONS,
  type ICodeLabel,
  type IPermFlags,
  type TResourceMatrix,
} from '../rolePermissionModel';
import { matchesSearch } from '../searchFilter';

const { Text } = Typography;

const LABEL_WIDTH = 260;
const ACTION_WIDTH = 76;

interface IResourcesSectionProps {
  role: string;
  search: string;
  resources: ICodeLabel[];
  matrix: TResourceMatrix;
  onToggle: (code: string, action: keyof IPermFlags, checked: boolean) => void;
}

/**
 * View / create / edit / delete per resource, for one role.
 *
 * Rows in DEAD_RESOURCES are dimmed and carry a ⚠ — their checkboxes save fine
 * but change nothing, because the real decision is a hardcoded role list in the
 * view. The tooltip names that list and where to find it.
 */
export function ResourcesSection({ role, search, resources, matrix, onToggle }: IResourcesSectionProps) {
  const { t } = useTranslation();

  const visible = useMemo(
    () => resources.filter((resource) => matchesSearch(search, resource.code, resource.label)),
    [resources, search],
  );

  const actionLabel: Record<keyof IPermFlags, string> = {
    view: t('permissions_admin.label_view_full'),
    create: t('permissions_admin.label_create_full'),
    edit: t('permissions_admin.label_edit_full'),
    delete: t('permissions_admin.label_delete_full'),
  };

  if (visible.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('permissions_admin.nothing_found')}
      />
    );
  }

  const roleFlags = matrix[role] ?? {};

  return (
    <Flex vertical gap={2}>
      <Flex gap={8} style={{ paddingLeft: LABEL_WIDTH + 8, marginBottom: 4 }}>
        {PERM_ACTIONS.map((action) => (
          <Text
            key={action}
            type="secondary"
            style={{ fontSize: 10, width: ACTION_WIDTH, textTransform: 'uppercase' }}
          >
            {actionLabel[action]}
          </Text>
        ))}
      </Flex>

      {visible.map((resource) => {
        const dead = DEAD_RESOURCES[resource.code];
        const flags = roleFlags[resource.code] ?? EMPTY_PERM;
        return (
          <Flex
            key={resource.code}
            align="center"
            gap={8}
            style={{
              padding: '4px 0',
              borderBottom: `1px solid ${COLORS.border}`,
              opacity: dead ? 0.6 : 1,
            }}
          >
            <Flex align="center" gap={6} style={{ width: LABEL_WIDTH }}>
              <Tooltip title={resource.code}>
                <Text style={{ fontSize: 12 }}>{resource.label}</Text>
              </Tooltip>
              {dead && (
                <Tooltip
                  title={(
                    <div style={{ fontSize: 11 }}>
                      <div>{t('permissions_admin.dead_warning')}</div>
                      <div style={{ marginTop: 4 }}>
                        {t('permissions_admin.dead_reason', { reason: dead.reason })}
                      </div>
                      <div style={{ marginTop: 2, opacity: 0.75 }}>{dead.where}</div>
                    </div>
                  )}
                >
                  <IconAlertTriangle size={13} color={COLORS.warning} />
                </Tooltip>
              )}
            </Flex>
            {PERM_ACTIONS.map((action) => (
              <span key={action} style={{ width: ACTION_WIDTH }}>
                <Checkbox
                  checked={flags[action]}
                  onChange={(e) => onToggle(resource.code, action, e.target.checked)}
                />
              </span>
            ))}
          </Flex>
        );
      })}
    </Flex>
  );
}
