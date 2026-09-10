import { Button, Divider, List, Popconfirm, Space, Typography, Upload } from 'antd';
import { DeleteOutlined, FileOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/** The two scan formats the backend validator accepts (`services/files.py`). */
const ACCEPT = '.jpg,.jpeg,.pdf';

export interface IFleetDocument {
  id: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: number;
  uploaded_by_name: string;
  uploaded_at: string;
}

/** The four strings that differ between a driver passport and a truck tech passport. */
export interface IFleetDocumentLabels {
  title: string;
  emptyText: string;
  uploadLabel: string;
  hint: string;
}

/**
 * AntD calls `beforeUpload` once per selected file. Both pickers below send the
 * whole selection on the first call instead: the per-record cap and the
 * all-or-nothing validation are enforced per request server-side, so one
 * request per file would let two concurrent uploads slip past the cap and would
 * make "one bad file rejects the batch" unreachable from the screen.
 */
function SelectionUpload({
  label,
  hint,
  loading,
  onSelect,
}: {
  label: string;
  hint: string;
  loading?: boolean;
  onSelect: (files: File[]) => void;
}) {
  return (
    <>
      <Upload
        accept={ACCEPT}
        multiple
        showUploadList={false}
        beforeUpload={(file, fileList) => {
          if (file === fileList[0]) {
            onSelect(fileList as unknown as File[]);
          }
          return false;
        }}
      >
        <Button icon={<UploadOutlined />} loading={loading}>
          {label}
        </Button>
      </Upload>
      <div>
        <Text type="secondary">{hint}</Text>
      </div>
    </>
  );
}

/**
 * Scans already attached to a saved record — a driver's passport or a truck
 * head's tech passport. Uploads fire immediately, because the record has an id.
 *
 * Presentational on purpose: the caller owns the hooks, so this file does not
 * have to know which of the two resources it is showing.
 */
export function FleetDocumentsPanel({
  labels,
  documents,
  isLoading,
  isUploading,
  documentUrl,
  onUpload,
  onRemove,
}: {
  labels: IFleetDocumentLabels;
  documents: IFleetDocument[];
  isLoading?: boolean;
  isUploading?: boolean;
  documentUrl: (documentId: number) => string;
  onUpload: (files: File[]) => void;
  onRemove: (documentId: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <Divider titlePlacement="start" plain style={{ marginTop: 8 }}>
        {labels.title}
      </Divider>
      <List
        size="small"
        loading={isLoading}
        dataSource={documents}
        locale={{ emptyText: labels.emptyText }}
        renderItem={(doc) => (
          <List.Item
            actions={[
              <Popconfirm
                key="delete"
                title={t('fleet_admin.delete_document_confirm')}
                okText={t('common.delete')}
                cancelText={t('common.cancel')}
                onConfirm={() => onRemove(doc.id)}
              >
                <Button size="small" danger type="text" icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <Space size={6}>
              <FileOutlined />
              {/* Same-origin authenticated download — the httpOnly cookie rides along. */}
              <a href={documentUrl(doc.id)} target="_blank" rel="noreferrer">
                {doc.original_filename}
              </a>
              <Text type="secondary">{Math.round(doc.size_bytes / 1024)} KB</Text>
            </Space>
          </List.Item>
        )}
      />
      <SelectionUpload
        label={labels.uploadLabel}
        hint={labels.hint}
        loading={isUploading}
        onSelect={onUpload}
      />
    </>
  );
}

/**
 * Scan picker for an ADD dialog, where no record exists yet.
 *
 * Files are held in the parent's state and POSTed once the create call returns
 * an id. Same accept list and same one-request-per-selection rule as
 * `FleetDocumentsPanel`, so a batch is still validated as a batch server-side.
 */
export function PendingDocumentsPicker({
  labels,
  files,
  onChange,
}: {
  labels: IFleetDocumentLabels;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <Divider titlePlacement="start" plain style={{ marginTop: 8 }}>
        {labels.title}
      </Divider>
      <List
        size="small"
        dataSource={files}
        locale={{ emptyText: labels.emptyText }}
        renderItem={(file, index) => (
          <List.Item
            actions={[
              <Button
                key="remove"
                size="small"
                danger
                type="text"
                icon={<DeleteOutlined />}
                aria-label={t('common.delete')}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              />,
            ]}
          >
            <Space size={6}>
              <FileOutlined />
              {file.name}
              <Text type="secondary">{Math.round(file.size / 1024)} KB</Text>
            </Space>
          </List.Item>
        )}
      />
      <SelectionUpload
        label={labels.uploadLabel}
        hint={labels.hint}
        onSelect={(selected) => onChange([...files, ...selected])}
      />
    </>
  );
}
