import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Avatar, Dropdown, Typography } from 'antd';
import {
  DashboardOutlined,
  CarOutlined,
  LogoutOutlined,
  UserOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

const { Sider, Header, Content } = Layout;

const NAV_ITEMS = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/export/shipments', icon: <CarOutlined />, label: 'Shipments' },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [collapsed, setCollapsed] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout/'),
    onSuccess: () => {
      setUser(null);
      queryClient.clear();
      navigate('/login');
    },
  });

  const userMenuItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign Out',
      onClick: () => logoutMutation.mutate(),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={220}
        style={{ background: '#001529' }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 16px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {!collapsed && (
            <Typography.Text style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
              YGT Platform
            </Typography.Text>
          )}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            height: 56,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />

          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} size="small" />
              {user && (
                <Typography.Text>
                  {user.first_name || user.username}
                </Typography.Text>
              )}
            </div>
          </Dropdown>
        </Header>

        <Content style={{ margin: '16px', overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
