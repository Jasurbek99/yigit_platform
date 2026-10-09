import { useState, type ReactElement } from 'react';
import { Button, Space, Switch, Typography } from 'antd';
import { PlusOutlined, KeyOutlined } from '@ant-design/icons';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useAgentLogins, useUpdateAgentLogin, type IAgentLogin } from '@/hooks/useAgentLogins';
import { canDo } from '@/utils/permissions';
import { AgentLoginCreateModal } from './AgentLoginCreateModal';
import { AgentPasswordModal } from './AgentPasswordModal';

const { Title } = Typography;

function fullName(row: IAgentLogin): string {
  return [row.first_name, row.last_name].filter(Boolean).join(' ');
}

/**
 * «Логины агентов» (`/market/agents`) — staff create and manage the logins
 * agents use in the agent market. Admin: full; sales rep: own customers;
 * boss / director / export manager / document team: read-only (resource `market_agent`).
 */
export default function AgentLoginsPage(): ReactElement {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCreate = canDo(user, 'market_agent', 'create');
  const canEdit = canDo(user, 'market_agent', 'edit');

  const { data: agents, isLoading } = useAgentLogins();
  const update = useUpdateAgentLogin();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState<IAgentLogin | null>(null);

  const handleToggleActive = (row: IAgentLogin, isActive: boolean): void => {
    update.mutate({ id: row.id, is_active: isActive }, {
      onError: () => toast.error(t('market.agents.save_error')),
    });
  };

  const columns: ProColumns<IAgentLogin>[] = [
    {
      title: t('market.agents.col_customer'),
      dataIndex: ['customer', 'name'],
      defaultSortOrder: 'ascend',
      sorter: (a, b) => a.customer.name.localeCompare(b.customer.name) || a.username.localeCompare(b.username),
    },
    {
      title: t('market.agents.col_username'),
      dataIndex: 'username',
      sorter: (a, b) => a.username.localeCompare(b.username),
    },
    {
      title: t('market.agents.col_name'),
      dataIndex: 'first_name',
      render: (_, row) => fullName(row),
      sorter: (a, b) => fullName(a).localeCompare(fullName(b)),
    },
    {
      title: t('market.agents.col_active'),
      dataIndex: 'is_active',
      sorter: (a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0) || a.username.localeCompare(b.username),
      render: (_, row) => (
        <Switch
          checked={row.is_active}
          disabled={!canEdit}
          aria-label={t('market.agents.col_active')}
          onChange={(checked) => handleToggleActive(row, checked)}
        />
      ),
    },
    ...(canEdit
      ? [{
          title: '',
          key: 'actions',
          render: (_: unknown, row: IAgentLogin) => (
            <Button size="small" icon={<KeyOutlined />} onClick={() => setPwTarget(row)}>
              {t('market.agents.change_password')}
            </Button>
          ),
        }]
      : []),
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>{t('market.agents.title')}</Title>
        {canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateOpen(true)}>
            {t('market.agents.add')}
          </Button>
        )}
      </Space>

      <ProTable<IAgentLogin>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={agents ?? []}
        columns={columns}
        search={false}
        options={false}
        toolBarRender={false}
        pagination={false}
      />

      <AgentLoginCreateModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentPasswordModal target={pwTarget} onClose={() => setPwTarget(null)} />
    </div>
  );
}
