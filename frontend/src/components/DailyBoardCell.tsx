import { useEffect, useState } from 'react';
import { InputNumber, Input } from 'antd';

// Inline-edit cells for the daily harvest board. Each holds a local draft and
// commits to the server only on blur / Enter when the value actually changed,
// so typing never fires a request per keystroke.

interface IDailyBoardNumberCellProps {
  readonly value: string | null;
  readonly disabled?: boolean;
  readonly saving?: boolean;
  readonly onCommit: (next: number | null) => void;
}

export function DailyBoardNumberCell({
  value,
  disabled,
  saving,
  onCommit,
}: IDailyBoardNumberCellProps) {
  const initial = value == null || value === '' ? null : Number(value);
  const [draft, setDraft] = useState<number | null>(initial);

  useEffect(() => {
    // re-sync when the server value changes (compute inline so `initial` isn't a dep)
    setDraft(value == null || value === '' ? null : Number(value));
  }, [value]);

  function commit(): void {
    const next = draft ?? null;
    if (next !== initial) onCommit(next);
  }

  return (
    <InputNumber
      value={draft}
      disabled={disabled || saving}
      onChange={(v) => setDraft(v as number | null)}
      onBlur={commit}
      onPressEnter={commit}
      min={0}
      controls={false}
      style={{ width: '100%' }}
      formatter={(v) => {
        const s = v === undefined || v === null ? '' : String(v);
        return s === '' ? '' : s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      }}
      parser={(v) => (v ? v.replace(/\s/g, '') : '') as unknown as number}
    />
  );
}

interface IDailyBoardTextCellProps {
  readonly value: string;
  readonly disabled?: boolean;
  readonly saving?: boolean;
  readonly placeholder?: string;
  readonly onCommit: (next: string) => void;
}

export function DailyBoardTextCell({
  value,
  disabled,
  saving,
  placeholder,
  onCommit,
}: IDailyBoardTextCellProps) {
  const [draft, setDraft] = useState<string>(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit(): void {
    if (draft.trim() !== value.trim()) onCommit(draft);
  }

  return (
    <Input.TextArea
      value={draft}
      disabled={disabled || saving}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      autoSize={{ minRows: 1, maxRows: 3 }}
      style={{ width: '100%' }}
    />
  );
}
