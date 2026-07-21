import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { FieldEditor } from '@/components/FieldEditor';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';
import { COLORS } from '@/constants/styles';

const { Text } = Typography;

interface IDetailFieldValueProps {
  config: IEditFieldConfig;
  showEditor: boolean;
  canEdit: boolean;
  isBoolean: boolean;
  draft: unknown;
  persisted: unknown;
  format?: (value: unknown) => string;
  countryId: number | null;
  defaultOpen: boolean;
  onChange: (next: unknown) => void;
  onEnterEdit: () => void;
  /**
   * The save-state indicator (DetailFieldRowStatus), passed in as a node so
   * it renders between the value and the comment icon — preserving
   * DetailFieldRow's original DOM order without this component needing to
   * know anything about save state.
   */
  statusSlot: ReactNode;
  /** Opens this field's comments thread. Omit to hide the 💬 icon entirely. */
  onOpenComments?: () => void;
  /** Live comment count for this field, shown next to the 💬 icon. */
  commentCount: number;
}

/**
 * The read-vs-edit value cell for a DetailFieldRow: plain text until clicked
 * (click-to-edit), then swaps to FieldEditor; plus the per-field comment
 * affordance. Booleans render FieldEditor from the very first render
 * (showEditor is already true for them) since the Switch click IS the edit.
 */
export function DetailFieldValue({
  config,
  showEditor,
  canEdit,
  isBoolean,
  draft,
  persisted,
  format,
  countryId,
  defaultOpen,
  onChange,
  onEnterEdit,
  statusSlot,
  onOpenComments,
  commentCount,
}: IDetailFieldValueProps) {
  return (
    <>
      {showEditor ? (
        <div style={{ flex: 1, minWidth: 0 }}>
          <FieldEditor
            config={config}
            value={draft}
            onChange={onChange}
            countryId={countryId}
            // Deliberately NOT disabling on patch.isPending. If we did, every
            // keystroke that triggers a save would lock the input mid-word.
            // autoFocus only for non-boolean rows: booleans never pass
            // through onEnterEdit (showEditor is true for them from first
            // render via isBoolean), so autoFocus here would steal focus
            // and scroll every boolean row's Switch into view on page load.
            // FieldEditor's boolean case also refuses to forward autoFocus
            // (see its comment) — this is defense in depth, not a duplicate
            // of the only guard.
            autoFocus={!isBoolean}
            defaultOpen={defaultOpen}
          />
        </div>
      ) : (
        <Text
          onClick={onEnterEdit}
          tabIndex={canEdit ? 0 : -1}
          onFocus={onEnterEdit}
          style={{
            fontSize: 13,
            flex: 1,
            cursor: canEdit ? 'text' : 'default',
            color: persisted == null || persisted === '' ? COLORS.textTertiary : undefined,
          }}
        >
          {format ? format(persisted) : (persisted as string | number | null) ?? '—'}
        </Text>
      )}
      {statusSlot}
      {onOpenComments && (
        <span
          onClick={onOpenComments}
          style={{
            fontSize: 11,
            cursor: 'pointer',
            color: commentCount > 0 ? COLORS.primary : COLORS.textMuted,
            opacity: commentCount > 0 ? 1 : 0,
          }}
          className="detail-row-comment"
        >
          💬{commentCount > 0 ? ` ${commentCount}` : ''}
        </span>
      )}
    </>
  );
}
