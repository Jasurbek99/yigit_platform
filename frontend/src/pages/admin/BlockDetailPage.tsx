import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Button,
  Descriptions,
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
  Spin,
  Alert,
  Divider,
} from 'antd';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  IconBuildingWarehouse,
  IconArrowLeft,
  IconPlus,
  IconEdit,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  useAdminBlock,
  useTomatoVarieties,
  useCreateBlock,
  useUpdateBlock,
} from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { IGreenhouseBlockSub } from '@/types';

const { Text } = Typography;

interface SubBlockFormValues {
  code: string;
  name: string | null;
  variety_main: number | null;
  variety_secondary: number | null;
  area_m2: number | null;
  section_count: number | null;
  sowing_date: string | null;
  is_active: boolean;
}

export default function BlockDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const blockId = id ? parseInt(id, 10) : undefined;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IGreenhouseBlockSub | null>(null);
  const [form] = Form.useForm<SubBlockFormValues>();

  const { user } = useAuth();
  const { data: block, isLoading, isError } = useAdminBlock(blockId);
  const { data: varieties = [] } = useTomatoVarieties();

  const canWrite = user?.is_superuser || user?.role === 'director';

  const varietyOptions = varieties.map((v) => ({ value: v.id, label: v.name }));

  const createBlock = useCreateBlock({
    onSuccess: () => { toast.success(t('block_detail.toast_sub_created')); setDrawerOpen(false); form.resetFields(); },
    onError: () => toast.error(t('block_detail.toast_error')),
  });

  const updateBlock = useUpdateBlock({
    onSuccess: () => { toast.success(t('block_detail.toast_sub_updated')); setDrawerOpen(false); form.resetFields(); },
    onError: () => toast.error(t('block_detail.toast_error')),
  });

  function handleOpenCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true });
    setDrawerOpen(true);
  }

  function handleOpenEdit(record: IGreenhouseBlockSub) {
    setEditTarget(record);
    form.setFieldsValue({
      code: record.code,
      name: record.name,
      variety_main: record.variety_main,
      variety_secondary: record.variety_secondary,
      area_m2: record.area_m2,
      section_count: record.section_count,
      sowing_date: record.sowing_date,
      is_active: record.is_active,
    });
    setDrawerOpen(true);
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    const payload = {
      code: values.code,
      name: values.name || null,
      parent: blockId ?? null,
      manager: null,
      variety_main: values.variety_main ?? null,
      variety_main_name: null,
      variety_secondary: values.variety_secondary ?? null,
      variety_secondary_name: null,
      area_m2: values.area_m2 ?? null,
      location: block?.location ?? null,
      location_name: null,
      section_count: values.section_count ?? null,
      sowing_date: values.sowing_date || null,
      season_start_month: null,
      is_active: values.is_active ?? true,
      parent_code: block?.code ?? null,
      sub_blocks: [],
    };
    if (editTarget) {
      updateBlock.mutate({ id: editTarget.id, ...payload });
    } else {
      createBlock.mutate(payload);
    }
  }

  const subColumns: ProColumns<IGreenhouseBlockSub>[] = [
    {
      title: t('block_detail.col_code'),
      dataIndex: 'code',
      width: 80,
      defaultSortOrder: 'ascend',
      sorter: (a, b) => a.code.localeCompare(b.code),
      render: (_, r) => <Text strong>{r.code}</Text>,
    },
    {
      title: t('block_detail.col_name'),
      dataIndex: 'name',
      sorter: (a, b) => (a.name || '').localeCompare(b.name || ''),
      render: (_, r) => r.name || <Text type="secondary">—</Text>,
    },
    {
      title: t('block_detail.col_variety_main'),
      render: (_, r) => r.variety_main_name || <Text type="secondary">—</Text>,
    },
    {
      title: t('block_detail.col_variety_secondary'),
      render: (_, r) => r.variety_secondary_name || <Text type="secondary">—</Text>,
    },
    {
      title: t('block_detail.col_area'),
      dataIndex: 'area_m2',
      width: 120,
      sorter: (a, b) => (a.area_m2 ?? 0) - (b.area_m2 ?? 0),
      render: (_, r) => r.area_m2 != null ? r.area_m2.toLocaleString() : <Text type="secondary">—</Text>,
    },
    {
      title: t('block_detail.col_sections'),
      dataIndex: 'section_count',
      width: 100,
      sorter: (a, b) => (a.section_count ?? 0) - (b.section_count ?? 0),
      render: (_, r) => r.section_count ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('block_detail.col_sowing'),
      dataIndex: 'sowing_date',
      width: 110,
      sorter: (a, b) => (a.sowing_date || '').localeCompare(b.sowing_date || ''),
      render: (_, r) => r.sowing_date ? dayjs(r.sowing_date).format('DD.MM.YYYY') : <Text type="secondary">—</Text>,
    },
    {
      title: t('block_detail.col_status'),
      dataIndex: 'is_active',
      width: 90,
      sorter: (a, b) => {
        const diff = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
        return diff !== 0 ? diff : a.code.localeCompare(b.code);
      },
      render: (_, r) => r.is_active
        ? <Tag color="green">{t('common.active')}</Tag>
        : <Tag color="default">{t('common.inactive')}</Tag>,
    },
    ...(canWrite ? [{
      title: '',
      width: 50,
      render: (_: unknown, r: IGreenhouseBlockSub) => (
        <Button
          type="text"
          size="small"
          icon={<IconEdit size={14} />}
          onClick={() => handleOpenEdit(r)}
        />
      ),
    }] : []),
  ];

  if (isLoading) {
    return <Spin style={{ display: 'block', marginTop: 80 }} />;
  }

  if (isError || !block) {
    return <Alert message={t('block_detail.error_not_found')} type="error" style={{ marginTop: 40 }} />;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Button
          type="text"
          icon={<IconArrowLeft size={16} />}
          onClick={() => navigate('/admin/blocks')}
          style={{ marginTop: 2 }}
        />
        <div>
          <div style={{
            fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em',
            color: '#1f1f1f', lineHeight: '1.3',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <IconBuildingWarehouse size={18} color="#1677ff" />
            {block.code} — {block.name || t('block_detail.title_fallback')}
          </div>
          <div style={{ fontSize: 13, color: '#8c8c8c', marginTop: 2 }}>
            {block.location_name || '—'} · {block.is_active
              ? <Tag color="green" style={{ fontSize: 11 }}>{t('common.active')}</Tag>
              : <Tag color="default" style={{ fontSize: 11 }}>{t('common.inactive')}</Tag>}
          </div>
        </div>
      </div>

      {/* Block metadata */}
      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, sm: 2, md: 3 }}
        style={{ marginBottom: 32 }}
      >
        <Descriptions.Item label={t('block_detail.meta_code')}>{block.code}</Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_name')}>{block.name || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_location')}>{block.location_name || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_manager')}>{block.manager_name || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_variety_main')}>{block.variety_main_name || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_variety_secondary')}>{block.variety_secondary_name || '—'}</Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_area')}>
          {block.area_m2 != null ? block.area_m2.toLocaleString() : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_sections')}>{block.section_count ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_sowing_date')}>
          {block.sowing_date ? dayjs(block.sowing_date).format('DD.MM.YYYY') : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={t('block_detail.meta_season_month')}>
          {block.season_start_month != null ? t('block_detail.meta_season_month_value', { n: block.season_start_month }) : '—'}
        </Descriptions.Item>
      </Descriptions>

      <Divider style={{ fontWeight: 600 }}>
        {t('block_detail.sub_blocks_title')} {block.sub_blocks.length > 0 && `(${block.sub_blocks.length})`}
      </Divider>

      <ProTable<IGreenhouseBlockSub>
        rowKey="id"
        dataSource={block.sub_blocks}
        columns={subColumns}
        search={false}
        options={false}
        pagination={false}
        size="small"
        locale={{ emptyText: t('block_detail.sub_blocks_empty') }}
        toolBarRender={() =>
          canWrite
            ? [
                <Button
                  key="add-sub"
                  type="primary"
                  icon={<IconPlus size={14} />}
                  onClick={handleOpenCreate}
                >
                  {t('block_detail.sub_add')}
                </Button>,
              ]
            : []
        }
      />

      {/* Sub-block create/edit drawer */}
      <Drawer
        title={editTarget
          ? t('block_detail.drawer_edit')
          : t('block_detail.drawer_create')}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); form.resetFields(); }}
        width={400}
        maskClosable={false}
        extra={
          <Space>
            <Button onClick={() => { setDrawerOpen(false); form.resetFields(); }}>{t('common.cancel')}</Button>
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
            label={t('block_detail.field_code')}
            rules={[
              { required: true, message: t('block_detail.field_code_required') },
              { max: 10, message: t('block_detail.field_code_max') },
            ]}
          >
            <Input placeholder={t('block_detail.field_code_example', { code: block.code })} maxLength={10} />
          </Form.Item>

          <Form.Item name="name" label={t('block_detail.field_name')}>
            <Input placeholder={t('block_detail.field_name_example', { code: block.code })} />
          </Form.Item>

          <Form.Item name="variety_main" label={t('block_detail.field_variety_main')}>
            <Select allowClear placeholder={t('block_detail.field_variety_ph')} options={varietyOptions} showSearch optionFilterProp="label" />
          </Form.Item>

          <Form.Item name="variety_secondary" label={t('block_detail.field_variety_secondary')}>
            <Select allowClear placeholder={t('block_detail.field_variety_sec_ph')} options={varietyOptions} showSearch optionFilterProp="label" />
          </Form.Item>

          <Form.Item name="area_m2" label={t('block_detail.field_area')}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
          </Form.Item>

          <Form.Item name="section_count" label={t('block_detail.field_sections')}>
            <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
          </Form.Item>

          <Form.Item
            name="sowing_date"
            label={t('block_detail.field_sowing_date')}
            getValueFromEvent={(date: dayjs.Dayjs | null) => date ? date.format('YYYY-MM-DD') : null}
            getValueProps={(value: string | null) => ({ value: value ? dayjs(value) : null })}
          >
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>

          <Form.Item name="is_active" label={t('block_detail.field_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
