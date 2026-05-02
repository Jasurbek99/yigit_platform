import { useEffect, useMemo, useRef, useCallback } from 'react';
import { Spin, message } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShipmentSheet } from '@/hooks/useShipmentSheet';
import { useSheetStore } from '@/stores/sheetStore';
import {
  useUserSheetPreferences,
  useSaveUserSheetPreferences,
  useDebouncedSaveSheetOrder,
  useUserSheetPrefsBroadcast,
} from '@/hooks/useUserSheetPreferences';
import { SheetToolbar } from '@/components/sheet/SheetToolbar';
import { SheetGrid } from '@/components/sheet/SheetGrid';
import { CommentsDrawer } from '@/components/sheet/CommentsDrawer';
import '@/components/sheet/SheetStyles.css';

export default function ShipmentSheet() {
  const { t } = useTranslation();
  const { data, isLoading } = useShipmentSheet();
  const shipments = data?.shipments;
  const commentCounts = data?.comment_counts ?? {};
  const taskCounts = data?.task_counts ?? {};
  const rows = data?.rows ?? [];
  const rowSettings = data?.row_settings ?? {};
  const lastEdits = data?.last_edits ?? {};
  const currentUserLang = data?.current_user_lang ?? 'tk';
  // Phase 2a: per-user row preferences fetched from their own endpoint
  // (with Phase 2b IndexedDB read-through). Separate from the sheet payload
  // so they can be invalidated independently.
  const { data: userPrefs } = useUserSheetPreferences();
  const userPreferences = {
    row_order: userPrefs?.row_order ?? [],
    hidden_rows: userPrefs?.hidden_rows ?? [],
  };

  // Phase 2b: subscribe to cross-tab BroadcastChannel pulses. A save in
  // another tab arrives here as a query invalidation → instant rerender.
  useUserSheetPrefsBroadcast();

  const {
    searchText,
    showGapyOnly,
    commentsDrawerOpen,
    setCommentsDrawerOpen,
    setCommentsShipmentId,
    setCommentsFilter,
    setActiveCell,
    setPendingHighlightCommentId,
    openCommentsForCell,
    setRows,
  } = useSheetStore();

  // ─── Phase 2a: derive field_key → SheetRowSetting.id from the payload ─────
  // The /sheet/ payload emits `id` inside row_settings[fk] (since the N1 backend
  // follow-up). Build the bidirectional map locally — no extra round-trip.
  const fieldKeyToRowId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [fk, setting] of Object.entries(rowSettings)) {
      if (setting?.id != null) {
        map[fk] = setting.id;
      }
    }
    return map;
  }, [rowSettings]);

  // ─── Phase 2a: reorder + hide mutations ──────────────────────────────────
  const savePrefs = useSaveUserSheetPreferences();
  const debouncedSaveOrder = useDebouncedSaveSheetOrder(500);

  const handleReorder = useCallback(
    (newRowOrder: number[]) => {
      debouncedSaveOrder({ row_order: newRowOrder });
    },
    [debouncedSaveOrder],
  );

  const handleHideRow = useCallback(
    (rowId: number) => {
      // Compute new hidden_rows = current + this row (deduped)
      const current = userPreferences.hidden_rows;
      const newHidden = Array.from(new Set([...current, rowId]));
      // Immediate PATCH — hide is a rare action, debounce not needed
      savePrefs.mutate({ hidden_rows: newHidden });
      message.success(t('sheet.row_hidden_toast'));
    },
    [savePrefs, userPreferences.hidden_rows, t],
  );

  const handleUnhideRow = useCallback(
    (rowId: number) => {
      // Compute new hidden_rows = current − this row
      const newHidden = userPreferences.hidden_rows.filter((id) => id !== rowId);
      savePrefs.mutate({ hidden_rows: newHidden });
    },
    [savePrefs, userPreferences.hidden_rows],
  );

  // Sync rows into the store so deep components (CommentItem, MentionPopover)
  // can read the row map without prop-drilling.
  const prevRowsRef = useRef<typeof rows | null>(null);
  useEffect(() => {
    if (rows.length > 0 && rows !== prevRowsRef.current) {
      prevRowsRef.current = rows;
      setRows(rows);
    }
  }, [rows, setRows]);

  const [searchParams] = useSearchParams();

  // Deep-link: ?shipment=N&row=fieldKey&comment=N
  useEffect(() => {
    const shipmentParam = searchParams.get('shipment');
    const rowParam = searchParams.get('row');
    const commentParam = searchParams.get('comment');

    if (shipmentParam) {
      const shipmentId = parseInt(shipmentParam, 10);
      if (!isNaN(shipmentId)) {
        if (rowParam) {
          setActiveCell({ shipmentId, rowKey: rowParam });
          openCommentsForCell(shipmentId, rowParam);
        } else {
          setCommentsShipmentId(shipmentId);
          setCommentsDrawerOpen(true);
          setCommentsFilter({});
        }
        if (commentParam) {
          const commentId = parseInt(commentParam, 10);
          if (!isNaN(commentId)) {
            setPendingHighlightCommentId(commentId);
          }
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  const filtered = useMemo(() => {
    if (!shipments) return [];
    let result = shipments;

    if (searchText) {
      const q = searchText.toLowerCase();
      result = result.filter(
        (s) =>
          s.cargo_code.toLowerCase().includes(q) ||
          s.customer_name?.toLowerCase().includes(q),
      );
    }

    if (showGapyOnly) {
      result = result.filter((s) => s.is_gapy_satys);
    }

    return result;
  }, [shipments, searchText, showGapyOnly]);

  if (isLoading) {
    return (
      <div className="sheet-page page-fullheight-grid">
        <div className="sheet-loading">
          <Spin size="large" />
        </div>
      </div>
    );
  }

  return (
    <div className="sheet-page page-fullheight-grid" style={{ position: 'relative' }}>
      <SheetToolbar
        shipments={filtered}
        rows={rows}
        taskCounts={taskCounts}
        currentUserLang={currentUserLang}
        hiddenRowIds={userPreferences.hidden_rows}
        fieldKeyToRowId={fieldKeyToRowId}
        onUnhideRow={handleUnhideRow}
      />
      <SheetGrid
        shipments={filtered}
        rows={rows}
        commentCounts={commentCounts}
        taskCounts={taskCounts}
        rowSettings={rowSettings}
        lastEdits={lastEdits}
        currentUserLang={currentUserLang}
        fieldKeyToRowId={fieldKeyToRowId}
        onReorder={handleReorder}
        onHideRow={handleHideRow}
      />
      <CommentsDrawer
        open={commentsDrawerOpen}
        onClose={() => setCommentsDrawerOpen(false)}
      />
    </div>
  );
}
