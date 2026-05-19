import { useState } from 'react';
import { Tag, Button, Popconfirm, Typography, Tooltip, Input } from 'antd';
import { CheckOutlined, ReloadOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useTranslation } from 'react-i18next';
import type { IShipmentComment } from '@/types';
import i18n from '@/i18n';
import { useUpdateComment, useDeleteComment, useMarkTaskDone, useReopenTask } from '@/hooks/useComments';
import { useAuth } from '@/hooks/useAuth';
import { useSheetStore } from '@/stores/sheetStore';
import { COLORS } from '@/constants/styles';

dayjs.extend(relativeTime);

const { Text } = Typography;

// ─── Mention token parser ──────────────────────────────────────────────────

const TOKEN_RE = /(@user:\d+|@role:[a-z_]+|#cell:[a-z_]+)/g;

interface ICommentItemProps {
  comment: IShipmentComment;
  shipmentId: number;
  isReply?: boolean;
  isHighlighted?: boolean;
  onReply?: (parent: IShipmentComment) => void;
}

function getCellLabel(fieldKey: string): string {
  // Read rows from the Zustand store (populated by ShipmentSheet on API load).
  const rows = useSheetStore.getState().rows;
  const row = rows.find((r) => r.field_key === fieldKey);
  return row ? i18n.t(row.label_key) : fieldKey;
}

function ParsedContent({
  content,
  shipmentId,
  mentionUsers = [],
  roleMentions = [],
}: {
  content: string;
  shipmentId: number;
  mentionUsers?: { id: number; name: string; role: string }[];
  roleMentions?: { code: string; label: string }[];
}) {
  const { openCommentsForCell } = useSheetStore();
  const parts = content.split(TOKEN_RE);
  const userById = new Map(mentionUsers.map((u) => [u.id, u]));
  const labelByCode = new Map(roleMentions.map((r) => [r.code, r.label]));

  return (
    <span>
      {parts.map((part, idx) => {
        if (part.startsWith('@user:')) {
          const id = parseInt(part.slice(6), 10);
          const u = userById.get(id);
          const label = u ? `@${u.name}` : `@user:${id}`;
          return (
            <Tag key={idx} color="blue" style={{ fontSize: 11, padding: '0 4px', margin: '0 1px' }}>
              {label}
            </Tag>
          );
        }
        if (part.startsWith('@role:')) {
          const code = part.slice(6);
          const label = labelByCode.get(code) ?? code;
          return (
            <Tag key={idx} color="cyan" style={{ fontSize: 11, padding: '0 4px', margin: '0 1px' }}>
              @{label}
            </Tag>
          );
        }
        if (part.startsWith('#cell:')) {
          const fieldKey = part.slice(6);
          const label = getCellLabel(fieldKey);
          return (
            <Tag
              key={idx}
              color="default"
              style={{ fontSize: 11, padding: '0 4px', margin: '0 1px', cursor: 'pointer' }}
              onClick={() => openCommentsForCell(shipmentId, fieldKey)}
            >
              {i18n.t('comments.cell_chip', { label })}
            </Tag>
          );
        }
        return <span key={idx}>{part}</span>;
      })}
    </span>
  );
}

export function CommentItem({ comment, shipmentId, isReply = false, isHighlighted = false, onReply }: ICommentItemProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const updateMutation = useUpdateComment();
  const deleteMutation = useDeleteComment();
  const markDoneMutation = useMarkTaskDone();
  const reopenMutation = useReopenTask();

  const isOwn = user?.username === comment.user_name;
  const isAssignee = user?.username === comment.assignee_name;
  const isTask = comment.assignee !== null;

  const avatarLetter = (comment.user_name[0] ?? '?').toUpperCase();

  const handleSaveEdit = () => {
    if (!editContent.trim()) return;
    updateMutation.mutate({ id: comment.id, content: editContent }, {
      onSuccess: () => setIsEditing(false),
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate(comment.id);
  };

  const handleMarkDone = () => {
    markDoneMutation.mutate(comment.id);
  };

  const handleReopen = () => {
    reopenMutation.mutate(comment.id);
  };

  if (comment.is_deleted) {
    return (
      <div style={{ padding: '4px 0', paddingLeft: isReply ? 24 : 0 }}>
        <Text type="secondary" italic style={{ fontSize: 12 }}>
          [deleted]
        </Text>
      </div>
    );
  }

  const pinnedCellLabel = comment.field_key ? getCellLabel(comment.field_key) : null;

  return (
    <div
      style={{
        paddingLeft: isReply ? 24 : 0,
        marginBottom: 8,
        padding: isHighlighted ? '6px 8px' : '4px 0',
        borderRadius: isHighlighted ? 6 : 0,
        boxShadow: isHighlighted ? '0 0 0 2px #1677ff' : undefined,
        transition: 'box-shadow 0.3s',
        background: isHighlighted ? '#f0f5ff' : undefined,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {/* Avatar */}
        <div
          style={{
            width: 24, height: 24, borderRadius: '50%',
            background: comment.is_system ? COLORS.textSecondary : COLORS.primary,
            color: COLORS.white, fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {avatarLetter}
        </div>

        <Text strong style={{ fontSize: 12 }}>{comment.user_name}</Text>
        <Tag style={{ fontSize: 10, lineHeight: '14px', padding: '0 4px', marginRight: 0 }}>
          {comment.role}
        </Tag>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {dayjs(comment.created_at).fromNow()}
        </Text>

        {/* Pinned cell chip */}
        {pinnedCellLabel && (
          <Tag color="geekblue" style={{ fontSize: 10, lineHeight: '14px', padding: '0 4px' }}>
            {t('comments.cell_chip', { label: pinnedCellLabel })}
          </Tag>
        )}
      </div>

      {/* Task badge */}
      {isTask && (
        <div style={{ marginBottom: 4 }}>
          <Tag
            color={comment.is_done ? 'success' : 'warning'}
            style={{ fontSize: 11 }}
          >
            {comment.is_done
              ? `${t('comments.task_done')} — ${comment.done_by_name ?? comment.assignee_name}`
              : `${t('comments.task_open')} → ${comment.assignee_name}`}
          </Tag>
        </div>
      )}

      {/* Body */}
      <div style={{ fontSize: 13, color: comment.is_system ? COLORS.textSecondary : undefined, fontStyle: comment.is_system ? 'italic' : undefined, marginBottom: 4, paddingLeft: 30 }}>
        {isEditing ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <Input.TextArea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              autoSize={{ minRows: 1, maxRows: 4 }}
              size="small"
            />
            <Button size="small" type="primary" onClick={handleSaveEdit} loading={updateMutation.isPending}>
              {t('common.save')}
            </Button>
            <Button size="small" onClick={() => { setIsEditing(false); setEditContent(comment.content); }}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <ParsedContent
            content={comment.content}
            shipmentId={shipmentId}
            mentionUsers={comment.mentions_users}
            roleMentions={comment.role_mentions_list}
          />
        )}
      </div>

      {/* Footer actions */}
      {!comment.is_system && !isEditing && (
        <div style={{ display: 'flex', gap: 4, paddingLeft: 30 }}>
          {!isReply && onReply && (
            <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }} onClick={() => onReply(comment)}>
              {t('comments.reply')}
            </Button>
          )}

          {isOwn && (
            <Tooltip title={t('comments.edit')}>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                style={{ padding: 0, fontSize: 11 }}
                onClick={() => setIsEditing(true)}
              />
            </Tooltip>
          )}

          {isOwn && (
            <Popconfirm
              title={t('comments.delete_confirm')}
              onConfirm={handleDelete}
              okType="danger"
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                style={{ padding: 0, fontSize: 11 }}
                loading={deleteMutation.isPending}
              />
            </Popconfirm>
          )}

          {isTask && !comment.is_done && isAssignee && (
            <Button
              type="text"
              size="small"
              icon={<CheckOutlined />}
              style={{ padding: 0, fontSize: 11, color: COLORS.success }}
              onClick={handleMarkDone}
              loading={markDoneMutation.isPending}
            >
              {t('comments.mark_done')}
            </Button>
          )}

          {isTask && comment.is_done && (isOwn || isAssignee) && (
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              style={{ padding: 0, fontSize: 11 }}
              onClick={handleReopen}
              loading={reopenMutation.isPending}
            >
              {t('comments.reopen')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
