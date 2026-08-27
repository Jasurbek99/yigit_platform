import { Badge, Collapse, Flex, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';
import { DEAD_RESOURCES } from './deadResources';
import { PagesSection } from './sections/PagesSection';
import { ResourcesSection } from './sections/ResourcesSection';
import { FieldsSection } from './sections/FieldsSection';
import {
  countVisiblePages,
  type ICodeLabel,
  type IPermFlags,
  type TFieldMatrix,
  type TPageMatrix,
  type TResourceMatrix,
} from './rolePermissionModel';

const { Text } = Typography;

interface IRolePermissionEditorProps {
  role: string;
  search: string;
  pages: ICodeLabel[];
  pageMatrix: TPageMatrix;
  onTogglePage: (code: string, checked: boolean) => void;
  resources: ICodeLabel[];
  resourceMatrix: TResourceMatrix;
  onToggleResource: (code: string, action: keyof IPermFlags, checked: boolean) => void;
  resourceFields: Record<string, string[]>;
  fieldMatrix: TFieldMatrix;
  onToggleField: (resource: string, field: string, checked: boolean) => void;
  onToggleAllFields: (resource: string, checked: boolean) => void;
}

/**
 * Everything one role may do, on one screen: pages, resources, fields.
 *
 * Replaces the three role-column matrices that used to live behind separate
 * tabs — an admin's real question is "what can Sulgun do", not "who can see the
 * quota page", and the old layout answered the second at the cost of a
 * 15-column horizontal scroll. Purely presentational: drafts and saving live in
 * useRolePermissionDrafts.
 */
export function RolePermissionEditor(props: IRolePermissionEditorProps) {
  const { t } = useTranslation();
  const { role, search, pages, pageMatrix, resources, resourceMatrix, resourceFields, fieldMatrix } = props;

  const seenPages = countVisiblePages(pageMatrix, role, pages);
  const deadCount = resources.filter((resource) => resource.code in DEAD_RESOURCES).length;

  return (
    <Collapse
      defaultActiveKey={['pages', 'resources']}
      style={{ background: COLORS.white }}
      items={[
        {
          key: 'pages',
          label: (
            <Flex align="center" gap={8}>
              <Text strong style={{ fontSize: 13 }}>{t('permissions_admin.section_pages')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('permissions_admin.pages_count', { visible: seenPages, total: pages.length })}
              </Text>
            </Flex>
          ),
          children: (
            <PagesSection
              role={role}
              search={search}
              pages={pages}
              matrix={pageMatrix}
              onToggle={props.onTogglePage}
            />
          ),
        },
        {
          key: 'resources',
          label: (
            <Flex align="center" gap={8}>
              <Text strong style={{ fontSize: 13 }}>{t('permissions_admin.section_resources')}</Text>
              <Badge
                count={deadCount}
                size="small"
                style={{ backgroundColor: COLORS.warning }}
                title={t('permissions_admin.dead_badge')}
              />
            </Flex>
          ),
          children: (
            <ResourcesSection
              role={role}
              search={search}
              resources={resources}
              matrix={resourceMatrix}
              onToggle={props.onToggleResource}
            />
          ),
        },
        {
          key: 'fields',
          label: (
            <Flex align="center" gap={8}>
              <Text strong style={{ fontSize: 13 }}>{t('permissions_admin.section_fields')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('permissions_admin.section_fields_hint')}
              </Text>
            </Flex>
          ),
          children: (
            <FieldsSection
              role={role}
              search={search}
              resourceFields={resourceFields}
              matrix={fieldMatrix}
              onToggle={props.onToggleField}
              onToggleAll={props.onToggleAllFields}
            />
          ),
        },
      ]}
    />
  );
}
