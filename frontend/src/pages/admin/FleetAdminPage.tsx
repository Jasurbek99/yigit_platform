import { useState } from 'react';
import {
  Tabs,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Space,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useAdminTruckHeads,
  useAdminTrailers,
  useUpdateTruckHead,
  useUpdateTrailer,
  useAdminCreateTruckHead,
  useAdminCreateTrailer,
} from '@/hooks/useFleetAdmin';
import type { ITruckHead, ITrailer } from '@/hooks/useFleet';

const { Title, Text } = Typography;

// The list endpoint (see backend TruckHeadSerializer) also returns
// owner_name/capacity/is_active, which aren't on the shared ITruckHead type
// (that type is scoped to what the shipment-truck selector needs). Extend
// locally rather than widening the shared hook's type.
interface IAdminTruckHead extends ITruckHead {
  owner_name?: string | null;
  capacity?: number | string | null;
  is_active: boolean;
}

interface ITruckFormValues {
  plate_number: string;
  owner_type?: string;
  owner_name?: string;
  capacity?: number | null;
  is_active?: boolean;
}

interface ITrailerFormValues {
  plate_number: string;
  owner_type?: string;
  is_active?: boolean;
}

export default function FleetAdminPage() {
  const { t } = useTranslation();

  // ── Trucks ──────────────────────────────────────────────────────────
  const { data: trucksRaw = [], isLoading: trucksLoading } = useAdminTruckHeads();
  const trucks = trucksRaw as IAdminTruckHead[];
  const createTruck = useAdminCreateTruckHead();
  const updateTruck = useUpdateTruckHead();

  const [truckModalOpen, setTruckModalOpen] = useState(false);
  const [editTruck, setEditTruck] = useState<IAdminTruckHead | null>(null);
  const [truckForm] = Form.useForm<ITruckFormValues>();

  function openCreateTruck() {
    setEditTruck(null);
    truckForm.resetFields();
    truckForm.setFieldsValue({ is_active: true });
    setTruckModalOpen(true);
  }

  function openEditTruck(record: IAdminTruckHead) {
    setEditTruck(record);
    truckForm.setFieldsValue({
      plate_number: record.plate_number,
      owner_type: record.owner_type,
      owner_name: record.owner_name ?? undefined,
      capacity: record.capacity != null && record.capacity !== '' ? Number(record.capacity) : undefined,
      is_active: record.is_active,
    });
    setTruckModalOpen(true);
  }

  function closeTruckModal() {
    setTruckModalOpen(false);
    setEditTruck(null);
    truckForm.resetFields();
  }

  async function handleTruckSubmit(values: ITruckFormValues) {
    try {
      if (editTruck) {
        await updateTruck.mutateAsync({
          id: editTruck.id,
          plate_number: values.plate_number.toUpperCase(),
          owner_type: values.owner_type ?? '',
          owner_name: values.owner_name ?? '',
          capacity: values.capacity ?? null,
          is_active: values.is_active ?? true,
        });
        toast.success(t('fleet_admin.toast_updated'));
      } else {
        await createTruck.mutateAsync({
          plate_number: values.plate_number.toUpperCase(),
          owner_type: values.owner_type ?? '',
          owner_name: values.owner_name ?? '',
          capacity: values.capacity ?? null,
          is_active: values.is_active ?? true,
        });
        toast.success(t('fleet_admin.toast_created'));
      }
      closeTruckModal();
    } catch {
      toast.error(t('fleet_admin.toast_error'));
    }
  }

  function toggleTruckActive(record: IAdminTruckHead) {
    updateTruck.mutate(
      { id: record.id, is_active: !record.is_active },
      {
        onSuccess: () =>
          toast.success(record.is_active ? t('fleet_admin.toast_deactivated') : t('fleet_admin.toast_activated')),
        onError: () => toast.error(t('fleet_admin.toast_error')),
      },
    );
  }

  const truckColumns = [
    { title: t('fleet_admin.plate_number'), dataIndex: 'plate_number', key: 'plate_number' },
    {
      title: t('fleet_admin.owner_type'),
      dataIndex: 'owner_type',
      key: 'owner_type',
      render: (v?: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: t('fleet_admin.field_owner_name'),
      dataIndex: 'owner_name',
      key: 'owner_name',
      render: (v?: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: t('fleet_admin.capacity'),
      dataIndex: 'capacity',
      key: 'capacity',
      render: (v?: number | string | null) => (v != null && v !== '' ? v : <Text type="secondary">—</Text>),
    },
    {
      title: t('fleet_admin.gps'),
      dataIndex: 'has_gps',
      key: 'has_gps',
      render: (hasGps: boolean) => (
        <Tag color={hasGps ? 'green' : 'default'}>{hasGps ? t('fleet_admin.gps_yes') : t('fleet_admin.gps_no')}</Tag>
      ),
    },
    {
      title: t('fleet_admin.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? t('common.active') : t('common.inactive')}</Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, record: IAdminTruckHead) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditTruck(record)}>
            {t('fleet_admin.edit')}
          </Button>
          <Button size="small" danger={record.is_active} onClick={() => toggleTruckActive(record)}>
            {record.is_active ? t('fleet_admin.deactivate') : t('fleet_admin.activate')}
          </Button>
        </Space>
      ),
    },
  ];

  const trucksTab = (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateTruck}>
          {t('fleet_admin.add_truck')}
        </Button>
      </div>
      <Table
        columns={truckColumns}
        dataSource={trucks}
        rowKey="id"
        loading={trucksLoading}
        pagination={false}
        size="small"
        bordered
        scroll={{ x: 'max-content' }}
      />
      <Modal
        title={editTruck ? t('fleet_admin.edit_truck') : t('fleet_admin.add_truck')}
        open={truckModalOpen}
        onCancel={closeTruckModal}
        onOk={() => truckForm.submit()}
        confirmLoading={createTruck.isPending || updateTruck.isPending}
        destroyOnHidden
      >
        <Form form={truckForm} layout="vertical" onFinish={handleTruckSubmit}>
          <Form.Item
            name="plate_number"
            label={t('fleet_admin.plate_number')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="owner_type" label={t('fleet_admin.owner_type')}>
            <Input />
          </Form.Item>
          <Form.Item name="owner_name" label={t('fleet_admin.field_owner_name')}>
            <Input />
          </Form.Item>
          <Form.Item name="capacity" label={t('fleet_admin.capacity')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="is_active" label={t('fleet_admin.status')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );

  // ── Trailers ────────────────────────────────────────────────────────
  const { data: trailers = [], isLoading: trailersLoading } = useAdminTrailers();
  const createTrailer = useAdminCreateTrailer();
  const updateTrailer = useUpdateTrailer();

  const [trailerModalOpen, setTrailerModalOpen] = useState(false);
  const [editTrailer, setEditTrailer] = useState<ITrailer | null>(null);
  const [trailerForm] = Form.useForm<ITrailerFormValues>();

  function openCreateTrailer() {
    setEditTrailer(null);
    trailerForm.resetFields();
    trailerForm.setFieldsValue({ is_active: true });
    setTrailerModalOpen(true);
  }

  function openEditTrailer(record: ITrailer) {
    setEditTrailer(record);
    trailerForm.setFieldsValue({
      plate_number: record.plate_number,
      owner_type: record.owner_type,
      is_active: record.is_active,
    });
    setTrailerModalOpen(true);
  }

  function closeTrailerModal() {
    setTrailerModalOpen(false);
    setEditTrailer(null);
    trailerForm.resetFields();
  }

  async function handleTrailerSubmit(values: ITrailerFormValues) {
    try {
      if (editTrailer) {
        await updateTrailer.mutateAsync({
          id: editTrailer.id,
          plate_number: values.plate_number.toUpperCase(),
          owner_type: values.owner_type ?? '',
          is_active: values.is_active ?? true,
        });
        toast.success(t('fleet_admin.toast_updated'));
      } else {
        await createTrailer.mutateAsync({
          plate_number: values.plate_number.toUpperCase(),
          owner_type: values.owner_type ?? '',
          is_active: values.is_active ?? true,
        });
        toast.success(t('fleet_admin.toast_created'));
      }
      closeTrailerModal();
    } catch {
      toast.error(t('fleet_admin.toast_error'));
    }
  }

  function toggleTrailerActive(record: ITrailer) {
    updateTrailer.mutate(
      { id: record.id, is_active: !record.is_active },
      {
        onSuccess: () =>
          toast.success(record.is_active ? t('fleet_admin.toast_deactivated') : t('fleet_admin.toast_activated')),
        onError: () => toast.error(t('fleet_admin.toast_error')),
      },
    );
  }

  const trailerColumns = [
    { title: t('fleet_admin.plate_number'), dataIndex: 'plate_number', key: 'plate_number' },
    {
      title: t('fleet_admin.owner_type'),
      dataIndex: 'owner_type',
      key: 'owner_type',
      render: (v?: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: t('fleet_admin.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? t('common.active') : t('common.inactive')}</Tag>
      ),
    },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, record: ITrailer) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditTrailer(record)}>
            {t('fleet_admin.edit')}
          </Button>
          <Button size="small" danger={record.is_active} onClick={() => toggleTrailerActive(record)}>
            {record.is_active ? t('fleet_admin.deactivate') : t('fleet_admin.activate')}
          </Button>
        </Space>
      ),
    },
  ];

  const trailersTab = (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateTrailer}>
          {t('fleet_admin.add_trailer')}
        </Button>
      </div>
      <Table
        columns={trailerColumns}
        dataSource={trailers}
        rowKey="id"
        loading={trailersLoading}
        pagination={false}
        size="small"
        bordered
        scroll={{ x: 'max-content' }}
      />
      <Modal
        title={editTrailer ? t('fleet_admin.edit_trailer') : t('fleet_admin.add_trailer')}
        open={trailerModalOpen}
        onCancel={closeTrailerModal}
        onOk={() => trailerForm.submit()}
        confirmLoading={createTrailer.isPending || updateTrailer.isPending}
        destroyOnHidden
      >
        <Form form={trailerForm} layout="vertical" onFinish={handleTrailerSubmit}>
          <Form.Item
            name="plate_number"
            label={t('fleet_admin.plate_number')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="owner_type" label={t('fleet_admin.owner_type')}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label={t('fleet_admin.status')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>{t('fleet_admin.title')}</Title>
        <Text type="secondary">{t('fleet_admin.subtitle')}</Text>
      </div>
      <Tabs
        items={[
          { key: 'trucks', label: t('fleet_admin.tab_trucks'), children: trucksTab },
          { key: 'trailers', label: t('fleet_admin.tab_trailers'), children: trailersTab },
        ]}
      />
    </div>
  );
}
