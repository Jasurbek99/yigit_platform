import { useState } from 'react';
import type { FormInstance } from 'antd';
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Typography } from 'antd';
import { PlusOutlined, KeyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useCustomers } from '@/hooks/useAdmin';
import {
  useAgentLogins, useCreateAgentLogin, useUpdateAgentLogin,
  type IAgentLogin, type IAgentLoginCreate,
} from '@/hooks/useAgentLogins';
import { canDo } from '@/utils/permissions';

const { Paragraph, Title } = Typography;

type FieldErrors = Record<string, string[] | string>;

// Turns a DRF `{field: [msg]}` 400 body into Ant Design field errors for the
// fields this form owns. Returns false when none match (403, network error,
// non_field_errors, ...), so the caller can fall back to a toast.
function applyServerErrors<T>(form: FormInstance<T>, err: unknown, formFields: string[]): boolean {
  const data = (err as { response?: { data?: FieldErrors } })?.response?.data;
  if (!data || typeof data !== 'object') return false;
  const fields = Object.entries(data)
    .filter(([name]) => formFields.includes(name))
    .map(([name, msgs]) => ({ name, errors: Array.isArray(msgs) ? msgs : [String(msgs)] }));
  if (fields.length === 0) return false;
  form.setFields(fields as never);
  return true;
}

const CREATE_FIELDS = ['customer_id', 'username', 'password', 'first_name', 'last_name'];

/**
 * «Логины агентов» (`/market/agents`) — staff create and manage the logins
 * agents use in the agent market. Admin/boss: full; sales rep: own customers;
 * director/export manager/document team: read-only (resource `market_agent`).
 */
export default function AgentLoginsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCreate = canDo(user, 'market_agent', 'create');
  const canEdit = canDo(user, 'market_agent', 'edit');

  const { data: agents, isLoading } = useAgentLogins();
  const { data: customers, isLoading: customersLoading } = useCustomers();
  const create = useCreateAgentLogin();
  const update = useUpdateAgentLogin();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<IAgentLoginCreate>();
  const [pwTarget, setPwTarget] = useState<IAgentLogin | null>(null);
  const [pwForm] = Form.useForm<{ password: string }>();

  const submitCreate = (values: IAgentLoginCreate) => {
    const body: IAgentLoginCreate = {
      customer_id: values.customer_id,
      username: values.username,
      password: values.password,
      first_name: values.first_name,
      ...(values.last_name ? { last_name: values.last_name } : {}),
    };
    create.mutate(body, {
      onSuccess: () => {
        toast.success(t('market.agents.created'));
        setCreateOpen(false);
        createForm.resetFields();
      },
      onError: (err) => {
        if (!applyServerErrors(createForm, err, CREATE_FIELDS)) toast.error(t('market.agents.save_error'));
      },
    });
  };

  const submitPassword = (values: { password: string }) => {
    if (!pwTarget) return;
    update.mutate({ id: pwTarget.id, password: values.password }, {
      onSuccess: () => {
        toast.success(t('market.agents.password_changed'));
        setPwTarget(null);
        pwForm.resetFields();
      },
      onError: (err) => {
        if (!applyServerErrors(pwForm, err, ['password'])) toast.error(t('market.agents.save_error'));
      },
    });
  };

  const toggleActive = (row: IAgentLogin, is_active: boolean) => {
    update.mutate({ id: row.id, is_active }, {
      onError: () => toast.error(t('market.agents.save_error')),
    });
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>{t('market.agents.title')}</Title>
        {canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('market.agents.add')}
          </Button>
        )}
      </Space>

      <Table<IAgentLogin>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={agents ?? []}
        pagination={false}
        columns={[
          { title: t('market.agents.col_customer'), dataIndex: ['customer', 'name'] },
          { title: t('market.agents.col_username'), dataIndex: 'username' },
          {
            title: t('market.agents.col_name'),
            render: (_: unknown, row) => [row.first_name, row.last_name].filter(Boolean).join(' '),
          },
          {
            title: t('market.agents.col_active'),
            dataIndex: 'is_active',
            render: (value: boolean, row) => (
              <Switch
                checked={value}
                disabled={!canEdit}
                aria-label={t('market.agents.col_active')}
                onChange={(checked) => toggleActive(row, checked)}
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
        ]}
      />

      <Modal
        open={createOpen}
        title={t('market.agents.add')}
        okText={t('market.agents.create')}
        cancelText={t('common.cancel')}
        confirmLoading={create.isPending}
        onOk={() => createForm.submit()}
        onCancel={() => setCreateOpen(false)}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={submitCreate}>
          <Form.Item
            name="customer_id"
            label={t('market.agents.customer')}
            rules={[{ required: true, message: t('market.agents.required') }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              loading={customersLoading}
              options={(customers ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
          <Form.Item
            name="username"
            label={t('market.agents.username')}
            rules={[{ required: true, message: t('market.agents.required') }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('market.agents.password')}
            rules={[{ required: true, message: t('market.agents.required') }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="first_name"
            label={t('market.agents.first_name')}
            rules={[{ required: true, message: t('market.agents.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="last_name" label={t('market.agents.last_name')}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={pwTarget !== null}
        title={`${t('market.agents.change_password')}: ${pwTarget?.username ?? ''}`}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={update.isPending}
        onOk={() => pwForm.submit()}
        onCancel={() => setPwTarget(null)}
        destroyOnHidden
      >
        <Paragraph type="secondary">{t('market.agents.password_hint')}</Paragraph>
        <Form form={pwForm} layout="vertical" onFinish={submitPassword}>
          <Form.Item
            name="password"
            label={t('market.agents.new_password')}
            rules={[{ required: true, message: t('market.agents.required') }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
