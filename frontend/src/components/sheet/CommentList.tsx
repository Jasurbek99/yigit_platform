import { useEffect, useRef, useState } from 'react';
import { Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { IShipmentComment, ICommentFilter } from '@/types';
import { useComments } from '@/hooks/useComments';
import { useSheetStore } from '@/stores/sheetStore';
import { CommentItem } from './CommentItem';
import { CommentComposer } from './CommentComposer';

const { Text } = Typography;

interface ICommentListProps {
  shipmentId: number;
  filter: ICommentFilter;
}

function CommentThread({
  root,
  shipmentId,
  highlightId,
  onHighlightCleared,
}: {
  root: IShipmentComment;
  shipmentId: number;
  highlightId: number | null;
  onHighlightCleared: () => void;
}) {
  const { data: replies = [], isLoading } = useComments({
    shipment: shipmentId,
    parent_comment: root.id,
  });
  const [replyingTo, setReplyingTo] = useState<IShipmentComment | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightId === root.id && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(onHighlightCleared, 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightId, root.id, onHighlightCleared]);

  return (
    <div style={{ marginBottom: 12 }}>
      <div ref={highlightId === root.id ? highlightRef : undefined}>
        <CommentItem
          comment={root}
          shipmentId={shipmentId}
          isHighlighted={highlightId === root.id}
          onReply={(parent) => setReplyingTo(parent === replyingTo ? null : parent)}
        />
      </div>

      {/* Replies */}
      {isLoading ? (
        <div style={{ paddingLeft: 24 }}><Spin size="small" /></div>
      ) : (
        replies.map((reply) => (
          <div
            key={reply.id}
            ref={highlightId === reply.id ? highlightRef : undefined}
          >
            <CommentItem
              comment={reply}
              shipmentId={shipmentId}
              isReply
              isHighlighted={highlightId === reply.id}
            />
          </div>
        ))
      )}

      {/* Inline reply composer */}
      {replyingTo && (
        <div style={{ paddingLeft: 24 }}>
          <CommentComposer
            shipmentId={shipmentId}
            parentComment={replyingTo}
            onSubmit={() => setReplyingTo(null)}
          />
        </div>
      )}
    </div>
  );
}

export function CommentList({ shipmentId, filter }: ICommentListProps) {
  const { t } = useTranslation();
  const { pendingHighlightCommentId, setPendingHighlightCommentId } = useSheetStore();

  const queryFilters = {
    shipment: shipmentId,
    field_key: filter.fieldKey,
    assignee: filter.assigneeMe ? ('me' as const) : undefined,
    is_done: filter.taskStatus === 'done' ? true : filter.taskStatus === 'open' ? false : undefined,
    parent_comment: 'null' as const,
  };

  const { data: roots = [], isLoading } = useComments(queryFilters);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
        <Spin />
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>{t('comments.empty_thread')}</Text>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 12px', overflowY: 'auto', flex: 1 }}>
      {roots.map((root) => (
        <CommentThread
          key={root.id}
          root={root}
          shipmentId={shipmentId}
          highlightId={pendingHighlightCommentId}
          onHighlightCleared={() => setPendingHighlightCommentId(null)}
        />
      ))}
    </div>
  );
}
