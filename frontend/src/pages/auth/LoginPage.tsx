import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/services/api';
import type { ICurrentUser } from '@/types';

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
        background: 'linear-gradient(135deg, #001529 0%, #002140 50%, #003a8c 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          top: '-50%',
          right: '-20%',
          width: 800,
          height: 800,
          background: 'radial-gradient(circle, rgba(22,119,255,0.15) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }}
      />

      {/* Login card */}
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '48px 40px',
          width: '100%',
          maxWidth: 400,
          margin: '0 16px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 32,
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              background: '#1677ff',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 18,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            Y
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: '#1f1f1f' }}>
              YGT Platform
            </div>
            <div style={{ fontSize: 12, color: '#8c8c8c', textAlign: 'center' }}>
              Operasiýalar Platformasy
            </div>
          </div>
        </div>

        <Form layout="vertical" onFinish={handleSubmit} autoComplete="off">
          <Form.Item
            name="username"
            rules={[{ required: true, message: t('login.required_username') }]}
          >
            <Input
              placeholder={t('login.username')}
              size="large"
              style={{ borderRadius: 8, height: 44 }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: t('login.required_password') }]}
          >
            <Input.Password
              placeholder={t('login.password')}
              size="large"
              style={{ borderRadius: 8, height: 44 }}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={isLoading}
              style={{ height: 44, borderRadius: 8, fontSize: 15, fontWeight: 600 }}
            >
              {t('login.submit')}
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#bfbfbf' }}>
          YGT Platform © 2026 — v1.0
        </div>
      </div>
    </div>
  );
}
