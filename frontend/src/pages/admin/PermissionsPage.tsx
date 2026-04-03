import { useState } from 'react';
import {
  Tabs,
  Card,
  Select,
  Button,
  Tag,
  Table,
  Switch,
  Space,
  Flex,
  Typography,
  Spin,
  Alert,
} from 'antd';
import { IconShield } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useAdminUsers,
  useGreenhouseBlocks,
  useBlockAssignments,
  useCreateBlockAssignment,
  useDeleteBlockAssignment,
  useUpdateUserPermissions,
} from '@/hooks/useAdmin';
import type { IAdminUser, IGreenhouseBlock, IBlockAssignment } from '@/types';

const { Text } = Typography;

// ─── Block Assignments Tab ────────────────────────────────────────────────────

interface BlockAssignmentsTabProps {
  managers: IAdminUser[];
  blocks: IGreenhouseBlock[];
  assignments: IBlockAssignment[];
  isLoading: boolean;
}

function BlockAssignmentsTab({
  managers,
  blocks,
  assignments,
  isLoading,
}: BlockAssignmentsTabProps) {
  const { t } = useTranslation();
  const [selectedBlocks, setSelectedBlocks] = useState<Record<number, number[]>>({});

  const createAssignment = useCreateBlockAssignment({
    onSuccess: () => toast.success('Blok goşuldy'),
    onError: () => toast.error('Ýalňyşlyk'),
  });

  const deleteAssignment = useDeleteBlockAssignment({
    onError: () => toast.error('Ýalňyşlyk'),
  });

  if (isLoading) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {managers.map((manager) => {
        const userAssignments = assignments.filter((a) => a.user === manager.id);
        const assignedBlockIds = new Set(userAssignments.map((a) => a.block));
        const availableBlocks = blocks
          .filter((b) => b.is_active && !assignedBlockIds.has(b.id))
          .map((b) => ({ value: b.id, label: b.code + (b.name ? ` — ${b.name}` : '') }));

        const pendingBlocks = selectedBlocks[manager.id] ?? [];

        function handleAdd() {
          if (pendingBlocks.length === 0) return;
          pendingBlocks.forEach((blockId) => {
            createAssignment.mutate({ user: manager.id, block: blockId });
          });
          setSelectedBlocks((prev) => ({ ...prev, [manager.id]: [] }));
        }

        return (
          <Card key={manager.id} size="small" style={{ borderRadius: 8 }}>
            <Flex align="center" gap={12} wrap="wrap">
              <div style={{ minWidth: 140 }}>
                <Text strong style={{ fontSize: 13 }}>
                  {manager.username}
                </Text>
                {(manager.first_name || manager.last_name) && (
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, display: 'block' }}
                  >
                    {[manager.first_name, manager.last_name].filter(Boolean).join(' ')}
                  </Text>
                )}
              </div>

              <Flex gap={4} wrap="wrap" style={{ flex: 1 }}>
                {userAssignments.length === 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('common.empty')}
                  </Text>
                )}
                {userAssignments.map((a) => (
                  <Tag
                    key={a.id}
                    closable
                    onClose={() => deleteAssignment.mutate(a.id)}
                    color="blue"
                  >
                    {a.block_code}
                  </Tag>
                ))}
              </Flex>

              <Flex gap={8} align="center">
                <Select
                  mode="multiple"
                  style={{ minWidth: 200 }}
                  placeholder="Blok goş..."
                  options={availableBlocks}
                  value={pendingBlocks}
                  onChange={(vals) =>
                    setSelectedBlocks((prev) => ({ ...prev, [manager.id]: vals }))
                  }
                  maxTagCount={3}
                  size="small"
                />
                <Button
                  size="small"
                  type="primary"
                  onClick={handleAdd}
                  disabled={pendingBlocks.length === 0}
                  loading={createAssignment.isPending}
                >
                  Goş
                </Button>
              </Flex>
            </Flex>
          </Card>
        );
      })}

      {managers.length === 0 && (
        <Alert message="Ýyladyşhana menejerler tapylmady" type="info" />
      )}
    </Space>
  );
}

// ─── Permissions Tab ──────────────────────────────────────────────────────────

