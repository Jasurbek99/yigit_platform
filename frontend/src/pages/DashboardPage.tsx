import { Typography, Card } from 'antd';
import { useAuthStore } from '@/stores/authStore';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        Dashboard
      </Typography.Title>
      <Card>
        <Typography.Text type="secondary">
          Welcome, {user?.first_name || user?.username}. Select a module from the sidebar.
        </Typography.Text>
      </Card>
    </div>
  );
}
