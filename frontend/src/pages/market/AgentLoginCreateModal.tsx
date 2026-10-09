import type { ReactElement } from 'react';
import { Form, Input, Modal, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCustomers } from '@/hooks/useAdmin';
import { useCreateAgentLogin, type IAgentLoginCreate } from '@/hooks/useAgentLogins';
import { formFieldErrors } from '@/utils/drfErrors';

interface IAgentLoginCreateModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const CREATE_FIELDS: ReadonlyArray<keyof IAgentLoginCreate> = [
  'customer_id', 'username', 'password', 'first_name', 'last_name',
];

function isCreateField(name: string): name is keyof IAgentLoginCreate {
  return CREATE_FIELDS.some((field) => field === name);
}

/** «Добавить логин»: a new agent login for one customer. Server field errors land under their fields. */
export function AgentLoginCreateModal({ open, onClose }: IAgentLoginCreateModalProps): ReactElement {
  const { t } = useTranslation();
  const [form] = Form.useForm<IAgentLoginCreate>();
  const { data: customers, isLoading: customersLoading } = useCustomers();
  const create = useCreateAgentLogin();
  const required = [{ required: true, message: t('market.agents.required') }];

  const handleFinish = (values: IAgentLoginCreate): void => {
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
        onClose();
        form.resetFields();
      },
      onError: (err) => {
        const fields = formFieldErrors(err, isCreateField);
        if (fields.length) form.setFields(fields);
        else toast.error(t('market.agents.save_error'));
      },
    });
  };

  return (
    <Modal
      open={open}
      title={t('market.agents.add')}
      okText={t('market.agents.create')}
      cancelText={t('common.cancel')}
      confirmLoading={create.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item name="customer_id" label={t('market.agents.customer')} rules={required}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={customersLoading}
            options={(customers ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item name="username" label={t('market.agents.username')} rules={required}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="password" label={t('market.agents.password')} rules={required}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="first_name" label={t('market.agents.first_name')} rules={required}>
          <Input />
        </Form.Item>
        <Form.Item name="last_name" label={t('market.agents.last_name')}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}
