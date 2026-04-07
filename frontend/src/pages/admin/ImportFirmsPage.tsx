import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Tabs, Tag, Typography } from 'antd';
import { ShopOutlined, PlusOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { useAdminImportFirms } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IImportFirm } from '@/types';

const { Title, Text } = Typography;

export default function ImportFirmsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('our');

  const canCreate =
    user?.is_superuser ||
    user?.role === 'director' ||
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('add_importfirm');

  const { data, isLoading, isError } = useAdminImportFirms();
  const allRows = data ?? [];

  const ourRows = useMemo(() => allRows.filter((r) => !r.is_gapy_satys), [allRows]);
  const gapyRows = useMemo(() => allRows.filter((r) => r.is_gapy_satys), [allRows]);
  const rows = activeTab === 'our' ? ourRows : gapyRows;

  const columns: ProColumns<IImportFirm>[] = [
    {
      title: t('import_firms_admin.code'),
      dataIndex: 'code',
      width: 80,
      search: false,
      sorter: (a, b) => (a.code || '').localeCompare(b.code || ''),
      render: (_, record) => record.code ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('import_firms_admin.name_company'),
      dataIndex: 'name_company',
      ellipsis: true,
      sorter: (a, b) => a.name_company.localeCompare(b.name_company),
    },
    {
      title: t('import_firms_admin.name_short'),
      dataIndex: 'name_short',
      width: 130,
      ellipsis: true,
      responsive: ['md'],
      sorter: (a, b) => (a.name_short || '').localeCompare(b.name_short || ''),
      render: (_, record) => record.name_short ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('import_firms_admin.country'),
      dataIndex: 'country_name',
      width: 120,
      search: false,
      sorter: (a, b) => (a.country_name || '').localeCompare(b.country_name || ''),
      render: (_, record) => record.country_name ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('import_firms_admin.contact_person'),
      dataIndex: 'contact_person',
      width: 140,
      responsive: ['lg'],
      search: false,
      render: (_, record) => record.contact_person ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('import_firms_admin.phone'),
      dataIndex: 'phone',
      width: 120,
      responsive: ['lg'],
      search: false,
      render: (_, record) => record.phone ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('import_firms_admin.is_active'),
      dataIndex: 'is_active',
      width: 90,
      search: false,
      defaultSortOrder: 'descend' as const,
      sorter: (a, b) => {
        const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        return diff !== 0 ? diff : a.name_company.localeCompare(b.name_company);
      },
      render: (_, record) =>
        record.is_active
          ? <Tag color="green">{t('common.yes')}</Tag>
          : <Tag color="default">{t('common.no')}</Tag>,
    },
  ];

  if (isError) return <Alert message={t('import_firms_admin.error_load')} type="error" style={{ marginTop: 40 }} />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShopOutlined style={{ color: '#1677ff' }} />
          {t('import_firms_admin.title')}
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('import_firms_admin.subtitle')}
        </Text>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'our',
            label: `${t('import_firms_admin.tab_our')} (${ourRows.length})`,
          },
          {
            key: 'gapy',
            label: `${t('import_firms_admin.tab_gapy_satys')} (${gapyRows.length})`,
          },
        ]}
        style={{ marginBottom: -8 }}
      />

      <ProTable<IImportFirm>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        size="small"
        onRow={(record) => ({ onClick: () => navigate(`/admin/import-firms/${record.id}`) })}
        rowHoverable
        toolBarRender={() =>
          canCreate
            ? [
                <Button
                  key="add"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => navigate('/admin/import-firms/new')}
                >
                  {t('import_firms_admin.add')}
                </Button>,
              ]
            : []
        }
      />
    </div>
  );
}
