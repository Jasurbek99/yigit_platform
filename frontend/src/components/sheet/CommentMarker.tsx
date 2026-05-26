import { CommentOutlined } from '@ant-design/icons';
import type { ICommentTaskStatus } from '@/types';
import { COLORS } from '@/constants/styles';

interface ICommentMarkerProps {
  count: number;
  taskState?: ICommentTaskStatus | null;
  /** When true and count===0, show a faint hover-only icon as an "add comment" hint */
  showHoverHint?: boolean;
  onClick: (e: React.MouseEvent) => void;
}

const COLOR_MAP: Record<string, string> = {
  open: COLORS.orange,
  done: COLORS.success,
  comment: COLORS.primary,
};

export function CommentMarker({ count, taskState, showHoverHint = false, onClick }: ICommentMarkerProps) {
  // No existing comment — render a faint hover hint icon if enabled.
  // Native `title` (no antd <Tooltip>): this branch renders for ~95% of cells
  // in a fresh sheet, so an antd Tooltip here was the single biggest mount cost
  // during horizontal scroll. The chat icon is self-explanatory.
  if (count <= 0) {
    if (!showHoverHint) return null;
    return (
      <div
        className="sheet-cell__comment-hint"
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        style={{
          position: 'absolute',
          top: 2,
          right: 2,
          width: 14,
          height: 14,
          borderRadius: 7,
          color: COLORS.textMuted,
          fontSize: 10,
          lineHeight: '14px',
          textAlign: 'center',
          cursor: 'pointer',
          zIndex: 2,
          userSelect: 'none',
        }}
      >
        <CommentOutlined />
      </div>
    );
  }

  const color = taskState === 'open'
    ? COLOR_MAP.open
    : taskState === 'done'
      ? COLOR_MAP.done
      : COLOR_MAP.comment;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      style={{
        position: 'absolute',
        top: 2,
        right: 2,
        minWidth: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: color,
        color: COLORS.white,
        fontSize: 9,
        fontWeight: 700,
        lineHeight: '14px',
        textAlign: 'center',
        padding: '0 3px',
        cursor: 'pointer',
        zIndex: 2,
        userSelect: 'none',
      }}
    >
      {count}
    </div>
  );
}
