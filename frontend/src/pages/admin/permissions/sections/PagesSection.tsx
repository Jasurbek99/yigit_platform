import { useMemo } from 'react';
import { Checkbox, Empty, Flex, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { groupPages, type ICodeLabel, type TPageMatrix } from '../rolePermissionModel';
import { matchesSearch } from '../searchFilter';

const { Text } = Typography;

interface IPagesSectionProps {
  role: string;
  search: string;
  pages: ICodeLabel[];
  matrix: TPageMatrix;
  onToggle: (code: string, checked: boolean) => void;
}

/** Which pages a role sees in the sidebar, grouped by the prefix of the page code. */
export function PagesSection({ role, search, pages, matrix, onToggle }: IPagesSectionProps) {
  const { t } = useTranslation();

  const groups = useMemo(
    () => groupPages(pages.filter((page) => matchesSearch(search, page.code, page.label))),
    [pages, search],
  );

  const groupLabel = (key: string): string =>
    t(`permissions_admin.page_group.${key}`, { defaultValue: '' }) || key;

  if (groups.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('permissions_admin.nothing_found')}
      />
    );
  }

  return (
    <Flex vertical gap={14}>
      {groups.map((group) => (
        <div key={group.key}>
          <Text
            type="secondary"
            style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            {groupLabel(group.key)}
          </Text>
          <Flex wrap gap={4} style={{ marginTop: 6 }}>
            {group.items.map((page) => (
              <Tooltip key={page.code} title={page.code}>
                <Checkbox
                  checked={matrix[role]?.[page.code] ?? false}
                  onChange={(e) => onToggle(page.code, e.target.checked)}
                  style={{ width: 260, fontSize: 12, marginInlineStart: 0 }}
                >
                  {page.label}
                </Checkbox>
              </Tooltip>
            ))}
          </Flex>
        </div>
      ))}
    </Flex>
  );
}
