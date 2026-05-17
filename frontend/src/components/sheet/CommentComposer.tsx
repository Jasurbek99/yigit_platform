import { useState, useRef, useCallback } from 'react';
import { Button, Switch, Select } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { IShipmentComment } from '@/types';
import { useCreateComment } from '@/hooks/useComments';
import { useMentionable } from '@/hooks/useMentionable';
import { useSheetStore } from '@/stores/sheetStore';
import { MentionPopover } from './MentionPopover';

interface ICommentComposerProps {
  shipmentId: number;
  parentComment?: IShipmentComment | null;
  onSubmit?: () => void;
}

type PopoverMode = 'users-or-roles' | 'cells';

export function CommentComposer({ shipmentId, parentComment = null, onSubmit }: ICommentComposerProps) {
  const { t } = useTranslation();
  const { activeCell } = useSheetStore();

  const [content, setContent] = useState('');
  const [mentionIds, setMentionIds] = useState<number[]>([]);
  const [roleMentions, setRoleMentions] = useState<string[]>([]);
  const [assignee, setAssignee] = useState<number | null>(null);
  const [pinToActiveCell, setPinToActiveCell] = useState(true);

  // Popover state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverMode, setPopoverMode] = useState<PopoverMode>('users-or-roles');
  const [mentionQuery, setMentionQuery] = useState('');
  const [triggerStart, setTriggerStart] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const createMutation = useCreateComment();
  const { users, roles, isLoading: mentionLoading } = useMentionable(mentionQuery);
  const { users: assigneeUsers } = useMentionable('');

  const isReply = parentComment !== null;

  const fieldKey = !isReply && pinToActiveCell && activeCell?.shipmentId === shipmentId
    ? activeCell.rowKey
    : undefined;

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed || !shipmentId) return;

    createMutation.mutate(
      {
        shipment: shipmentId,
        content: trimmed,
        field_key: fieldKey ?? null,
        mentions: mentionIds,
        role_mentions: roleMentions,
        parent_comment: parentComment?.id ?? null,
        assignee: isReply ? null : assignee,
      },
      {
        onSuccess: () => {
          setContent('');
          setMentionIds([]);
          setRoleMentions([]);
          setAssignee(null);
          if (assignee != null) {
            toast.success(t('comments.toast_assigned'));
          }
          onSubmit?.();
        },
        onError: () => {
          toast.error(t('comments.toast_create_error'));
        },
      },
    );
  }, [content, shipmentId, fieldKey, mentionIds, roleMentions, parentComment?.id, isReply, assignee, createMutation, t, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Ctrl+Enter
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart;
    const char = e.key;

    if (char === '@') {
      setTriggerStart(pos + 1);
      setMentionQuery('');
      setPopoverMode('users-or-roles');
      setPopoverOpen(true);
    } else if (char === '#') {
      setTriggerStart(pos + 1);
      setMentionQuery('');
      setPopoverMode('cells');
      setPopoverOpen(true);
    } else if (popoverOpen) {
      if (char === ' ' || char === 'Enter') {
        setPopoverOpen(false);
      }
    }
  }, [popoverOpen, handleSubmit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    if (popoverOpen && triggerStart !== null) {
      const pos = e.target.selectionStart;
      if (pos < triggerStart) {
        setPopoverOpen(false);
        return;
      }
      const fragment = val.slice(triggerStart, pos);
      setMentionQuery(fragment);
    }
  }, [popoverOpen, triggerStart]);

  const handlePick = useCallback((token: string, _displayText: string, id?: number) => {
    if (!textareaRef.current || triggerStart === null) return;

    const textarea = textareaRef.current;
    const pos = textarea.selectionStart;
    const before = content.slice(0, triggerStart - 1); // strip trigger char
    const after = content.slice(pos);
    const newContent = `${before}${token} ${after}`;

    setContent(newContent);

    if (token.startsWith('@user:') && id != null) {
      setMentionIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    } else if (token.startsWith('@role:')) {
      const code = token.slice(6);
      setRoleMentions((prev) => prev.includes(code) ? prev : [...prev, code]);
    }

    setPopoverOpen(false);
    setTriggerStart(null);

    // Move cursor after inserted token
    const newPos = before.length + token.length + 1;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  }, [content, triggerStart]);

  const assigneeOptions = assigneeUsers.map((u) => ({ value: u.id, label: u.name }));

  return (
    <div style={{ borderTop: '1px solid #f0f0f0', padding: '8px 12px', background: '#fafafa' }}>
      {/* Cell pin toggle (root comments only) */}
      {!isReply && activeCell?.shipmentId === shipmentId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 12 }}>
          <Switch size="small" checked={pinToActiveCell} onChange={setPinToActiveCell} />
          <span style={{ color: '#595959' }}>
            {t('comments.pin_to_cell')}
            {pinToActiveCell && fieldKey && (
              <span style={{ marginLeft: 4, color: '#1677ff' }}>({fieldKey})</span>
            )}
          </span>
        </div>
      )}

      {/* Assignee picker (root comments only) */}
      {!isReply && (
        <div style={{ marginBottom: 6 }}>
          <Select
            style={{ width: '100%' }}
            size="small"
            placeholder={t('comments.assign_to')}
            options={assigneeOptions}
            value={assignee}
            onChange={setAssignee}
            allowClear
            showSearch
            filterOption={(input, option) =>
              (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </div>
      )}

      {/* Text input + popover anchor */}
      <div ref={containerRef} style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t('comments.compose_placeholder')}
          rows={2}
          style={{
            width: '100%',
            resize: 'vertical',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 13,
            outline: 'none',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />

        <MentionPopover
          open={popoverOpen}
          mode={popoverMode}
          query={mentionQuery}
          users={users}
          roles={roles}
          isLoading={mentionLoading}
          onPick={handlePick}
          onClose={() => setPopoverOpen(false)}
        />
      </div>

      {/* Submit button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <Button
          type="primary"
          size="small"
          icon={<SendOutlined />}
          loading={createMutation.isPending}
          disabled={!content.trim()}
          onClick={handleSubmit}
        >
          {t('comments.send')}
        </Button>
      </div>
    </div>
  );
}
