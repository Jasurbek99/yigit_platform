import { Typography, Card } from 'antd';
import { useAuth } from '@/hooks/useAuth';

export default function DashboardPage() {
  const { user } = useAuth();

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