const PERM_ADD_PLAN = 'add_weeklyharvestplan';
const PERM_CHANGE_PLAN = 'change_weeklyharvestplan';

interface PermissionsTabProps {
  users: IAdminUser[];
  isLoading: boolean;
}

function PermissionsTab({ users, isLoading }: PermissionsTabProps) {
  const [permState, setPermState] = useState<Record<number, string[]>>({});

  const updatePermissions = useUpdateUserPermissions({
    onError: () => toast.error('Rugsat üýtgedilmedi'),
  });

  function hasPerm(userId: number, perm: string): boolean {
    return (permState[userId] ?? []).includes(perm);
  }

  function handleToggle(userId: number, perm: string, checked: boolean) {
    const current = permState[userId] ?? [];
    const next = checked ? [...current, perm] : current.filter((p) => p !== perm);
    setPermState((prev) => ({ ...prev, [userId]: next }));
    updatePermissions.mutate({ id: userId, permissions: next });
  }

  const ROLE_COLOR: Record<string, string> = {
    director: 'red',
    export_manager: 'blue',
    greenhouse_manager: 'green',
    warehouse_chief: 'cyan',
    document_team: 'geekblue',
    transport: 'orange',
    sales_rep: 'lime',
    finansist: 'gold',
    accountant: 'purple',
  };

  const columns = [
    {
      title: 'Ulanyja',
      dataIndex: 'username',
      key: 'username',
      render: (_: unknown, record: IAdminUser) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{record.username}</Text>
          {(record.first_name || record.last_name) && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {[record.first_name, record.last_name].filter(Boolean).join(' ')}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'Wezipe',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => (
        <Tag color={ROLE_COLOR[role] ?? 'default'}>{role}</Tag>
      ),
    },
    {
      title: 'Plan Goş',
      key: PERM_ADD_PLAN,
      render: (_: unknown, record: IAdminUser) => (
        <Switch
          size="small"
          checked={hasPerm(record.id, PERM_ADD_PLAN)}
          onChange={(checked) => handleToggle(record.id, PERM_ADD_PLAN, checked)}
        />
      ),
    },
    {
      title: 'Plan Üýt',
      key: PERM_CHANGE_PLAN,
      render: (_: unknown, record: IAdminUser) => (
        <Switch
          size="small"
          checked={hasPerm(record.id, PERM_CHANGE_PLAN)}
          onChange={(checked) => handleToggle(record.id, PERM_CHANGE_PLAN, checked)}
        />
      ),
    },
  ];

  return (
    <Table<IAdminUser>
      rowKey="id"
      dataSource={users}
      columns={columns}
      loading={isLoading}
      size="small"
      pagination={false}
      style={{ background: '#fff', borderRadius: 8 }}
    />
  );
}

// ─── PermissionsPage ──────────────────────────────────────────────────────────

export default function PermissionsPage() {
  const { t } = useTranslation();

  const { data: allUsers = [], isLoading: usersLoading } = useAdminUsers();
  const { data: blocks = [], isLoading: blocksLoading } = useGreenhouseBlocks();
  const { data: assignments = [], isLoading: assignmentsLoading } = useBlockAssignments();

  const managers = allUsers.filter((u) => u.role === 'greenhouse_manager');
  const blockTabLoading = usersLoading || blocksLoading || assignmentsLoading;

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: '#1f1f1f',
            lineHeight: '1.3',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <IconShield size={18} color="#1677ff" />
          {t('nav.admin_permissions')}
        </div>
        <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
          Blok düzgünlerini we rugsatlaryny dolandyrmak
        </div>
      </div>

      <Tabs
        defaultActiveKey="blocks"
        items={[
          {
            key: 'blocks',
            label: 'Blok Düzgünleri',
            children: (
              <BlockAssignmentsTab
                managers={managers}
                blocks={blocks}
                assignments={assignments}
                isLoading={blockTabLoading}
              />
            ),
          },
          {
            key: 'permissions',
            label: 'Rugsat Dolandyryşy',
            children: (
              <PermissionsTab users={allUsers} isLoading={usersLoading} />
            ),
          },
        ]}
      />
    </div>
  );
}
