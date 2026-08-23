import { useState, useMemo } from 'react';
import { Button, Modal, Form, Input, Switch, Space, Tag, Typography } from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAdminDrivers, useAdminCreateDriver, useUpdateDriver } from '@/hooks/useFleetAdmin';
import type { IDriver } from '@/hooks/useFleetAdmin';

const { Text } = Typography;

interface IDriverFormValues {
  name: string;
  phone?: string;
  is_active?: boolean;
}

export default function FleetDriversTab() {
  const { t } = useTranslation();
  const { data: drivers = [], isLoading } = useAdminDrivers();
  const createDriver = useAdminCreateDriver();
  const updateDriver = useUpdateDriver();

  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IDriver | null>(null);
  const [form] = Form.useForm<IDriverFormValues>();

  // 152 rows arrive in one unpaginated payload, so filtering client-side beats
  // a round trip per keystroke.
  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.phone ?? '').toLowerCase().includes(q) ||
        d.driver_logo_code.toLowerCase().includes(q),
    );
  }, [drivers, keyword]);

  function handleOpenCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setModalOpen(true);
  }

  function handleOpenEdit(record: IDriver) {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      phone: record.phone ?? undefined,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleClose() {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  }

  async function handleSubmit(values: IDriverFormValues) {
    // Send null, not '', for a cleared phone — the column is nullable and the
    // import treats NULL as "no phone known" (see _import_drivers).
    const payload = {
      name: values.name.trim(),
      phone: values.phone?.trim() || null,
      is_active: values.is_active ?? true,
    };
    try {
      if (editing) {
        await updateDriver.mutateAsync({ id: editing.id, ...payload });
        toast.success(t('fleet_admin.toast_driver_updated'));
      } else {
        await createDriver.mutateAsync(payload);
        toast.success(t('fleet_admin.toast_driver_created'));
      }
      handleClose();
    } catch {
      toast.error(t('fleet_admin.toast_error'));
    }
  }

  function handleToggleActive(record: IDriver) {
    updateDriver.mutate(
      { id: record.id, is_active: !record.is_active },
      {
        onSuccess: () =>
          toast.success(
            record.is_active
              ? t('fleet_admin.toast_driver_deactivated')
              : t('fleet_admin.toast_driver_activated'),
          ),
        onError: () => toast.error(t('fleet_admin.toast_error')),
      },
    );
  }

  const columns: ProColumns<IDriver>[] = [
    {
      title: t('fleet_admin.driver_name'),
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: t('fleet_admin.driver_phone'),
      dataIndex: 'phone',
      key: 'phone',
      render: (_, record) => record.phone || <Text type="secondary">—</Text>,
    },
    {
      // Read-only: the import owns it. Shown because two drivers can share a
      // name (ids 30/31 are both BATYROW BAYRAMMYRAT) and only this tells them
      // apart — it is also the key the duplicate retirement runs on.
      title: t('fleet_admin.driver_logo_code'),
      dataIndex: 'driver_logo_code',
      key: 'driver_logo_code',
      sorter: (a, b) => a.driver_logo_code.localeCompare(b.driver_logo_code),
      render: (_, record) =>
        record.driver_logo_code ? (
          <Text code>{record.driver_logo_code}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: t('fleet_admin.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      defaultSortOrder: 'descend',
      sorter: (a, b) => {
        const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
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
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleOpenEdit(record)}>
            {t('fleet_admin.edit')}
          </Button>
          <Button size="small" danger={record.is_active} onClick={() => handleToggleActive(record)}>
            {record.is_active ? t('fleet_admin.deactivate') : t('fleet_admin.activate')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <ProTable<IDriver>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        size="small"
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('fleet_admin.drivers_empty') }}
        toolBarRender={() => [
          <Input.Search
            key="search"
            allowClear
            placeholder={t('fleet_admin.driver_search_placeholder')}
            style={{ width: 220 }}
            onChange={(e) => setKeyword(e.target.value)}
          />,
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
            {t('fleet_admin.add_driver')}
          </Button>,
        ]}
      />
      <Modal
        title={editing ? t('fleet_admin.edit_driver') : t('fleet_admin.add_driver')}
        open={modalOpen}
        onCancel={handleClose}
        onOk={() => form.submit()}
        // AntD only ships ru_RU / en_US here (App.tsx falls back to en_US for
        // Turkmen), so the footer would read "OK"/"Cancel" in a tk session.
        // Drive it from our own i18n instead.
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={createDriver.isPending || updateDriver.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label={t('fleet_admin.driver_name')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="phone" label={t('fleet_admin.driver_phone')}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label={t('fleet_admin.status')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
