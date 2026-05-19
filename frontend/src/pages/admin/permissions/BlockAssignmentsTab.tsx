import { useState } from 'react';
import { Alert, Button, Card, Flex, Select, Space, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useCreateBlockAssignment,
  useDeleteBlockAssignment,
} from '@/hooks/useAdmin';
import type { IAdminUser, IGreenhouseBlock, IBlockAssignment } from '@/types';

const { Text } = Typography;

interface IBlockAssignmentsTabProps {
  managers: IAdminUser[];
  blocks: IGreenhouseBlock[];
  assignments: IBlockAssignment[];
  isLoading: boolean;
}

export function BlockAssignmentsTab({
  managers,
  blocks,
  assignments,
  isLoading,
}: IBlockAssignmentsTabProps) {
  const { t } = useTranslation();
  const [selectedBlocks, setSelectedBlocks] = useState<Record<number, number[]>>({});

  const createAssignment = useCreateBlockAssignment({
    onSuccess: () => toast.success(t('permissions_admin.toast_block_added')),
    onError: () => toast.error(t('permissions_admin.toast_error')),
  });

  const deleteAssignment = useDeleteBlockAssignment({
    onError: () => toast.error(t('permissions_admin.toast_error')),
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
                  placeholder={t('permissions_admin.block_select_ph')}
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
                  {t('permissions_admin.block_add_btn')}
                </Button>
              </Flex>
            </Flex>
          </Card>
        );
      })}

      {managers.length === 0 && (
        <Alert message={t('permissions_admin.no_managers')} type="info" />
      )}
    </Space>
  );
}
