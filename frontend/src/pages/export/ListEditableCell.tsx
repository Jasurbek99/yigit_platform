import { useState, useRef, useEffect } from 'react';
import { DatePicker, InputNumber } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useShipmentPatch } from '@/hooks/useShipmentPatch';
import { COLORS, FONT } from '@/constants/styles';

type FieldType = 'number' | 'datetime';

interface IListEditableCellProps {
  shipmentId: number;
  fieldKey: string;
  value: number | string | null;
  type: FieldType;
  isEditable: boolean;
  display: React.ReactNode;
}

export function ListEditableCell({
  shipmentId,
  fieldKey,
  value,
  type,
  isEditable,
  display,
}: IListEditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [hover, setHover] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const patch = useShipmentPatch();

  useEffect(() => {
    if (!isEditing) return;
    const el = containerRef.current?.querySelector('input');
    if (el instanceof HTMLElement) el.focus();
  }, [isEditing]);

  if (!isEditable) {
    return <>{display}</>;
  }

  const enterEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const save = (next: unknown) => {
    if (next === value || (next == null && value == null)) {
      setIsEditing(false);
      return;
    }
    patch.mutate({ id: shipmentId, field: fieldKey, value: next });
    setIsEditing(false);
  };

  if (isEditing) {
    if (type === 'number') {
      return (
        <div ref={containerRef} onClick={stop} onDoubleClick={stop}>
          <InputNumber
            size="small"
            defaultValue={(value as number | null) ?? undefined}
            onPressEnter={(e) => save(Number((e.target as HTMLInputElement).value) || null)}
            onBlur={(e) => save(Number(e.target.value) || null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setIsEditing(false);
              }
            }}
            style={{ width: '100%' }}
          />
        </div>
      );
    }

    return (
      <div ref={containerRef} onClick={stop} onDoubleClick={stop}>
        <DatePicker
          size="small"
          showTime
          defaultValue={value ? dayjs(value as string) : undefined}
          onChange={(date) => save(date ? date.toISOString() : null)}
          onOpenChange={(open) => { if (!open) setIsEditing(false); }}
          style={{ width: '100%' }}
          autoFocus
          open
        />
      </div>
    );
  }

  return (
    <div
      onClick={enterEdit}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: 'pointer',
        padding: '2px 6px',
        margin: '-2px -6px',
        borderRadius: 4,
        background: hover ? '#f0f5ff' : undefined,
        border: hover ? '1px dashed #1677ff' : '1px solid transparent',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 22,
      }}
    >
      <span>{display}</span>
      {hover && (
        <EditOutlined
          style={{ color: COLORS.primary, fontSize: 11, fontFamily: FONT.mono }}
        />
      )}
    </div>
  );
}
