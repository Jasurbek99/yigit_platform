import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Popconfirm, Tabs, Tag, Typography } from 'antd';
import { ShopOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAdminImportFirms, useUpdateImportFirm } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import type { IImportFirm } from '@/types';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

export default function ImportFirmsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('our');

  const canCreate = canDo(user, 'import_firm', 'create');
  const canEdit = canDo(user, 'import_firm', 'edit');

  const moveMutation = useUpdateImportFirm({
    onSuccess: () => toast.success(t('import_firms_admin.toast_updated')),
    onError: () => toast.error(t('import_firms_admin.toast_error')),
  });

  const { data, isLoading, isError } = useAdminImportFirms();
  const allRows = useMemo(() => data ?? [], [data]);

  const ourRows = useMemo(() => allRows.filter((r) => !r.is_gapy_satys), [allRows]);
  const gapyRows = useMemo(() => allRows.filter((r) => r.is_gapy_satys), [allRows]);
  const rows = activeTab === 'our' ? ourRows : gapyRows;

  const columns: ProColumns<IImportFirm>[] = [
    {
      title: '#',
      dataIndex: 'index',
      width: 50,
      search: false,
      render: (_, __, index) => index + 1,
    },
    {
      title: t('import_firms_admin.name_short'),
      dataIndex: 'name_short',
      width: 140,
      ellipsis: true,
      sorter: (a, b) => (a.name_short || '').localeCompare(b.name_short || ''),
      render: (_, record) => record.name_short ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('import_firms_admin.name_company'),
      dataIndex: 'name_company',
      ellipsis: true,
      sorter: (a, b) => a.name_company.localeCompare(b.name_company),
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
    ...(canEdit
      ? [
          {
            title: t('import_firms_admin.actions'),
            dataIndex: 'actions',
            width: 180,
            search: false,
            render: (_, record) => {
              const targetGapy = !record.is_gapy_satys;
              return (
                <Popconfirm
                  title={t('import_firms_admin.confirm_move')}
                  okText={t('common.yes')}
                  cancelText={t('common.no')}
                  onConfirm={() => moveMutation.mutate({ id: record.id, is_gapy_satys: targetGapy })}
                >
                  <Button
                    size="small"
                    icon={<SwapOutlined />}
                    loading={moveMutation.isPending}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {targetGapy
                      ? t('import_firms_admin.move_to_gapy')
                      : t('import_firms_admin.move_to_our')}
                  </Button>
                </Popconfirm>
              );
            },
          } as ProColumns<IImportFirm>,
        ]
      : []),
  ];

  if (isError) return <Alert message={t('import_firms_admin.error_load')} type="error" style={{ marginTop: 40 }} />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShopOutlined style={{ color: COLORS.primary }} />
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
        scroll={{ x: 'max-content' }}
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
