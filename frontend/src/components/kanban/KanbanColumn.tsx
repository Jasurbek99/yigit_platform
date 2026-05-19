import { Badge, Empty, Typography } from 'antd';
import React from 'react';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

export interface IKanbanColumnProps {
  title: string;
  count: number;
  children: React.ReactNode;
  /** Drop handler — when set, the column becomes a drop target */
  onDrop?: (e: React.DragEvent) => void;
  /** Optional CSS colour for the column header accent bar */
  accentColor?: string;
  emptyText?: string;
}

/**
 * A reusable kanban column shell shared by D2 (SelfBoard) and D3 (ShipmentBoard).
 * Uses plain HTML5 drag-and-drop; no external library.
 */
export function KanbanColumn({
  title,
  count,
  children,
  onDrop,
  accentColor = COLORS.borderLight,
  emptyText,
}: IKanbanColumnProps) {
  const isDroppable = !!onDrop;

  function handleDragOver(e: React.DragEvent) {
    if (isDroppable) {
      e.preventDefault();
    }
  }

  function handleDrop(e: React.DragEvent) {
    if (onDrop) {
      onDrop(e);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 240,
        maxWidth: 280,
        flex: '0 0 auto',
        background: COLORS.bgLayout,
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        overflow: 'hidden',
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Column header with accent bar */}
      <div
        style={{
          borderTop: `3px solid ${accentColor}`,
          padding: '10px 14px 8px',
          background: COLORS.white,
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Text strong style={{ fontSize: 13 }}>
          {title}
        </Text>
        <Badge
          count={count}
          showZero
          style={{
            backgroundColor: COLORS.bgLight,
            color: COLORS.textTertiary,
            boxShadow: 'none',
            fontSize: 11,
          }}
        />
      </div>

      {/* Card area — scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minHeight: 120,
        }}
      >
        {count === 0 && emptyText ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {emptyText}
              </Text>
            }
            style={{ margin: '24px 0' }}
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
