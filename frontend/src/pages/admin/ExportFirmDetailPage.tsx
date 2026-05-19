import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Skeleton,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  BankOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useExportFirm,
  useCreateFirm,
  useUpdateFirm,
  useDeleteExportFirm,
} from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import type { IExportFirm } from '@/types';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

interface FirmFormValues {
  code: string;
  name_tk: string;
  name_en: string;
  name_ru: string;
  director: string;
  tax_code: string;
  swift_code: string;
  one_c_code: string;
  address_tk: string;
  address_en: string;
  address_ru: string;
  bank_details_tk: string;
  bank_details_en: string;
  bank_details_ru: string;
  is_active: boolean;
  is_gapy_satys: boolean;
}

export default function ExportFirmDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  const isNew = id === 'new';
  const firmId = isNew ? undefined : Number(id);

  const [drawerOpen, setDrawerOpen] = useState(isNew);
  const [form] = Form.useForm<FirmFormValues>();

  const { data: firm, isLoading } = useExportFirm(firmId);

  const canEdit = canDo(user, 'export_firm', 'edit');
  const canDelete = canDo(user, 'export_firm', 'delete');
  const canCreate = canDo(user, 'export_firm', 'create');

  const createMutation = useCreateFirm({
    onSuccess: () => {
      toast.success(t('firms_admin.toast_created'));
      navigate('/admin/firms');
    },
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  const updateMutation = useUpdateFirm({
    onSuccess: () => {
      toast.success(t('firms_admin.toast_updated'));
      setDrawerOpen(false);
    },
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  const deleteMutation = useDeleteExportFirm({
    onSuccess: () => {
      toast.success(t('firms_admin.toast_deleted'));
      navigate('/admin/firms');
    },
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  function handleOpenEdit() {
    if (!firm) return;
    form.setFieldsValue({
      code: firm.code,
      name_tk: firm.name_tk,
      name_en: firm.name_en ?? '',
      name_ru: firm.name_ru ?? '',
      director: firm.director ?? '',
      tax_code: firm.tax_code ?? '',
      swift_code: firm.swift_code ?? '',
      one_c_code: firm.one_c_code ?? '',
      address_tk: firm.address_tk ?? '',
      address_en: firm.address_en ?? '',
      address_ru: firm.address_ru ?? '',
      bank_details_tk: firm.bank_details_tk ?? '',
      bank_details_en: firm.bank_details_en ?? '',
      bank_details_ru: firm.bank_details_ru ?? '',
      is_active: firm.is_active,
      is_gapy_satys: firm.is_gapy_satys,
    });
    setDrawerOpen(true);
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    const payload: Omit<IExportFirm, 'id'> = {
      code: values.code,
      name_tk: values.name_tk,
      name_en: values.name_en || null,
      name_ru: values.name_ru || null,
      director: values.director || null,
      tax_code: values.tax_code || null,
      swift_code: values.swift_code || null,
      one_c_code: values.one_c_code || null,
      address_tk: values.address_tk || null,
      address_en: values.address_en || null,
      address_ru: values.address_ru || null,
      bank_details_tk: values.bank_details_tk || null,
      bank_details_en: values.bank_details_en || null,
      bank_details_ru: values.bank_details_ru || null,
      is_active: values.is_active,
      is_gapy_satys: values.is_gapy_satys,
    };
    if (isNew) {
      createMutation.mutate(payload);
    } else if (firm) {
      updateMutation.mutate({ id: firm.id, ...payload });
    }
  }

  function handleDelete() {
    if (!firm) return;
    Modal.confirm({
      title: t('firms_admin.confirm_delete'),
      content: firm.name_en || firm.name_tk,
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: () => deleteMutation.mutate(firm.id),
    });
  }

  const empty = <Text type="secondary">—</Text>;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/admin/firms')}
            style={{ marginBottom: 8, padding: 0 }}
          >
            {t('firms_admin.title')}
          </Button>
          <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BankOutlined style={{ color: COLORS.primary }} />
            {isNew ? t('firms_admin.add') : (firm?.name_en || firm?.name_tk || '...')}
          </Title>
        </div>
        {!isNew && (
          <Space>
            {canEdit && (
              <Button icon={<EditOutlined />} onClick={handleOpenEdit}>
                {t('common.edit')}
              </Button>
            )}
            {canDelete && (
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={deleteMutation.isPending}
                onClick={handleDelete}
              >
                {t('common.delete')}
              </Button>
            )}
          </Space>
        )}
        {isNew && canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
            {t('firms_admin.add')}
          </Button>
        )}
      </div>

      {/* Body */}
      {isNew ? (
        <Text type="secondary">{t('firms_admin.add')}</Text>
      ) : isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !firm ? (
        <Text type="secondary">404</Text>
      ) : (
        <>
          <Descriptions bordered column={2} size="small" style={{ marginBottom: 24 }}>
            <Descriptions.Item label={t('firms_admin.code')}>{firm.code}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.is_active')}>
              {firm.is_active
                ? <Tag color="green">{t('common.yes')}</Tag>
                : <Tag color="default">{t('common.no')}</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.name_tk')}>{firm.name_tk || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.name_en')}>{firm.name_en || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.name_ru')}>{firm.name_ru || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.director')}>{firm.director || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.tax_code')}>{firm.tax_code || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.swift_code')}>{firm.swift_code || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.one_c_code')}>{firm.one_c_code || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.is_gapy_satys')}>
              {firm.is_gapy_satys
                ? <Tag color="orange">{t('common.yes')}</Tag>
                : <Tag color="default">{t('common.no')}</Tag>}
            </Descriptions.Item>
          </Descriptions>

          <Descriptions bordered column={1} size="small" title={t('firms_admin.address')} style={{ marginBottom: 24 }}>
            <Descriptions.Item label={t('firms_admin.address_tk')}>{firm.address_tk || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.address_en')}>{firm.address_en || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.address_ru')}>{firm.address_ru || empty}</Descriptions.Item>
          </Descriptions>

          <Descriptions bordered column={1} size="small" title={t('firms_admin.bank_details')}>
            <Descriptions.Item label={t('firms_admin.bank_details_tk')}>{firm.bank_details_tk || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.bank_details_en')}>{firm.bank_details_en || empty}</Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.bank_details_ru')}>{firm.bank_details_ru || empty}</Descriptions.Item>
          </Descriptions>
        </>
      )}

      {/* Edit / Create Drawer */}
      <Drawer
        title={isNew ? t('firms_admin.add') : t('firms_admin.edit_title')}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); if (isNew) navigate('/admin/firms'); }}
        width={520}
        maskClosable={false}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => { setDrawerOpen(false); if (isNew) navigate('/admin/firms'); }}>
              {t('common.cancel')}
            </Button>
            <Button
              type="primary"
              loading={createMutation.isPending || updateMutation.isPending}
              onClick={handleSubmit}
            >
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <Form form={form} layout="vertical" initialValues={{ is_active: true, is_gapy_satys: false }}>
          <Form.Item name="code" label={t('firms_admin.code')} rules={[{ required: true, message: t('common.required') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name_tk" label={t('firms_admin.name_tk')} rules={[{ required: true, message: t('common.required') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name_en" label={t('firms_admin.name_en')}>
            <Input />
          </Form.Item>
          <Form.Item name="name_ru" label={t('firms_admin.name_ru')}>
            <Input />
          </Form.Item>
          <Form.Item name="director" label={t('firms_admin.director')}>
            <Input />
          </Form.Item>
          <Form.Item name="tax_code" label={t('firms_admin.tax_code')}>
            <Input />
          </Form.Item>
          <Form.Item name="swift_code" label={t('firms_admin.swift_code')}>
            <Input />
          </Form.Item>
          <Form.Item name="one_c_code" label={t('firms_admin.one_c_code')}>
            <Input />
          </Form.Item>
          <Form.Item name="address_tk" label={t('firms_admin.address_tk')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="address_en" label={t('firms_admin.address_en')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="address_ru" label={t('firms_admin.address_ru')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="bank_details_tk" label={t('firms_admin.bank_details_tk')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="bank_details_en" label={t('firms_admin.bank_details_en')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="bank_details_ru" label={t('firms_admin.bank_details_ru')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="is_active" label={t('firms_admin.is_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="is_gapy_satys" label={t('firms_admin.is_gapy_satys')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
