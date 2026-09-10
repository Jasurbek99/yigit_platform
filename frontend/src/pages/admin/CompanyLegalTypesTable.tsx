import { useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Select, Switch, Space, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  useCompanyLegalTypes,
  useCreateCompanyLegalType,
  useUpdateCompanyLegalType,
  useDeleteCompanyLegalType,
  useCountries,
} from '@/hooks/useAdmin';
import type { ICompanyLegalType } from '@/types';

interface IProps {
  canWrite: boolean;
}

type IFormValues = Omit<ICompanyLegalType, 'id' | 'country_codes'>;

const POSITION_OPTIONS = [
  { value: 'PREFIX', label: 'PREFIX' },
  { value: 'SUFFIX', label: 'SUFFIX' },
];

export default function CompanyLegalTypesTable({ canWrite }: IProps) {
  const { t, i18n } = useTranslation();
  const { data: types = [], isLoading } = useCompanyLegalTypes();
  const { data: countries = [] } = useCountries();
  const [form] = Form.useForm<IFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ICompanyLegalType | null>(null);

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    form.resetFields();
  }

  const createType = useCreateCompanyLegalType({
    onSuccess: () => { toast.success(t('company_legal_types.toast_created')); closeModal(); },
    onError: () => toast.error(t('company_legal_types.toast_error')),
  });
  const updateType = useUpdateCompanyLegalType({
    onSuccess: () => { toast.success(t('company_legal_types.toast_updated')); closeModal(); },
    onError: () => toast.error(t('company_legal_types.toast_error')),
  });
  const deleteType = useDeleteCompanyLegalType({
    onSuccess: () => toast.success(t('company_legal_types.toast_deleted')),
    // A type still in use is refused by the PROTECT FK, which is the point.
    onError: () => toast.error(t('company_legal_types.error_in_use')),
  });

  function handleCreate() {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({
      is_active: true,
      position_tk: 'SUFFIX',
      position_ru: 'PREFIX',
      position_en: 'SUFFIX',
      sort_order: 0,
      countries: [],
    });
    setModalOpen(true);
  }

  function handleEdit(record: ICompanyLegalType) {
    setEditTarget(record);
    form.setFieldsValue({ ...record });
    setModalOpen(true);
  }

  function handleDelete(id: number) {
    Modal.confirm({
      title: t('company_legal_types.confirm_delete'),
      content: t('company_legal_types.confirm_delete_hint'),
      onOk: () => deleteType.mutate(id),
    });
  }

  function handleSubmit(values: IFormValues) {
    if (editTarget) {
      updateType.mutate({ id: editTarget.id, ...values });
    } else {
      createType.mutate(values);
    }
  }

  const countryOptions = countries.map((c) => ({
    value: c.id,
    label: i18n.language.startsWith('ru')
      ? (c.name_ru || c.name_en || c.name_tk)
      : i18n.language.startsWith('tk')
      ? (c.name_tk || c.name_en || '')
      : (c.name_en || c.name_tk),
  }));

  const columns = [
    {
      title: t('company_legal_types.col_code'),
      dataIndex: 'code',
      key: 'code',
      width: 90,
      render: (v: string) => <strong>{v}</strong>,
    },
    {
      title: t('company_legal_types.col_abbr'),
      key: 'abbr',
      width: 150,
      render: (_: unknown, r: ICompanyLegalType) => `${r.abbr_tk} / ${r.abbr_ru}`,
    },
    {
      title: t('company_legal_types.col_full'),
      key: 'full',
      render: (_: unknown, r: ICompanyLegalType) => (
        <Space direction="vertical" size={0}>
          <span>{r.full_tk}</span>
          <span style={{ color: '#888', fontSize: 12 }}>{r.full_ru}</span>
        </Space>
      ),
    },
    {
      title: t('company_legal_types.col_genitive'),
      key: 'genitive',
      width: 120,
      // Blank genitives are what stops a contract preamble reading correctly,
      // so they are called out rather than shown as an empty cell.
      render: (_: unknown, r: ICompanyLegalType) =>
        r.gen_tk && r.gen_ru ? (
          <Tag color="green">{t('company_legal_types.genitive_set')}</Tag>
        ) : (
          <Tag color="orange">{t('company_legal_types.genitive_missing')}</Tag>
        ),
    },
    {
      title: t('company_legal_types.col_countries'),
      dataIndex: 'country_codes',
      key: 'country_codes',
      width: 200,
      render: (codes: string[]) =>
        codes.length ? codes.join(', ') : t('company_legal_types.all_countries'),
    },
    {
      title: t('company_legal_types.col_status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (v: boolean) => (
        <Tag color={v ? 'green' : 'default'}>
          {v ? t('common.active') : t('common.inactive')}
        </Tag>
      ),
    },
    ...(canWrite
      ? [
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, record: ICompanyLegalType) => (
              <Space size={4}>
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(record.id)}
                />
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      {canWrite && (
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            {t('company_legal_types.add')}
          </Button>
        </div>
      )}

      <Table
        columns={columns}
        dataSource={types}
        rowKey="id"
        loading={isLoading}
        pagination={false}
        size="small"
        bordered
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title={editTarget ? t('company_legal_types.edit') : t('company_legal_types.add')}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        confirmLoading={createType.isPending || updateType.isPending}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="code"
            label={t('company_legal_types.col_code')}
            rules={[{ required: true, message: t('common.required') }]}
            extra={t('company_legal_types.code_hint')}
          >
            <Input disabled={!!editTarget} />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item
              name="abbr_tk"
              label={t('company_legal_types.abbr_tk')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="abbr_ru"
              label={t('company_legal_types.abbr_ru')}
              rules={[{ required: true, message: t('common.required') }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="abbr_en" label={t('company_legal_types.abbr_en')}>
              <Input />
            </Form.Item>
          </Space>

          <Form.Item
            name="full_tk"
            label={t('company_legal_types.full_tk')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="full_ru"
            label={t('company_legal_types.full_ru')}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="full_en" label={t('company_legal_types.full_en')}>
            <Input />
          </Form.Item>

          <Form.Item name="gen_tk" label={t('company_legal_types.gen_tk')} extra={t('company_legal_types.gen_hint')}>
            <Input />
          </Form.Item>
          <Form.Item name="gen_ru" label={t('company_legal_types.gen_ru')}>
            <Input />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="position_tk" label={t('company_legal_types.position_tk')} extra={t('company_legal_types.position_hint')}>
              <Select options={POSITION_OPTIONS} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="position_ru" label={t('company_legal_types.position_ru')}>
              <Select options={POSITION_OPTIONS} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="position_en" label={t('company_legal_types.position_en')}>
              <Select options={POSITION_OPTIONS} style={{ width: 130 }} />
            </Form.Item>
          </Space>

          <Form.Item
            name="countries"
            label={t('company_legal_types.col_countries')}
            extra={t('company_legal_types.countries_hint')}
          >
            <Select mode="multiple" options={countryOptions} allowClear optionFilterProp="label" />
          </Form.Item>

          <Space size={24} style={{ display: 'flex' }}>
            <Form.Item name="sort_order" label={t('company_legal_types.col_sort')}>
              <InputNumber min={0} max={999} />
            </Form.Item>
            {editTarget && (
              <Form.Item name="is_active" label={t('company_legal_types.col_status')} valuePropName="checked">
                <Switch />
              </Form.Item>
            )}
          </Space>
        </Form>
      </Modal>
    </>
  );
}
