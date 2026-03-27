import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { ICurrentUser } from '@/types';

const { Title } = Typography;

interface ILoginForm {
  username: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (values: ILoginForm) => {
    setIsLoading(true);
    try {
      const { data } = await api.post<ICurrentUser>('/auth/login/', values);
      setUser(data);
      navigate('/');
    } catch {
      message.error('Invalid username or password');
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
          <Title level={3} style={{ marginBottom: 4 }}>YGT Platform</Title>
          <Typography.Text type="secondary">Export Management System</Typography.Text>
        </div>

        <Form layout="vertical" onFinish={handleSubmit} autoComplete="off">
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'Please enter your username' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block size="large" loading={isLoading}>
              Sign In
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
