import { useState } from 'react';
import { Popover, Tooltip, Spin, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import type { ICellLastEdit, IFieldHistoryEntry } from '@/types';
import { useFieldHistory } from '@/hooks/useFieldHistory';

const { Text } = Typography;

interface ICellLastEditMarkerProps {
  shipmentId: number;
  fieldKey: string;
  lastEdit: ICellLastEdit;
}

function formatDate(iso: string): string {
  return dayjs(iso).format('DD MMM HH:mm');
}

function HistoryPopoverContent({
  shipmentId,
  fieldKey,
  open,
}: {
  shipmentId: number;
  fieldKey: string;
  open: boolean;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useFieldHistory(shipmentId, fieldKey, open);

  if (isLoading) {
    return (
      <div style={{ padding: '8px 0', textAlign: 'center' }}>
        <Spin size="small" />
      </div>
    );
  }

  if (data?.isForbidden) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('sheet.history_forbidden')}
      </Text>
    );
  }

  const entries: IFieldHistoryEntry[] = data?.data ?? [];

  if (entries.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('sheet.history_empty')}
      </Text>
    );
  }

  return (
    <div style={{ maxWidth: 280 }}>
      {entries.map((entry, idx) => (
        <div
          key={idx}
          style={{
            borderBottom: idx < entries.length - 1 ? '1px solid #f0f0f0' : undefined,
            paddingBottom: idx < entries.length - 1 ? 6 : 0,
            marginBottom: idx < entries.length - 1 ? 6 : 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <Text strong style={{ fontSize: 12 }}>{entry.user_name}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{formatDate(entry.edited_at)}</Text>
          </div>
          <div style={{ fontSize: 12, color: '#595959' }}>
            <Text delete style={{ fontSize: 12, color: '#8c8c8c' }}>{entry.old_value || '—'}</Text>
            <Text style={{ margin: '0 4px', color: '#8c8c8c' }}>→</Text>
            <Text style={{ fontSize: 12, color: '#262626' }}>{entry.new_value || '—'}</Text>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Small clock-icon badge shown in the bottom-right corner of a cell when it
 * has been edited. Hover shows a one-line tooltip with the latest edit.
 * Clicking opens an Ant Popover with full history (lazy-fetched on first open).
 *
 * Positioned at bottom-right to avoid overlapping CommentMarker at top-right.
 */
export function CellLastEditMarker({ shipmentId, fieldKey, lastEdit }: ICellLastEditMarkerProps) {
  const { t } = useTranslation();
  const [popoverOpen, setPopoverOpen] = useState(false);

  const tooltipTitle = t('sheet.last_edit_tooltip', {
    user: lastEdit.user_name,
    date: formatDate(lastEdit.edited_at),
    old: lastEdit.old_value || '—',
    new: lastEdit.new_value || '—',
  });

  const markerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#595959',
    color: '#fff',
    fontSize: 9,
    lineHeight: '14px',
    textAlign: 'center',
    cursor: 'pointer',
    zIndex: 2,
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
      trigger="click"
      title={t('sheet.history_title')}
      content={
        <HistoryPopoverContent
          shipmentId={shipmentId}
          fieldKey={fieldKey}
          open={popoverOpen}
        />
      }
      placement="bottomRight"
      destroyTooltipOnHide
    >
      <Tooltip title={tooltipTitle} mouseEnterDelay={0.3}>
        <div
          style={markerStyle}
          onClick={(e) => {
            e.stopPropagation();
            setPopoverOpen((prev) => !prev);
          }}
        >
          <HistoryOutlined style={{ fontSize: 9 }} />
        </div>
      </Tooltip>
    </Popover>
  );
}
