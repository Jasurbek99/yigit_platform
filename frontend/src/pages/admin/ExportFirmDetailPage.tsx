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
  Skeleton,
  Space,
  Switch,
  Typography,
  Upload,
} from 'antd';
import {
  ArrowLeftOutlined,
  BankOutlined,
  DeleteOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useExportFirm,
  useCreateFirm,
  useUpdateFirm,
  useDeleteExportFirm,
  useUploadExportFirmFile,
} from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { InlineEdit } from '@/components/InlineEdit';
import type { IExportFirm } from '@/types';
import { COLORS } from '@/constants/styles';

const { Title, Text } = Typography;

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

interface FirmFormValues {
  code: string;
  name_short: string;
  name_tk: string;
  name_en: string;
  name_ru: string;
  director: string;
  director_tk: string;
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
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [sealFile, setSealFile] = useState<File | null>(null);
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
    onSuccess: () => toast.success(t('firms_admin.toast_updated')),
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  function saveField(patch: Partial<IExportFirm>) {
    if (!firm) return;
    updateMutation.mutate({ id: firm.id, ...patch });
  }

  const deleteMutation = useDeleteExportFirm({
    onSuccess: () => {
      toast.success(t('firms_admin.toast_deleted'));
      navigate('/admin/firms');
    },
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  const uploadFileMutation = useUploadExportFirmFile({
    onSuccess: () => toast.success(t('firms_admin.toast_file_uploaded')),
    onError: () => toast.error(t('firms_admin.toast_error')),
  });

  async function handleSubmit() {
    const values = await form.validateFields();
    const payload: Omit<IExportFirm, 'id' | 'director_signature' | 'director_seal'> = {
      code: values.code,
      name_short: values.name_short || null,
      name_tk: values.name_tk,
      name_en: values.name_en || null,
      name_ru: values.name_ru || null,
      director: values.director || null,
      director_tk: values.director_tk || null,
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
      createMutation.mutate({ ...payload, signatureFile, sealFile });
    } else if (firm) {
      updateMutation.mutate({ id: firm.id, ...payload, signatureFile, sealFile });
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

  function closeDrawer() {
    setDrawerOpen(false);
    setSignatureFile(null);
    setSealFile(null);
    if (isNew) navigate('/admin/firms');
  }

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
        {!isNew && canDelete && (
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={deleteMutation.isPending}
            onClick={handleDelete}
          >
            {t('common.delete')}
          </Button>
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
            <Descriptions.Item label={t('firms_admin.code')}>
              <InlineEdit value={firm.code} required editable={canEdit} onSave={(v) => saveField({ code: v })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.name_short')}>
              <InlineEdit value={firm.name_short} editable={canEdit} onSave={(v) => saveField({ name_short: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.is_active')} span={2}>
              <Space size={40}>
                <Switch checked={firm.is_active} disabled={!canEdit} onChange={(v) => saveField({ is_active: v })} />
                <Space size={8}>
                  <Switch checked={firm.is_gapy_satys} disabled={!canEdit} onChange={(v) => saveField({ is_gapy_satys: v })} />
                  <Text type="secondary">{t('firms_admin.is_gapy_satys')}</Text>
                </Space>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.name_tk')}>
              <InlineEdit value={firm.name_tk} required editable={canEdit} onSave={(v) => saveField({ name_tk: v })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.name_en')}>
              <InlineEdit value={firm.name_en} editable={canEdit} onSave={(v) => saveField({ name_en: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.name_ru')}>
              <InlineEdit value={firm.name_ru} editable={canEdit} onSave={(v) => saveField({ name_ru: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.director')}>
              <InlineEdit value={firm.director} editable={canEdit} onSave={(v) => saveField({ director: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.director_tk')}>
              <InlineEdit value={firm.director_tk} editable={canEdit} onSave={(v) => saveField({ director_tk: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.tax_code')}>
              <InlineEdit value={firm.tax_code} editable={canEdit} onSave={(v) => saveField({ tax_code: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.swift_code')}>
              <InlineEdit value={firm.swift_code} editable={canEdit} onSave={(v) => saveField({ swift_code: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.one_c_code')}>
              <InlineEdit value={firm.one_c_code} editable={canEdit} onSave={(v) => saveField({ one_c_code: v || null })} />
            </Descriptions.Item>
          </Descriptions>

          <Descriptions bordered column={1} size="small" title={t('firms_admin.address')} style={{ marginBottom: 24 }}>
            <Descriptions.Item label={t('firms_admin.address_tk')}>
              <InlineEdit value={firm.address_tk} multiline editable={canEdit} onSave={(v) => saveField({ address_tk: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.address_en')}>
              <InlineEdit value={firm.address_en} multiline editable={canEdit} onSave={(v) => saveField({ address_en: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.address_ru')}>
              <InlineEdit value={firm.address_ru} multiline editable={canEdit} onSave={(v) => saveField({ address_ru: v || null })} />
            </Descriptions.Item>
          </Descriptions>

          <Descriptions bordered column={1} size="small" title={t('firms_admin.bank_details')}>
            <Descriptions.Item label={t('firms_admin.bank_details_tk')}>
              <InlineEdit value={firm.bank_details_tk} multiline editable={canEdit} onSave={(v) => saveField({ bank_details_tk: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.bank_details_en')}>
              <InlineEdit value={firm.bank_details_en} multiline editable={canEdit} onSave={(v) => saveField({ bank_details_en: v || null })} />
            </Descriptions.Item>
            <Descriptions.Item label={t('firms_admin.bank_details_ru')}>
              <InlineEdit value={firm.bank_details_ru} multiline editable={canEdit} onSave={(v) => saveField({ bank_details_ru: v || null })} />
            </Descriptions.Item>
          </Descriptions>

          {/* Signature & Seal — separate upload section (edit permission required) */}
          {canEdit && (
            <Card
              size="small"
              title={t('firms_admin.signature_and_seal')}
              style={{ borderRadius: 8, marginTop: 24 }}
            >
              <Space size={32} wrap>
                <FileUploadCard
                  label={t('firms_admin.director_signature')}
                  currentUrl={firm.director_signature}
                  onUpload={(file) => uploadFileMutation.mutate({ id: firm.id, field: 'director_signature', file })}
                  isUploading={uploadFileMutation.isPending}
                  uploadLabel={t('firms_admin.upload_file')}
                  replaceLabel={t('firms_admin.replace_file')}
                />
                <FileUploadCard
                  label={t('firms_admin.director_seal')}
                  currentUrl={firm.director_seal}
                  onUpload={(file) => uploadFileMutation.mutate({ id: firm.id, field: 'director_seal', file })}
                  isUploading={uploadFileMutation.isPending}
                  uploadLabel={t('firms_admin.upload_file')}
                  replaceLabel={t('firms_admin.replace_file')}
                />
              </Space>
            </Card>
          )}

          {/* Read-only view for users without edit */}
          {!canEdit && (firm.director_signature || firm.director_seal) && (
            <Card size="small" title={t('firms_admin.signature_and_seal')} style={{ borderRadius: 8, marginTop: 24 }}>
              <Space size={32} wrap>
                {firm.director_signature && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      {t('firms_admin.director_signature')}
                    </Text>
                    <img src={firm.director_signature} alt="Signature" style={{ maxHeight: 120, maxWidth: 280, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 4, padding: 6 }} />
                  </div>
                )}
                {firm.director_seal && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      {t('firms_admin.director_seal')}
                    </Text>
                    <img src={firm.director_seal} alt="Seal" style={{ maxHeight: 120, maxWidth: 280, objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 4, padding: 6 }} />
                  </div>
                )}
              </Space>
            </Card>
          )}
        </>
      )}

      {/* Edit / Create Drawer */}
      <Drawer
        title={isNew ? t('firms_admin.add') : t('firms_admin.edit_title')}
        open={drawerOpen}
        onClose={closeDrawer}
        width={520}
        maskClosable={false}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={closeDrawer}>
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
          <Form.Item name="name_short" label={t('firms_admin.name_short')}>
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
          <Form.Item name="director_tk" label={t('firms_admin.director_tk')}>
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

          {/* Optional file uploads in drawer */}
          <Form.Item label={t('firms_admin.director_signature')}>
            <Upload
              accept="image/*"
              maxCount={1}
              beforeUpload={(file) => { setSignatureFile(file); return false; }}
              onRemove={() => setSignatureFile(null)}
              fileList={signatureFile ? [{ uid: '-1', name: signatureFile.name, status: 'done' as const }] : []}
            >
              <Button icon={<UploadOutlined />} size="small">
                {t('firms_admin.upload_file')}
              </Button>
            </Upload>
          </Form.Item>
          <Form.Item label={t('firms_admin.director_seal')}>
            <Upload
              accept="image/*"
              maxCount={1}
              beforeUpload={(file) => { setSealFile(file); return false; }}
              onRemove={() => setSealFile(null)}
              fileList={sealFile ? [{ uid: '-1', name: sealFile.name, status: 'done' as const }] : []}
            >
              <Button icon={<UploadOutlined />} size="small">
                {t('firms_admin.upload_file')}
              </Button>
            </Upload>
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
