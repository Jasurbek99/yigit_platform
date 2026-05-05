import { useEffect, useRef, useState } from 'react';
import { Upload, Button, message, Spin, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { IconCamera, IconTrash, IconClipboard } from '@tabler/icons-react';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface IScreenshotInputProps {
  files: File[];
  onChange: (files: File[]) => void;
  maxFiles?: number;
  maxSizeBytes?: number;
}

// ─── Internal: thumbnail strip ────────────────────────────────────────────────

interface IScreenshotThumbnailsProps {
  files: File[];
  getObjectUrl: (file: File) => string;
  onRemove: (index: number) => void;
}

function ScreenshotThumbnails({
  files,
  getObjectUrl,
  onRemove,
}: IScreenshotThumbnailsProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (files.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      {files.map((file, index) => (
        <div
          key={index}
          style={{
            position: 'relative',
            width: 80,
            height: 80,
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid #d9d9d9',
          }}
        >
          <img
            src={getObjectUrl(file)}
            alt={file.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label={t('feedback.attachment.remove')}
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              background: 'rgba(0,0,0,0.55)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconTrash size={12} color="#fff" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── ScreenshotInput ──────────────────────────────────────────────────────────

export function ScreenshotInput({
  files,
  onChange,
  maxFiles = DEFAULT_MAX_FILES,
  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
}: IScreenshotInputProps): React.ReactElement {
  const { t } = useTranslation();
  const [capturing, setCapturing] = useState(false);
  // Object URLs for thumbnails — we create and revoke them ourselves.
  const objectUrlsRef = useRef<Map<File, string>>(new Map());

  // Revoke orphaned object URLs whenever the files array shrinks
  // (covers removal, form reset, and multi-submit without leaving the page).
  useEffect(() => {
    const live = new Set(files);
    for (const [file, url] of objectUrlsRef.current.entries()) {
      if (!live.has(file)) {
        URL.revokeObjectURL(url);
        objectUrlsRef.current.delete(file);
      }
    }
  }, [files]);

  // Revoke all remaining URLs on unmount.
  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  function getObjectUrl(file: File): string {
    if (!objectUrlsRef.current.has(file)) {
      objectUrlsRef.current.set(file, URL.createObjectURL(file));
    }
    return objectUrlsRef.current.get(file)!;
  }

  function revokeObjectUrl(file: File): void {
    const url = objectUrlsRef.current.get(file);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(file);
    }
  }

  /**
   * Pure validity check — no side-effects, no toasts.
   * Used when building a batch (e.g. paste) to filter before calling onChange once.
   */
  function isValidFile(file: File): boolean {
    if (!ALLOWED_MIME_TYPES.has(file.type)) return false;
    if (file.size > maxSizeBytes) return false;
    return true;
  }

  /**
   * Single-file validate-and-toast.
   * Used for file picker / drag-drop / capture button where a per-file
   * error message is appropriate.
   */
  function validateFileSingle(file: File): boolean {
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      message.error(t('feedback.attachment.invalid_type', { name: file.name }));
      return false;
    }
    if (file.size > maxSizeBytes) {
      message.error(
        t('feedback.attachment.too_large', {
          name: file.name,
          max: Math.round(maxSizeBytes / 1024 / 1024),
        }),
      );
      return false;
    }
    if (files.length >= maxFiles) {
      message.error(t('feedback.attachment.too_many', { max: maxFiles }));
      return false;
    }
    return true;
  }

  function addFileSingle(file: File | null): void {
    if (!file) return;
    if (!validateFileSingle(file)) return;
    onChange([...files, file]);
  }

  function removeFile(index: number): void {
    const removed = files[index];
    if (removed) revokeObjectUrl(removed);
    onChange(files.filter((_, i) => i !== index));
  }

  // (C) Ctrl+V paste — accumulate all images from the clipboard event,
  // validate as a batch, call onChange exactly once.
  useEffect(() => {
    function handlePaste(e: ClipboardEvent): void {
      if (!e.clipboardData) return;
      const candidates: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) candidates.push(f);
        }
      }
      if (!candidates.length) return;

      const valid = candidates.filter(isValidFile);
      const rejected = candidates.length - valid.length;
      if (rejected > 0) {
        message.error(
          t('feedback.attachment.invalid_type', { name: t('feedback.attachment.some_files') }),
        );
      }
      if (!valid.length) return;

      // Respect maxFiles cap — take as many as fit
      const available = maxFiles - files.length;
      if (available <= 0) {
        message.error(t('feedback.attachment.too_many', { max: maxFiles }));
        return;
      }
      const toAdd = valid.slice(0, available);
      onChange([...files, ...toAdd]);
    }

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  // files/maxFiles/maxSizeBytes are deps — we re-bind when they change
  // so that the paste handler always sees the current values without stale closures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, maxFiles, maxSizeBytes]);

  // (D) Capture this screen
  async function handleCapture(): Promise<void> {
    setCapturing(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(document.body);
      canvas.toBlob((blob) => {
        if (!blob) {
          setCapturing(false);
          return;
        }
        const file = new File(
          [blob],
          `capture-${Date.now()}.png`,
          { type: 'image/png' },
        );
        addFileSingle(file);
        setCapturing(false);
      }, 'image/png');
    } catch {
      message.error(t('feedback.attachment.capture_failed'));
      setCapturing(false);
    }
  }

  return (
    <div>
      {/* (A+B) File picker + drag-and-drop */}
      <Upload.Dragger
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        showUploadList={false}
        fileList={[]}
        beforeUpload={(file) => {
          // beforeUpload is called once per file — single-file validation is correct here
          addFileSingle(file);
          return false;
        }}
        style={{ marginBottom: 8 }}
      >
        <p className="ant-upload-drag-icon">
          <IconClipboard size={24} style={{ color: '#1677ff' }} />
        </p>
        <p className="ant-upload-text" style={{ fontSize: 13 }}>
          {t('feedback.attachment.dragger_text')}
        </p>
        <p className="ant-upload-hint" style={{ fontSize: 11 }}>
          {t('feedback.attachment.dragger_hint', {
            max: maxFiles,
            size: Math.round(maxSizeBytes / 1024 / 1024),
          })}
        </p>
      </Upload.Dragger>

      {/* (D) Capture button */}
      <Tooltip title={t('feedback.attachment.capture_tooltip')}>
        <Button
          icon={capturing ? <Spin size="small" /> : <IconCamera size={14} />}
          size="small"
          onClick={handleCapture}
          disabled={capturing || files.length >= maxFiles}
          style={{ marginBottom: 8 }}
        >
          {t('feedback.attachment.capture_btn')}
        </Button>
      </Tooltip>

      {/* Thumbnail strip */}
      <ScreenshotThumbnails
        files={files}
        getObjectUrl={getObjectUrl}
        onRemove={removeFile}
      />
    </div>
  );
}
