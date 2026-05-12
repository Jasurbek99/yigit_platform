import { useState } from 'react';
import {
  Alert,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Space,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useAdminCustomers,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  useCountries,
  useCities,
  useAdminImportFirms,
} from '@/hooks/useAdmin';
import type { ICustomer } from '@/types';

const { Title, Text } = Typography;

interface CustomerFormValues {
  name: string;
  phone?: string | null;
  default_country?: number | null;
  default_city?: number | null;
  import_firms?: number[];
  is_active?: boolean;
}

export default function CustomersPage() {
  const { t } = useTranslation();
  const { data: customers = [], isLoading, isError } = useAdminCustomers();
  const { data: countries = [] } = useCountries();
  const { data: importFirms = [] } = useAdminImportFirms();

  const [searchText, setSearchText] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ICustomer | null>(null);
  const [form] = Form.useForm();
  const watchedCountry = Form.useWatch('default_country', form) as number | null | undefined;
  const { data: cities = [] } = useCities(watchedCountry);

  const createCustomer = useCreateCustomer({
    onSuccess: () => {
      toast.success(t('customers_admin.toast_created'));
      setModalOpen(false);
      form.resetFields();
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: Record<string, string[]> } }).response?.data;
      const msg = detail?.name?.[0] ?? t('customers_admin.toast_error');
      toast.error(msg);
    },
  });
  const updateCustomer = useUpdateCustomer({
    onSuccess: () => {
      toast.success(t('customers_admin.toast_updated'));
      setModalOpen(false);
      form.resetFields();
      setEditTarget(null);
    },
    onError: (err) => {
      const detail = (err as { response?: { data?: Record<string, string[]> } }).response?.data;
      const msg = detail?.name?.[0] ?? t('customers_admin.toast_error');
      toast.error(msg);
    },
  });
  const deleteCustomer = useDeleteCustomer({
    onSuccess: () => toast.success(t('customers_admin.toast_deleted')),
    onError: () => toast.error(t('customers_admin.toast_error')),
  });

  function handleCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  }

  function handleEdit(record: ICustomer) {
    setEditTarget(record);
    form.setFieldsValue({
      name: record.name,
      phone: record.phone,
      default_country: record.default_country,
      default_city: record.default_city,
      import_firms: record.import_firms,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleSubmit(values: CustomerFormValues) {
    if (editTarget) {
      updateCustomer.mutate({ id: editTarget.id, ...values });
    } else {
      createCustomer.mutate(values);
    }
  }

  function handleDelete(id: number) {
    Modal.confirm({
      title: t('customers_admin.confirm_delete'),
      onOk: () => deleteCustomer.mutate(id),
    });
  }

  const countryOptions = countries.map((c) => ({
    value: c.id,
    label: c.name_en || c.name_tk,
  }));

  const cityOptions = cities.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const importFirmOptions = importFirms.map((f) => ({
    value: f.id,
    label: f.name_short || f.name_company,
  }));

  const filteredCustomers = searchText
    ? customers.filter((c) => {
        const q = searchText.toLowerCase();
        return c.name.toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q);
      })
    : customers;

  const columns: ProColumns<ICustomer>[] = [
    {
      title: t('customers_admin.name'),
      dataIndex: 'name',
      search: false,
      sorter: (a, b) => a.name.localeCompare(b.name),
      defaultSortOrder: 'ascend',
      render: (_, record) => <strong>{record.name}</strong>,
    },
    {
      title: t('customers_admin.phone'),
      dataIndex: 'phone',
      search: false,
      render: (_, record) => record.phone || <Text type="secondary">—</Text>,
    },
    {
      title: t('customers_admin.country'),
      dataIndex: 'country_name',
      search: false,
      sorter: (a, b) => (a.country_name || '').localeCompare(b.country_name || ''),
      render: (_, record) => record.country_name || <Text type="secondary">—</Text>,
    },
    {
      title: t('customers_admin.import_firms'),
      dataIndex: 'import_firm_names',
      search: false,
      render: (_, record) => {
        const firms = record.import_firm_names;
        if (!firms || firms.length === 0) return <Text type="secondary">—</Text>;
        const shown = firms.slice(0, 3);
        const extra = firms.length - 3;
        return (
          <Space size={4} wrap>
            {shown.map((f) => <Tag key={f.id}>{f.name}</Tag>)}
            {extra > 0 && <Tag>+{extra}</Tag>}
          </Space>
        );
      },
    },
    {
      title: t('customers_admin.status'),
      dataIndex: 'is_active',
      width: 100,
      search: false,
      sorter: (a, b) => {
        const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      },
      render: (_, record) => (
        <Tag color={record.is_active ? 'green' : 'default'}>
          {record.is_active ? t('common.active') : t('common.inactive')}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      search: false,
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
        </Space>
      ),
    },
  ];

  if (isError) return <Alert message={t('customers_admin.error_load')} type="error" style={{ marginTop: 40 }} />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('customers_admin.title')}</Title>
        <Text type="secondary">{t('customers_admin.subtitle')}</Text>
      </div>

      <ProTable<ICustomer>
        rowKey="id"
        dataSource={filteredCustomers}
        columns={columns}
        loading={isLoading}
        search={false}
        options={{ search: true }}
        onRequestError={() => {}}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        size="small"
        scroll={{ x: 'max-content' }}
        toolbar={{ search: { onSearch: (v) => setSearchText(v), placeholder: t('common.search') } }}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {t('customers_admin.add')}
          </Button>,
        ]}
      />

      <Modal
        title={editTarget ? t('customers_admin.edit') : t('customers_admin.add')}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditTarget(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createCustomer.isPending || updateCustomer.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label={t('customers_admin.name')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="phone" label={t('customers_admin.phone')}>
            <Input />
          </Form.Item>
          <Form.Item name="default_country" label={t('customers_admin.country')}>
            <Select
              options={countryOptions}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('customers_admin.country_placeholder')}
              onChange={() => form.setFieldValue('default_city', undefined)}
            />
          </Form.Item>
          <Form.Item name="default_city" label={t('customers_admin.city')}>
            <Select
              options={cityOptions}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('customers_admin.city_placeholder')}
              disabled={!watchedCountry}
            />
          </Form.Item>
          <Form.Item name="import_firms" label={t('customers_admin.import_firms')}>
            <Select
              mode="multiple"
              options={importFirmOptions}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('customers_admin.import_firms_placeholder')}
            />
          </Form.Item>
          {editTarget && (
            <Form.Item name="is_active" label={t('customers_admin.status')} valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
