import { useNavigate } from 'react-router-dom';
import { Alert, Button, Tag, Typography } from 'antd';
import { BankOutlined, PlusOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { useAdminFirms } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IExportFirm } from '@/types';

const { Title, Text } = Typography;

export default function ExportFirmsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const canCreate =
    user?.is_superuser ||
    user?.role === 'director' ||
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('add_exportfirm');

  const { data, isLoading, isError } = useAdminFirms();
  const rows = data ?? [];

  const columns: ProColumns<IExportFirm>[] = [
    {
      title: t('firms_admin.code'),
      dataIndex: 'code',
      width: 90,
      search: false,
      sorter: (a, b) => a.code.localeCompare(b.code),
    },
    {
      title: t('firms_admin.name_tk'),
      dataIndex: 'name_tk',
      ellipsis: true,
      sorter: (a, b) => a.name_tk.localeCompare(b.name_tk),
    },
    {
      title: t('firms_admin.name_en'),
      dataIndex: 'name_en',
      ellipsis: true,
      sorter: (a, b) => (a.name_en || '').localeCompare(b.name_en || ''),
      render: (_, record) => record.name_en ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('firms_admin.name_ru'),
      dataIndex: 'name_ru',
      ellipsis: true,
      responsive: ['md'],
      sorter: (a, b) => (a.name_ru || '').localeCompare(b.name_ru || ''),
      render: (_, record) => record.name_ru ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('firms_admin.is_active'),
      dataIndex: 'is_active',
      width: 90,
      search: false,
      defaultSortOrder: 'descend' as const,
      sorter: (a, b) => {
        const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        return diff !== 0 ? diff : a.code.localeCompare(b.code);
      },
      render: (_, record) =>
        record.is_active
          ? <Tag color="green">{t('common.yes')}</Tag>
          : <Tag color="default">{t('common.no')}</Tag>,
    },
  ];

  if (isError) return <Alert message={t('firms_admin.error_load')} type="error" style={{ marginTop: 40 }} />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <BankOutlined style={{ color: '#1677ff' }} />
          {t('firms_admin.title')}
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('firms_admin.subtitle')}
        </Text>
      </div>

      <ProTable<IExportFirm>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        size="small"
        onRow={(record) => ({ onClick: () => navigate(`/admin/firms/${record.id}`) })}
        rowHoverable
        toolBarRender={() =>
          canCreate
            ? [
                <Button
                  key="add"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => navigate('/admin/firms/new')}
                >
                  {t('firms_admin.add')}
                </Button>,
              ]
            : []
        }
      />
    </div>
  );
}
