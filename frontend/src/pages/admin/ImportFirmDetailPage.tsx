import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Typography,
  Upload,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ShopOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useImportFirm,
  useCreateImportFirm,
  useUpdateImportFirm,
  useDeleteImportFirm,
  useUploadImportFirmFile,
} from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { CountrySelect } from '@/components/CountrySelect';
import { CitySelect } from '@/components/CitySelect';
import type { IImportFirm } from '@/types';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

interface FirmFormValues {
  code: string;
  name_company: string;
  name_short: string;
  country: number | null;
  city: number | null;
  address: string;
  bank_details: string;
  contact_person: string;
  phone: string;
  is_active: boolean;
  is_gapy_satys: boolean;
}

function FileUploadCard({
  label,
  currentUrl,
  onUpload,
  isUploading,
  uploadLabel,
  replaceLabel,
}: {
  label: string;
  currentUrl: string | null;
  onUpload: (file: File) => void;
  isUploading: boolean;
  uploadLabel: string;
  replaceLabel: string;
}) {
  return (
    <div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{label}</Text>
      {currentUrl && (
        <div style={{ marginBottom: 10 }}>
          <img
            src={currentUrl}
            alt={label}
            style={{
              maxHeight: 140,
              maxWidth: 320,
              objectFit: 'contain',
              border: '1px solid #f0f0f0',
              borderRadius: 4,
              padding: 6,
              display: 'block',
              background: COLORS.bgLayout,
            }}
          />
        </div>
      )}
      <Upload
        accept="image/*"
        maxCount={1}
        showUploadList={false}
        beforeUpload={(file) => { onUpload(file); return false; }}
      >
        <Button icon={<UploadOutlined />} size="small" loading={isUploading}>
          {currentUrl ? replaceLabel : uploadLabel}
        </Button>
      </Upload>
    </div>
  );
}

