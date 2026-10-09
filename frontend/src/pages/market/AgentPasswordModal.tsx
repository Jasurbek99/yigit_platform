import type { ReactElement } from 'react';
import { Form, Input, Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUpdateAgentLogin, type IAgentLogin } from '@/hooks/useAgentLogins';
import { formFieldErrors } from '@/utils/drfErrors';

const { Paragraph } = Typography;

interface IAgentPasswordModalProps {
  /** The login whose password is reset; null keeps the modal closed. */
  readonly target: IAgentLogin | null;
  readonly onClose: () => void;
}

interface IPasswordForm {
  password: string;
}

function isPasswordField(name: string): name is keyof IPasswordForm {
  return name === 'password';
}

/** «Сменить пароль» of one agent login. */
export function AgentPasswordModal({ target, onClose }: IAgentPasswordModalProps): ReactElement {
  const { t } = useTranslation();
  const [form] = Form.useForm<IPasswordForm>();
  const update = useUpdateAgentLogin();

  const handleFinish = (values: IPasswordForm): void => {
    if (!target) return;
    update.mutate({ id: target.id, password: values.password }, {
      onSuccess: () => {
        toast.success(t('market.agents.password_changed'));
        onClose();
        form.resetFields();
      },
      onError: (err) => {
        const fields = formFieldErrors(err, isPasswordField);
        if (fields.length) form.setFields(fields);
        else toast.error(t('market.agents.save_error'));
      },
    });
  };

  return (
    <Modal
      open={target !== null}
      title={`${t('market.agents.change_password')}: ${target?.username ?? ''}`}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      confirmLoading={update.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Paragraph type="secondary">{t('market.agents.password_hint')}</Paragraph>
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item
          name="password"
          label={t('market.agents.new_password')}
          rules={[{ required: true, message: t('market.agents.required') }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
