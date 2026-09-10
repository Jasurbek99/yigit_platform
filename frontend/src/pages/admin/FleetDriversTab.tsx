import { useState, useMemo } from 'react';
import { Button, DatePicker, Form, Input, Modal, Space, Switch, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useAdminDrivers,
  useAdminCreateDriver,
  useUpdateDriver,
  useDriverDocuments,
  useUploadDriverDocuments,
  useDeleteDriverDocument,
  driverDocumentUrl,
} from '@/hooks/useFleetAdmin';
import type { IDriver } from '@/hooks/useFleetAdmin';
import {
  FleetDocumentsPanel,
  PendingDocumentsPicker,
} from '@/components/fleet/FleetDocumentsPanel';
import type { IFleetDocumentLabels } from '@/components/fleet/FleetDocumentsPanel';

const { Text } = Typography;

interface IDriverFormValues {
  name: string;
  phone?: string;
  passport_serial?: string;
  passport_issue_date?: Dayjs | null;
  is_active?: boolean;
}

const DATE_FORMAT = 'YYYY-MM-DD';


/**
 * Passport scans for one saved driver. Rendered inside the edit modal only — a
 * file has to hang off an existing driver row, so there is no id to upload
 * against while the modal is still creating one.
 */
function DriverDocumentsPanel({ driverId, labels }: { driverId: number; labels: IFleetDocumentLabels }) {
  const { t } = useTranslation();
  const { data: documents = [], isLoading } = useDriverDocuments(driverId);
  const upload = useUploadDriverDocuments();
  const remove = useDeleteDriverDocument(driverId);

  async function handleUpload(files: File[]) {
    try {
      await upload.mutateAsync({ driverId, files });
      toast.success(t('fleet_admin.toast_document_uploaded'));
    } catch {
      toast.error(t('fleet_admin.toast_document_rejected'));
    }
  }

  async function handleRemove(documentId: number) {
    try {
      await remove.mutateAsync(documentId);
      toast.success(t('fleet_admin.toast_document_deleted'));
    } catch {
      toast.error(t('fleet_admin.toast_error'));
    }
  }

  return (
    <FleetDocumentsPanel
      labels={labels}
      documents={documents}
      isLoading={isLoading}
      isUploading={upload.isPending}
      documentUrl={(documentId) => driverDocumentUrl(driverId, documentId)}
      onUpload={handleUpload}
      onRemove={handleRemove}
    />
  );
}

export default function FleetDriversTab() {
  const { t } = useTranslation();
  const documentLabels: IFleetDocumentLabels = {
    title: t('fleet_admin.passport_documents'),
    emptyText: t('fleet_admin.passport_documents_empty'),
    uploadLabel: t('fleet_admin.upload_passport'),
    hint: t('fleet_admin.passport_upload_hint'),
  };
  const { data: drivers = [], isLoading } = useAdminDrivers();
  const createDriver = useAdminCreateDriver();
  const updateDriver = useUpdateDriver();

  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IDriver | null>(null);
  const [form] = Form.useForm<IDriverFormValues>();
  // Scans chosen in the ADD dialog, held here until the driver row exists.
  // `DriverDocumentsPanel` uploads immediately because it always has an id.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const uploadDocuments = useUploadDriverDocuments();

  // 152 rows arrive in one unpaginated payload, so filtering client-side beats
  // a round trip per keystroke.
  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.phone ?? '').toLowerCase().includes(q) ||
        (d.passport_serial ?? '').toLowerCase().includes(q) ||
        d.driver_logo_code.toLowerCase().includes(q),
    );
  }, [drivers, keyword]);

  function handleOpenCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setPendingFiles([]);
    setModalOpen(true);
  }

  function handleOpenEdit(record: IDriver) {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      phone: record.phone ?? undefined,
      passport_serial: record.passport_serial ?? undefined,
      passport_issue_date: record.passport_issue_date
        ? dayjs(record.passport_issue_date)
        : null,
      is_active: record.is_active,
    });
    setModalOpen(true);
  }

  function handleClose() {
    setModalOpen(false);
    setEditing(null);
    setPendingFiles([]);
    form.resetFields();
  }

  async function handleSubmit(values: IDriverFormValues) {
    // Send null, not '', for a cleared phone — the column is nullable and the
    // import treats NULL as "no phone known" (see _import_drivers).
    const payload = {
      name: values.name.trim(),
      phone: values.phone?.trim() || null,
      passport_serial: values.passport_serial?.trim() ?? '',
      // Date only, no time — the column is a DateField and the picker's local
      // midnight would shift the day under a UTC serialisation.
      passport_issue_date: values.passport_issue_date
        ? values.passport_issue_date.format(DATE_FORMAT)
        : null,
      is_active: values.is_active ?? true,
    };
    try {
      if (editing) {
        await updateDriver.mutateAsync({ id: editing.id, ...payload });
        toast.success(t('fleet_admin.toast_driver_updated'));
      } else {
        const created = await createDriver.mutateAsync(payload);
        toast.success(t('fleet_admin.toast_driver_created'));
        // The driver row is saved either way, so a rejected scan must not read
        // as "the driver was not created". It is reported on its own line and
        // the operator re-attaches it from the edit dialog.
        if (pendingFiles.length > 0) {
          try {
            await uploadDocuments.mutateAsync({ driverId: created.id, files: pendingFiles });
            toast.success(t('fleet_admin.toast_document_uploaded'));
          } catch {
            toast.error(t('fleet_admin.toast_document_rejected'));
          }
        }
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
      title: t('fleet_admin.passport_serial'),
      dataIndex: 'passport_serial',
      key: 'passport_serial',
      render: (_, record) => record.passport_serial || <Text type="secondary">—</Text>,
    },
    {
      title: t('fleet_admin.passport_documents'),
      dataIndex: 'document_count',
      key: 'document_count',
      render: (_, record) =>
        record.document_count ? (
          <Tag color="blue">{record.document_count}</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
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
          <Form.Item
            name="passport_serial"
            label={t('fleet_admin.passport_serial')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input placeholder={t('fleet_admin.passport_serial_placeholder')} />
          </Form.Item>
          <Form.Item
            name="passport_issue_date"
            label={t('fleet_admin.passport_issue_date')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <DatePicker style={{ width: '100%' }} format={DATE_FORMAT} />
          </Form.Item>
          <Form.Item name="is_active" label={t('fleet_admin.status')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
        {editing ? (
          <DriverDocumentsPanel driverId={editing.id} labels={documentLabels} />
        ) : (
          <PendingDocumentsPicker
            labels={{
              ...documentLabels,
              hint: t('fleet_admin.passport_upload_pending_hint'),
            }}
            files={pendingFiles}
            onChange={setPendingFiles}
          />
        )}
      </Modal>
    </div>
  );
}
