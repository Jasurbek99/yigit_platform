import { Button, Empty, List, Popconfirm, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  FilePdfOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import {
  contractAttachmentUrl,
  useDeleteContractAttachment,
  useUploadContractAttachments,
} from '@/hooks/useContracts';
import type { IContractAttachment } from '@/types/contract';

const { Text } = Typography;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface IDocumentsTabProps {
  contractId: number;
  attachments: IContractAttachment[];
  /** Whether the current user may upload documents (contract resource: create) */
  canUpload: boolean;
  /** Whether the current user may delete documents (contract resource: delete) */
  canDelete: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DocumentsTab({
  contractId,
  attachments,
  canUpload,
  canDelete,
}: IDocumentsTabProps) {
  const { t } = useTranslation();
  const uploadMutation = useUploadContractAttachments(contractId);
  const deleteMutation = useDeleteContractAttachment(contractId);

  const handleUpload: UploadProps['customRequest'] = ({ file, onSuccess, onError }) => {
    uploadMutation.mutate([file as File], {
      onSuccess: () => {
        toast.success(t('contracts.documents.toast_uploaded'));
        onSuccess?.(null);
      },
      onError: (err: unknown) => {
        const data = (err as { response?: { data?: { error?: string; detail?: string } } })
          ?.response?.data;
        toast.error(
          data?.error ?? data?.detail ?? t('contracts.documents.toast_upload_failed'),
        );
        onError?.(err as Error);
      },
    });
  };

  const handleDelete = (id: number): void => {
    deleteMutation.mutate(id, {
      onSuccess: () => toast.success(t('contracts.documents.toast_deleted')),
      onError: () => toast.error(t('contracts.documents.toast_delete_failed')),
    });
  };

  return (
    <div>
      {canUpload && (
        <Upload
          accept="application/pdf"
          multiple
          showUploadList={false}
          customRequest={handleUpload}
        >
          <Button
            icon={<UploadOutlined />}
            type="primary"
            loading={uploadMutation.isPending}
            style={{ marginBottom: 16 }}
          >
            {t('contracts.documents.upload')}
          </Button>
        </Upload>
      )}

      {attachments.length === 0 ? (
        <Empty description={t('contracts.documents.empty')} style={{ padding: '32px 0' }} />
      ) : (
        <List
          bordered
          dataSource={attachments}
          renderItem={(att) => (
            <List.Item
              actions={[
                <Button
                  key="view"
                  type="link"
                  icon={<EyeOutlined />}
                  href={contractAttachmentUrl(contractId, att.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('contracts.documents.view')}
                </Button>,
                ...(canDelete
                  ? [
                      <Popconfirm
                        key="delete"
                        title={t('contracts.documents.delete_confirm')}
                        onConfirm={() => handleDelete(att.id)}
                        okText={t('common.yes')}
                        cancelText={t('common.no')}
                      >
                        <Button type="link" danger icon={<DeleteOutlined />}>
                          {t('common.delete')}
                        </Button>
                      </Popconfirm>,
                    ]
                  : []),
              ]}
            >
              <List.Item.Meta
                avatar={<FilePdfOutlined style={{ fontSize: 22, color: '#d4380d' }} />}
                title={att.original_filename}
                description={
                  <Text type="secondary">
                    {fmtSize(att.size_bytes)} · {att.uploaded_by_name} ·{' '}
                    {dayjs(att.uploaded_at).format('DD.MM.YYYY HH:mm')}
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
