import { useRef, useState } from 'react';
import { Input, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IInlineEditProps {
  value: string | null;
  onSave: (value: string) => void;
  multiline?: boolean;
  /** When set, an empty value cannot be committed (the edit is discarded). */
  required?: boolean;
  /** False renders plain read-only text (no click-to-edit affordance). */
  editable?: boolean;
}

/**
 * Click-to-edit text value. In read mode it shows the value with a faint edit
 * icon; clicking turns it into an Input (or TextArea when `multiline`). The
 * edit commits on blur or Enter (single-line) and is discarded on Escape.
 * Only PATCHes (`onSave`) when the trimmed value actually changed.
 */
export function InlineEdit({
  value,
  onSave,
  multiline = false,
  required = false,
  editable = true,
}: IInlineEditProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const cancelled = useRef(false);

  function startEdit() {
    setDraft(value ?? '');
    cancelled.current = false;
    setEditing(true);
  }

  function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    setEditing(false);
    const next = draft.trim();
    if (required && !next) return;
    if (next !== (value ?? '')) onSave(next);
  }

  function cancel() {
    cancelled.current = true;
    setEditing(false);
  }

  if (!editable) {
    return value ? (
      <span style={{ whiteSpace: multiline ? 'pre-line' : undefined }}>{value}</span>
    ) : (
      <Text type="secondary">{t('common.empty')}</Text>
    );
  }

  if (!editing) {
    return (
      <span
        onClick={startEdit}
        title={t('common.click_to_edit')}
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 6,
          whiteSpace: multiline ? 'pre-line' : undefined,
        }}
      >
        {value ? value : <Text type="secondary">{t('common.empty')}</Text>}
        <EditOutlined style={{ fontSize: 11, color: COLORS.textSecondary, flexShrink: 0 }} />
      </span>
    );
  }

  const shared = {
    autoFocus: true,
    size: 'small' as const,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    },
  };

  return multiline ? (
    <Input.TextArea {...shared} autoSize={{ minRows: 2, maxRows: 6 }} />
  ) : (
    <Input {...shared} onPressEnter={(e) => (e.target as HTMLInputElement).blur()} />
  );
}
