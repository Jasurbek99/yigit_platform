import { useState } from 'react';
import { Alert, Button, Modal, Form, AutoComplete, Switch, Tag, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useProcessNodeLinks, useUpdateProcessNodeLink } from '@/hooks/useAdmin';
import { getKnownAppRoutes } from '@/utils/permissions';
import type { IProcessNodeLink } from '@/types';

const { Title, Text } = Typography;

interface IEditFormValues {
  route: string;
  is_active: boolean;
}

// Mirrors the server-side RegexValidator on ProcessNodeLink.route
// (backend/apps/export/models/process_node_link.py) so a value the client
// accepts is never rejected by the API with a confusing 400. `route` is
// written into a diagram <a href> the boss clicks — kept to an in-app
// absolute path only (no scheme, no protocol-relative `//`) to close a
// stored-XSS vector.
const ROUTE_PATTERN = /^\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/;

export default function ProcessNodeLinksPage() {
  const { t } = useTranslation();
  const { data: links = [], isLoading, isError } = useProcessNodeLinks();
  const updateLink = useUpdateProcessNodeLink({
    onSuccess: () => {
      toast.success(t('process_node_links_admin.toast_updated'));
      setEditTarget(null);
      form.resetFields();
    },
  });

  const [editTarget, setEditTarget] = useState<IProcessNodeLink | null>(null);
  const [form] = Form.useForm<IEditFormValues>();

  const routeOptions = getKnownAppRoutes().map((route) => ({ value: route }));

  function handleEdit(record: IProcessNodeLink) {
    setEditTarget(record);
    form.setFieldsValue({ route: record.route, is_active: record.is_active });
  }

  function handleSubmit(values: IEditFormValues) {
    if (!editTarget) return;
    updateLink.mutate({ id: editTarget.id, route: values.route.trim(), is_active: values.is_active });
  }

  function handleValidateRoute(_: unknown, value: string): Promise<void> {
    if (!value || ROUTE_PATTERN.test(value)) return Promise.resolve();
    return Promise.reject(new Error(t('process_node_links_admin.route_invalid')));
  }

  const columns: ProColumns<IProcessNodeLink>[] = [
    {
      title: t('process_node_links_admin.col_node_id'),
      dataIndex: 'node_id',
      key: 'node_id',
      render: (_: unknown, record: IProcessNodeLink) => <Text code>{record.node_id}</Text>,
      sorter: (a: IProcessNodeLink, b: IProcessNodeLink) => a.node_id.localeCompare(b.node_id),
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: t('process_node_links_admin.col_label'),
      dataIndex: 'label',
      key: 'label',
    },
    {
      title: t('process_node_links_admin.col_route'),
      dataIndex: 'route',
      key: 'route',
      render: (_: unknown, record: IProcessNodeLink) =>
        record.route || <Text type="secondary">{t('common.empty')}</Text>,
    },
    {
      title: t('process_node_links_admin.col_status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 110,
      render: (_: unknown, record: IProcessNodeLink) => (
        <Tag color={record.is_active ? 'green' : 'default'}>
          {record.is_active ? t('common.active') : t('common.inactive')}
        </Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: IProcessNodeLink) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
      ),
    },
  ];

  if (isError) {
    return (
      <Alert
        message={t('process_node_links_admin.error_load')}
        type="error"
        style={{ marginTop: 40 }}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('process_node_links_admin.title')}</Title>
        <Text type="secondary">{t('process_node_links_admin.subtitle')}</Text>
      </div>

      <ProTable<IProcessNodeLink>
        rowKey="id"
        columns={columns}
        dataSource={links}
        loading={isLoading}
        search={false}
        options={{ search: false }}
        onRequestError={() => {}}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={t('process_node_links_admin.edit_title', { node: editTarget?.node_id })}
        open={editTarget !== null}
        onCancel={() => { setEditTarget(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={updateLink.isPending}
        destroyOnHidden
      >
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">{t('process_node_links_admin.col_label')}: </Text>
          <Text>{editTarget?.label}</Text>
        </div>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="route"
            label={t('process_node_links_admin.col_route')}
            rules={[{ validator: handleValidateRoute }]}
            extra={t('process_node_links_admin.route_hint')}
          >
            <AutoComplete
              options={routeOptions}
              filterOption={(inputValue, option) =>
                (option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())
              }
              placeholder={t('process_node_links_admin.route_placeholder')}
            />
          </Form.Item>
          <Form.Item name="is_active" label={t('process_node_links_admin.col_status')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
