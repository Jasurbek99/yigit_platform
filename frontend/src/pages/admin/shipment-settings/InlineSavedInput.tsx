import { useEffect, useRef, useState } from 'react';
import { Input } from 'antd';
import type { InputRef } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';

interface IInlineSavedInputProps {
  /** Current persisted value from the parent. */
  value: string;
  /** Called only on blur / Enter when the value has actually changed. */
  onSave: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  addonBefore?: React.ReactNode;
  /** ant-design size */
  size?: 'small' | 'middle' | 'large';
  /** When true, render Input.TextArea instead of Input. Enter no longer commits
   *  (it inserts a newline); save fires on blur only. */
  multiline?: boolean;
  /** Visible rows when multiline. */
  rows?: number;
}

/**
 * Spreadsheet-style inline editor: typing only updates the local state.
 * The save callback fires once on blur OR Enter (single-line mode), and only
 * when the value actually differs from the last saved value. Avoids two
 * foot-guns of the naive `<Input value={record.x} onChange={(e) =>
 * debouncedSave(e.target.value)} />` pattern:
 *
 *   1. The controlled `value` prop is bound to the parent's record. After a
 *      PATCH succeeds and TanStack Query refetches, the parent re-renders
 *      and the input's `value` snaps back to the server's copy mid-typing,
 *      causing flash / cursor jumps.
 *   2. Saving on every keystroke (even debounced) makes admins feel like
 *      the system is watching their typing — rapid-fire toasts and audit
 *      log spam.
 *
 * External updates (another tab edited the same row, or the parent loaded
 * fresh data) DO propagate into the local draft, but only when the input
 * is NOT focused — typing is never interrupted.
 *
 * In `multiline` mode, Enter inserts a newline (standard textarea behavior)
 * and save fires on blur only.
 */
export function InlineSavedInput({
  value,
  onSave,
  disabled,
  placeholder,
  addonBefore,
  size = 'small',
  multiline = false,
  rows = 2,
}: IInlineSavedInputProps) {
  const [draft, setDraft] = useState<string>(value ?? '');
  const inputRef = useRef<InputRef | null>(null);
  const textAreaRef = useRef<TextAreaRef | null>(null);
  // Tracks the last value we actually pushed via onSave, updated synchronously
  // so we can short-circuit a duplicate commit. Without this, hitting Enter
  // calls commit() and then synchronously blurs the input, which fires
  // onBlur={commit} a second time. The mutation is still in-flight at that
  // point so the parent's `value` prop is stale, and `draft !== value` is
  // still true — the naive guard would fire a second identical PATCH and
  // duplicate the AuditLog row.
  const lastSavedRef = useRef<string>(value ?? '');

  // Pull external changes into the local draft only while the input is NOT
  // focused. If the user is typing, their work isn't clobbered.
  useEffect(() => {
    const activeEl = document.activeElement;
    const focused =
      inputRef.current?.input === activeEl ||
      textAreaRef.current?.resizableTextArea?.textArea === activeEl;
    if (!focused && value !== draft) {
      setDraft(value ?? '');
      // Keep the ref aligned with what the server believes the value is —
      // otherwise a subsequent commit could compare against a stale ref and
      // re-PATCH the same string we just pulled in.
      lastSavedRef.current = value ?? '';
    }
    // We intentionally exclude `draft` from deps — it changes on every
    // keypress, and re-running this effect every keystroke would compete
    // with the user's input. We only react to external `value` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = () => {
    if (draft !== lastSavedRef.current) {
      lastSavedRef.current = draft;
      onSave(draft);
    }
  };

  if (multiline) {
    return (
      <Input.TextArea
        ref={textAreaRef}
        size={size}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    );
  }

  return (
    <Input
      ref={inputRef}
      size={size}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      addonBefore={addonBefore}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onPressEnter={() => {
        commit();
        // Move focus away so the user gets visual confirmation the value
        // committed. Without this, hitting Enter feels like nothing happened.
        inputRef.current?.blur();
      }}
    />
  );
}