export default function ImportFirmDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user } = useAuth();

  const isNew = id === 'new';
  const firmId = isNew ? undefined : Number(id);

  const [drawerOpen, setDrawerOpen] = useState(isNew);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [sealFile, setSealFile] = useState<File | null>(null);
  const [form] = Form.useForm<FirmFormValues>();

  const watchedCountry = Form.useWatch('country', form);
  const { data: firm, isLoading } = useImportFirm(firmId);

  const canEdit = canDo(user, 'import_firm', 'edit');
  const canDelete = canDo(user, 'import_firm', 'delete');
  const canCreate = canDo(user, 'import_firm', 'create');

  const createMutation = useCreateImportFirm({
    onSuccess: () => {
      toast.success(t('import_firms_admin.toast_created'));
      navigate('/admin/import-firms');
    },
    onError: () => toast.error(t('import_firms_admin.toast_error')),
  });

  const updateMutation = useUpdateImportFirm({
    onSuccess: () => {
      toast.success(t('import_firms_admin.toast_updated'));
      setDrawerOpen(false);
    },
    onError: () => toast.error(t('import_firms_admin.toast_error')),
  });

  const deleteMutation = useDeleteImportFirm({
    onSuccess: () => {
      toast.success(t('import_firms_admin.toast_deleted'));
      navigate('/admin/import-firms');
    },
    onError: () => toast.error(t('import_firms_admin.toast_error')),
  });

  const uploadFileMutation = useUploadImportFirmFile({
    onSuccess: () => toast.success(t('import_firms_admin.toast_file_uploaded')),
    onError: () => toast.error(t('import_firms_admin.toast_error')),
  });

  function handleOpenEdit() {
    if (!firm) return;
    setSignatureFile(null);
    setSealFile(null);
    form.setFieldsValue({
      code: firm.code ?? '',
      name_company: firm.name_company,
      name_short: firm.name_short ?? '',
      country: firm.country,
      city: firm.city,
      address: firm.address ?? '',
      bank_details: firm.bank_details ?? '',
      contact_person: firm.contact_person ?? '',
      phone: firm.phone ?? '',
      is_active: firm.is_active,
      is_gapy_satys: firm.is_gapy_satys,
    });
    setDrawerOpen(true);
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    const payload: Omit<IImportFirm, 'id' | 'country_name' | 'city_name' | 'director_signature' | 'director_seal'> = {
      code: values.code || null,
      name_company: values.name_company,
      name_short: values.name_short || null,
      country: values.country ?? null,
      city: values.city ?? null,
      address: values.address || null,
      bank_details: values.bank_details || null,
      contact_person: values.contact_person || null,
      phone: values.phone || null,
      is_active: values.is_active,
      is_gapy_satys: values.is_gapy_satys,
    };
    if (isNew) {
      createMutation.mutate({ ...payload, signatureFile, sealFile });
    } else if (firm) {
      updateMutation.mutate({ id: firm.id, ...payload, signatureFile, sealFile });
    }
  }

  function handleDelete() {
    if (!firm) return;
    Modal.confirm({
      title: t('import_firms_admin.confirm_delete'),
      content: firm.name_company,
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: () => deleteMutation.mutate(firm.id),
    });
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setSignatureFile(null);
    setSealFile(null);
    if (isNew) navigate('/admin/import-firms');
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
            onClick={() => navigate('/admin/import-firms')}
            style={{ marginBottom: 8, padding: 0 }}
          >
            {t('import_firms_admin.title')}
          </Button>
          <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShopOutlined style={{ color: COLORS.primary }} />
            {isNew ? t('import_firms_admin.add') : (firm?.name_company || '...')}
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
            {t('import_firms_admin.add')}
          </Button>
        )}
      </div>

      {/* Body */}
      {isNew ? (
        <Text type="secondary">{t('import_firms_admin.add')}</Text>
      ) : isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : !firm ? (
        <Text type="secondary">404</Text>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label={t('import_firms_admin.name_company')} span={2}>
              {firm.name_company}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.name_short')}>
              {firm.name_short || empty}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.code')}>
              {firm.code || empty}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.country')}>
              {firm.country_name || empty}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.city')}>
              {firm.city_name || empty}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.contact_person')} span={2}>
              {firm.contact_person || empty}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.phone')}>
              {firm.phone || empty}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.address')} span={2}>
              {firm.address || empty}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.bank_details')} span={2}>
              {firm.bank_details || empty}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.is_active')}>
              {firm.is_active
                ? <Tag color="green">{t('common.yes')}</Tag>
                : <Tag color="default">{t('common.no')}</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={t('import_firms_admin.is_gapy_satys')}>
              {firm.is_gapy_satys
                ? <Tag color="orange">{t('common.yes')}</Tag>
                : <Tag color="default">{t('common.no')}</Tag>}
            </Descriptions.Item>
          </Descriptions>

          {/* Signature & Seal — separate upload section (edit permission required) */}
          {canEdit && (
            <Card
              size="small"
              title={t('import_firms_admin.signature_and_seal')}
              style={{ borderRadius: 8 }}
            >
              <Space size={32} wrap>
                <FileUploadCard
                  label={t('import_firms_admin.director_signature')}
                  currentUrl={firm.director_signature}
                  onUpload={(file) => uploadFileMutation.mutate({ id: firm.id, field: 'director_signature', file })}
                  isUploading={uploadFileMutation.isPending}
                  uploadLabel={t('import_firms_admin.upload_file')}
                  replaceLabel={t('import_firms_admin.replace_file')}
                />
                <FileUploadCard
                  label={t('import_firms_admin.director_seal')}
                  currentUrl={firm.director_seal}
                  onUpload={(file) => uploadFileMutation.mutate({ id: firm.id, field: 'director_seal', file })}
                  isUploading={uploadFileMutation.isPending}
                  uploadLabel={t('import_firms_admin.upload_file')}
                  replaceLabel={t('import_firms_admin.replace_file')}
                />
              </Space>
            </Card>
          )}

          {/* Read-only view for users without edit */}
          {!canEdit && (firm.director_signature || firm.director_seal) && (
            <Card size="small" title={t('import_firms_admin.signature_and_seal')} style={{ borderRadius: 8 }}>
              <Space size={32} wrap>
                {firm.director_signature && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      {t('import_firms_admin.director_signature')}
                    </Text>
                    <img src={firm.director_signature} alt="Signature" style={{ maxHeight: 120, maxWidth: 280, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 4, padding: 6 }} />
                  </div>
                )}
                {firm.director_seal && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      {t('import_firms_admin.director_seal')}
                    </Text>
                    <img src={firm.director_seal} alt="Seal" style={{ maxHeight: 120, maxWidth: 280, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 4, padding: 6 }} />
                  </div>
                )}
              </Space>
            </Card>
          )}
        </Space>
      )}

      {/* Edit / Create Drawer */}
      <Drawer
        title={isNew ? t('import_firms_admin.add') : t('import_firms_admin.edit_title')}
        open={drawerOpen}
        onClose={closeDrawer}
        width={480}
        maskClosable={false}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={closeDrawer}>{t('common.cancel')}</Button>
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
          <Form.Item name="name_company" label={t('import_firms_admin.name_company')} rules={[{ required: true, message: t('common.required') }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name_short" label={t('import_firms_admin.name_short')}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label={t('import_firms_admin.code')}>
            <Input />
          </Form.Item>
          <Form.Item name="country" label={t('import_firms_admin.country')}>
            <CountrySelect onChange={() => form.setFieldValue('city', null)} />
          </Form.Item>
          <Form.Item name="city" label={t('import_firms_admin.city')}>
            <CitySelect countryId={watchedCountry ?? null} />
          </Form.Item>
          <Form.Item name="contact_person" label={t('import_firms_admin.contact_person')}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label={t('import_firms_admin.phone')}>
            <Input />
          </Form.Item>
          <Form.Item name="address" label={t('import_firms_admin.address')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="bank_details" label={t('import_firms_admin.bank_details')}>
            <Input.TextArea rows={3} />
          </Form.Item>

          {/* Optional file uploads in drawer */}
          <Form.Item label={t('import_firms_admin.director_signature')}>
            <Upload
              accept="image/*"
              maxCount={1}
              beforeUpload={(file) => { setSignatureFile(file); return false; }}
              onRemove={() => setSignatureFile(null)}
              fileList={signatureFile ? [{ uid: '-1', name: signatureFile.name, status: 'done' as const }] : []}
            >
              <Button icon={<UploadOutlined />} size="small">
                {t('import_firms_admin.upload_file')}
              </Button>
            </Upload>
          </Form.Item>
          <Form.Item label={t('import_firms_admin.director_seal')}>
            <Upload
              accept="image/*"
              maxCount={1}
              beforeUpload={(file) => { setSealFile(file); return false; }}
              onRemove={() => setSealFile(null)}
              fileList={sealFile ? [{ uid: '-1', name: sealFile.name, status: 'done' as const }] : []}
            >
              <Button icon={<UploadOutlined />} size="small">
                {t('import_firms_admin.upload_file')}
              </Button>
            </Upload>
          </Form.Item>

          <Form.Item name="is_gapy_satys" label={t('import_firms_admin.firm_type')}>
            <Select
              options={[
                { value: false, label: t('import_firms_admin.tab_our') },
                { value: true, label: t('import_firms_admin.tab_gapy_satys') },
              ]}
            />
          </Form.Item>
          <Form.Item name="is_active" label={t('import_firms_admin.is_active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
