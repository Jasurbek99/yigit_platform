import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/services/api';
import type { ICurrentUser } from '@/types';

const { Title } = Typography;

interface ILoginForm {
  username: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useTranslation();

  const handleSubmit = async (values: ILoginForm) => {
    setIsLoading(true);
    try {
      const { data } = await api.post<ICurrentUser>('/auth/login/', values);
      // Seed the query cache so AppLayout renders the user immediately
      queryClient.setQueryData(['auth', 'me'], data);
      toast.success(t('login.toast_success', { name: data.first_name || data.username }), {
        description: t('login.toast_success_desc', { role: t(`roles.${data.role}`) }),
      });
      navigate('/');
    } catch {
      toast.error(t('login.toast_error'), {
        description: t('login.toast_error_desc'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 380, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={3} style={{ marginBottom: 4 }}>{t('login.title')}</Title>
          <Typography.Text type="secondary">{t('login.subtitle')}</Typography.Text>
        </div>

        <Form layout="vertical" onFinish={handleSubmit} autoComplete="off">
          <Form.Item
            name="username"
            rules={[{ required: true, message: t('login.required_username') }]}
          >
            <Input prefix={<UserOutlined />} placeholder={t('login.username')} size="large" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t('login.required_password') }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder={t('login.password')} size="large" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block size="large" loading={isLoading}>
              {t('login.submit')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
