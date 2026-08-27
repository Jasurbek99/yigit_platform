import { Flex, Tag, Tooltip } from 'antd';
import { COLORS } from '@/constants/styles';
import { ROLE_COLOR } from './roleColors';

interface IRoleSidebarProps {
  roles: string[];
  selected: string | null;
  onSelect: (role: string) => void;
}

/** The role picker: one click switches the whole editor to that role. */
export function RoleSidebar({ roles, selected, onSelect }: IRoleSidebarProps) {
  return (
    <Flex
      vertical
      gap={2}
      style={{
        width: 190,
        flexShrink: 0,
        background: COLORS.white,
        borderRadius: 8,
        padding: 8,
        maxHeight: 'calc(100vh - 190px)',
        overflowY: 'auto',
      }}
    >
      {roles.map((code) => (
        <Flex
          key={code}
          align="center"
          onClick={() => onSelect(code)}
          style={{
            cursor: 'pointer',
            padding: '6px 8px',
            borderRadius: 6,
            background: code === selected ? COLORS.bgLight : 'transparent',
          }}
        >
          <Tooltip title={code}>
            <Tag color={ROLE_COLOR[code] ?? 'default'} style={{ fontSize: 11, marginInlineEnd: 0 }}>
              {code}
            </Tag>
          </Tooltip>
        </Flex>
      ))}
    </Flex>
  );
}
