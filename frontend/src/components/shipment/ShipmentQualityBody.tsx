import { Button, List, Popconfirm, Space, Tag, Typography, Upload } from 'antd';
import {
  CheckCircleTwoTone,
  DeleteOutlined,
  FileOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getShipmentDetailKey } from '@/hooks/useShipmentDetail';
import api from '@/services/api';
import type { IQualityCertificate, IShipmentDetail, IShipmentQuality } from '@/types';

const { Text } = Typography;

/** The two scan formats the backend validator accepts (`export/services/files.py`). */
const ACCEPT = '.jpg,.jpeg,.pdf';

/** Mirrors MAX_FILES_PER_TYPE in `export/services/files.py`. */
const MAX_FILES_PER_TYPE = 5;

const QUALITY_FIELDS: (keyof IShipmentQuality)[] = [
  'azyk_maglumatnama',
  'suriji_gozukdiriji',
  'hil_sertifikaty',
  'kalibrowka_analiz',
];

interface IShipmentQualityBodyProps {
  shipment: IShipmentDetail;
  canEditQuality: boolean;
}

/**
 * "Quality Certificates" card body: one upload slot per certificate.
 *
 * Until 2026-09-22 these were four checkboxes PATCHing `/quality/`. They are
 * uploads now — a certificate must be evidenced by its scan, so the four
 * booleans on the shipment became DERIVED (true iff a scan of that type
 * exists) and are shown here as a read-only badge, not an input. The boolean
 * endpoint is gone; `sync_certificate_flags` on the server owns the flags.
 *
 * The four booleans still ship in the payload and still drive ShipmentList's
 * columns and the Sheet's document icons — nothing downstream changed.
 */
export function ShipmentQualityBody({ shipment, canEditQuality }: IShipmentQualityBodyProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const id = String(shipment.id);
  const listUrl = `/export/shipments/${id}/quality-certificates/`;

  const { data: certificates = [], isLoading, isError } = useQuery({
    queryKey: ['shipment-quality-certificates', id],
    queryFn: async () => (await api.get<IQualityCertificate[]>(listUrl)).data,
  });

  /**
   * The upload validator refuses per file and says why — wrong magic bytes, over
   * 10 MB, more than MAX_FILES_PER_TYPE of this kind. Those messages name the
   * offending file, so they are worth more to the operator than a generic
   * failure, and the request is all-or-nothing: nothing was stored.
   */
  function certificateErrorMessage(err: unknown, fallback: string): string {
    const data = (err as { response?: { data?: { error?: string; detail?: string } } })
      ?.response?.data;
    return data?.error ?? data?.detail ?? fallback;
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['shipment-quality-certificates', id] });
    // The four derived flags live on the shipment detail payload.
    void queryClient.invalidateQueries({ queryKey: getShipmentDetailKey(id) });
  }

  const uploadMutation = useMutation({
    mutationFn: async ({ docType, files }: { docType: string; files: File[] }) => {
      const form = new FormData();
      form.append('doc_type', docType);
      files.forEach((file) => form.append('files', file));
      await api.post(listUrl, form);
    },
    onSuccess: refresh,
    onError: (err) => toast.error(certificateErrorMessage(err, t('quality.upload_error'))),
  });

  const removeMutation = useMutation({
    mutationFn: async (certificateId: number) => {
      // POST, not DELETE: ShipmentViewSet forbids DELETE so that a shipment
      // itself cannot be destroyed via the API. Matches its hard-delete /
      // soft-delete actions.
      await api.post(`${listUrl}${certificateId}/delete/`);
    },
    onSuccess: refresh,
    onError: (err) => toast.error(certificateErrorMessage(err, t('quality.delete_error'))),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isError && <Text type="danger">{t('quality.load_error')}</Text>}
      {QUALITY_FIELDS.map((field) => {
        const own = certificates.filter((c) => c.doc_type === field);
        const isFull = own.length >= MAX_FILES_PER_TYPE;

        return (
          <div key={field} id={`detail-field-quality.${field}`}>
            <Space size={6} style={{ marginBottom: 4 }}>
              {own.length > 0 ? (
                <CheckCircleTwoTone twoToneColor="#52c41a" />
              ) : (
                <Tag color="default">{t('quality.missing')}</Tag>
              )}
              <Text strong>{t(`quality.${field}`)}</Text>
            </Space>

            <List
              size="small"
              loading={isLoading}
              dataSource={own}
              locale={{ emptyText: t('quality.no_scans') }}
              renderItem={(certificate) => (
                <List.Item
                  actions={
                    canEditQuality
                      ? [
                          <Popconfirm
                            key="delete"
                            title={t('quality.delete_confirm')}
                            okText={t('common.delete')}
                            cancelText={t('common.cancel')}
                            onConfirm={() => removeMutation.mutate(certificate.id)}
                          >
                            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                          </Popconfirm>,
                        ]
                      : []
                  }
                >
                  <Space size={6}>
                    <FileOutlined />
                    {/* Same-origin authenticated download — the httpOnly cookie rides along. */}
                    <a href={certificate.download_url} target="_blank" rel="noreferrer">
                      {certificate.original_filename}
                    </a>
                    <Text type="secondary">
                      {Math.round(certificate.size_bytes / 1024)} KB
                    </Text>
                  </Space>
                </List.Item>
              )}
            />

            {canEditQuality && (
              <Upload
                accept={ACCEPT}
                multiple
                showUploadList={false}
                disabled={isFull || uploadMutation.isPending}
                // AntD calls beforeUpload once per selected file; send the whole
                // selection on the first call. The per-type cap and the
                // all-or-nothing validation are enforced per REQUEST server-side,
                // so one request per file would let a batch slip past the cap.
                beforeUpload={(file, fileList) => {
                  if (file === fileList[0]) {
                    uploadMutation.mutate({
                      docType: field,
                      files: fileList as unknown as File[],
                    });
                  }
                  return false;
                }}
              >
                <Button
                  size="small"
                  icon={<UploadOutlined />}
                  disabled={isFull}
                  loading={uploadMutation.isPending}
                >
                  {isFull ? t('quality.max_reached') : t('quality.upload')}
                </Button>
              </Upload>
            )}
          </div>
        );
      })}
    </div>
  );
}
