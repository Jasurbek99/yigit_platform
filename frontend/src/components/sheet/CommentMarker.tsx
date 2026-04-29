import { CommentOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import type { ICommentTaskStatus } from '@/types';

interface ICommentMarkerProps {
  count: number;
  taskState?: ICommentTaskStatus | null;
  /** When true and count===0, show a faint hover-only icon as an "add comment" hint */
  showHoverHint?: boolean;
  onClick: (e: React.MouseEvent) => void;
}

const COLOR_MAP: Record<string, string> = {
  open: '#fa8c16',
  done: '#52c41a',
  comment: '#1677ff',
};

export function CommentMarker({ count, taskState, showHoverHint = false, onClick }: ICommentMarkerProps) {
  const { t } = useTranslation();

  // No existing comment — render a faint hover hint icon if enabled.
  if (count <= 0) {
    if (!showHoverHint) return null;
    return (
      <Tooltip title={t('comments.add_to_cell')} mouseEnterDelay={0.4}>
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
            color: '#bfbfbf',
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
      </Tooltip>
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
        color: '#fff',
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
