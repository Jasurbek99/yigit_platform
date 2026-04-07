import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
  DatePicker,
  Space,
  Typography,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { IconBuildingWarehouse, IconPlus, IconEdit } from '@tabler/icons-react';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  useAdminBlocks,
  useCreateBlock,
  useUpdateBlock,
  useAdminUsers,
  useLoadingLocations,
  useTomatoVarieties,
} from '@/hooks/useAdmin';
import type { IGreenhouseBlock } from '@/types';

const { Text } = Typography;

interface BlockFormValues {
  code: string;
  name: string | null;
  manager: number | null;
  variety_main: number | null;
  variety_secondary: number | null;
  area_m2: number | null;
  location: number | null;
  section_count: number | null;
  sowing_date: string | null;
  season_start_month: number | null;
  is_active: boolean;
}

export default function BlocksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IGreenhouseBlock | null>(null);
  const [form] = Form.useForm<BlockFormValues>();

  const { data: blocks = [], isLoading } = useAdminBlocks();
  const { data: allUsers = [] } = useAdminUsers();
  const { data: locations = [] } = useLoadingLocations();
  const { data: varieties = [] } = useTomatoVarieties();

  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: `${i + 1} — ${t(`months.${i + 1}`)}`,
  }));

  const greenhouseManagers = allUsers
    .filter((u) => u.role === 'greenhouse_manager' && u.is_active)
    .map((u) => ({
      value: u.id,
      label: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username,
    }));

  const locationOptions = locations.map((l) => ({ value: l.id, label: l.name }));
  const varietyOptions = varieties.map((v) => ({ value: v.id, label: v.name }));

  const createBlock = useCreateBlock({
    onSuccess: () => { toast.success(t('blocks_admin.toast_created')); setDrawerOpen(false); form.resetFields(); },
    onError: () => toast.error(t('blocks_admin.toast_error')),
  });

  const updateBlock = useUpdateBlock({
    onSuccess: () => { toast.success(t('blocks_admin.toast_updated')); setDrawerOpen(false); form.resetFields(); },
    onError: () => toast.error(t('blocks_admin.toast_error')),
  });

  function handleOpenCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setDrawerOpen(true);
  }

  function handleOpenEdit(record: IGreenhouseBlock) {
    setEditTarget(record);
    form.setFieldsValue({
      code: record.code,
      name: record.name,
      manager: record.manager,
      variety_main: record.variety_main,
      variety_secondary: record.variety_secondary,
      area_m2: record.area_m2,
      location: record.location,
      section_count: record.section_count,
      sowing_date: record.sowing_date,
      season_start_month: record.season_start_month,
      is_active: record.is_active,
    });
    setDrawerOpen(true);
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    const payload: Omit<IGreenhouseBlock, 'id' | 'manager_name' | 'variety_main_name' | 'variety_secondary_name' | 'location_name'> = {
      code: values.code,
      name: values.name || null,
      parent: null,
      parent_code: null,
      manager: values.manager ?? null,
      variety_main: values.variety_main ?? null,
      variety_secondary: values.variety_secondary ?? null,
      area_m2: values.area_m2 ?? null,
      location: values.location ?? null,
      section_count: values.section_count ?? null,
      sowing_date: values.sowing_date || null,
      season_start_month: values.season_start_month ?? null,
      is_active: values.is_active ?? true,
      sub_blocks: [],
    };
    if (editTarget) {
      updateBlock.mutate({ id: editTarget.id, ...payload });
    } else {
      createBlock.mutate(payload as Omit<IGreenhouseBlock, 'id' | 'manager_name'>);
    }
  }

  const columns: ProColumns<IGreenhouseBlock>[] = [
    {
      title: t('blocks_admin.col_code'),
      dataIndex: 'code',
      width: 70,
      defaultSortOrder: 'ascend' as const,
      sorter: (a: IGreenhouseBlock, b: IGreenhouseBlock) => a.code.localeCompare(b.code),
      render: (_, record) => <Text strong>{record.code}</Text>,
    },
    {
      title: t('blocks_admin.col_name'),
      dataIndex: 'name',
      sorter: (a: IGreenhouseBlock, b: IGreenhouseBlock) => (a.name || '').localeCompare(b.name || ''),
      render: (_, record) => record.name || <Text type="secondary">—</Text>,
    },
    {
      title: t('blocks_admin.col_location'),
      dataIndex: 'location_name',
      width: 120,
      sorter: (a: IGreenhouseBlock, b: IGreenhouseBlock) => (a.location_name || '').localeCompare(b.location_name || ''),
      render: (_, record) => record.location_name || <Text type="secondary">—</Text>,
    },
    {
      title: t('blocks_admin.col_manager'),
      dataIndex: 'manager_name',
      sorter: (a: IGreenhouseBlock, b: IGreenhouseBlock) => (a.manager_name || '').localeCompare(b.manager_name || ''),
      render: (_, record) => record.manager_name || <Text type="secondary">—</Text>,
    },
    {
      title: t('blocks_admin.col_varieties'),
      render: (_, record) => {
        const parts = [record.variety_main_name, record.variety_secondary_name].filter(Boolean);
        return parts.length ? parts.join(' / ') : <Text type="secondary">—</Text>;
      },
    },
    {
      title: t('blocks_admin.col_area'),
      dataIndex: 'area_m2',
      width: 110,
      sorter: (a: IGreenhouseBlock, b: IGreenhouseBlock) => (a.area_m2 ?? 0) - (b.area_m2 ?? 0),
      render: (_, record) =>
        record.area_m2 != null ? record.area_m2.toLocaleString() : <Text type="secondary">—</Text>,
    },
    {
      title: t('blocks_admin.col_status'),
      dataIndex: 'is_active',
      width: 90,
      sorter: (a: IGreenhouseBlock, b: IGreenhouseBlock) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0),
      render: (_, record) =>
        record.is_active ? (
          <Tag color="green">{t('common.active')}</Tag>
        ) : (
          <Tag color="default">{t('common.inactive')}</Tag>
        ),
    },
    {
      title: '',
      width: 60,
      render: (_, record) => (
        <Button
          type="text"
          size="small"
          icon={<IconEdit size={14} />}
          onClick={() => handleOpenEdit(record)}
        />
      ),
    },
  ];

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: '#1f1f1f',
            lineHeight: '1.3',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <IconBuildingWarehouse size={18} color="#1677ff" />
          {t('blocks_admin.title')}
        </div>
        <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
          {t('blocks_admin.subtitle')}
        </div>
      </div>

      <ProTable<IGreenhouseBlock>
        rowKey="id"
        onRow={(record) => ({
          onClick: () => navigate(`/admin/blocks/${record.id}`),
          style: { cursor: 'pointer' },
        })}
        dataSource={blocks}
        columns={columns}
        loading={isLoading}
        search={false}
        options={false}
        pagination={false}
        size="small"
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<IconPlus size={14} />}
            onClick={handleOpenCreate}
          >
            {t('blocks_admin.add')}
          </Button>,
        ]}
      />

      {/* Create / Edit Drawer */}
      <Drawer
        title={editTarget ? t('blocks_admin.drawer_edit', { code: editTarget.code }) : t('blocks_admin.drawer_create')}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); form.resetFields(); }}
        width={420}
        maskClosable={false}
        extra={
          <Space>
            <Button onClick={() => { setDrawerOpen(false); form.resetFields(); }}>
              {t('common.cancel')}
            </Button>
            <Button
              type="primary"
              loading={createBlock.isPending || updateBlock.isPending}
              onClick={handleSubmit}
            >
              {t('common.save')}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" size="middle">
          <Form.Item
            name="code"
            label={t('blocks_admin.field_code')}
            rules={[
              { required: true, message: t('blocks_admin.field_code_required') },
              { max: 10, message: t('blocks_admin.field_code_max') },
            ]}
          >
            <Input placeholder={t('blocks_admin.field_code_ph')} maxLength={10} />
          </Form.Item>

          <Form.Item name="name" label={t('blocks_admin.field_name')}>
            <Input placeholder={t('blocks_admin.field_name_ph')} />
          </Form.Item>

          <Form.Item name="location" label={t('blocks_admin.field_location')}>
            <Select
              allowClear
              placeholder={t('blocks_admin.field_location_ph')}
              options={locationOptions}
            />
          </Form.Item>

          <Form.Item name="manager" label={t('blocks_admin.field_manager')}>
            <Select
              allowClear
              placeholder={t('blocks_admin.field_manager_ph')}
              options={greenhouseManagers}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item name="variety_main" label={t('blocks_admin.field_variety_main')}>
            <Select
              allowClear
              placeholder={t('blocks_admin.field_variety_ph')}
              options={varietyOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item name="variety_secondary" label={t('blocks_admin.field_variety_secondary')}>
            <Select
              allowClear
              placeholder={t('blocks_admin.field_variety_sec_ph')}
              options={varietyOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item name="area_m2" label={t('blocks_admin.field_area')}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
          </Form.Item>

          <Form.Item name="section_count" label={t('blocks_admin.field_sections')}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
          </Form.Item>

          <Form.Item
            name="sowing_date"
            label={t('blocks_admin.field_sowing_date')}
            getValueFromEvent={(date: dayjs.Dayjs | null) => date ? date.format('YYYY-MM-DD') : null}
            getValueProps={(value: string | null) => ({ value: value ? dayjs(value) : null })}
          >
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>

          <Form.Item name="season_start_month" label={t('blocks_admin.field_season_month')}>
            <Select allowClear placeholder={t('blocks_admin.field_month_ph')} options={monthOptions} />
          </Form.Item>

          <Form.Item name="is_active" label={t('blocks_admin.field_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
