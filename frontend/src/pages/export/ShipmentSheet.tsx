import { useEffect, useMemo, useRef, useCallback } from 'react';
import { Spin, Button, Tooltip } from 'antd';
import { FullscreenExitOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
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
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const rowSettings = useMemo(() => data?.row_settings ?? {}, [data?.row_settings]);
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

  // Granular selectors only. A bare useSheetStore() here re-renders the whole
  // page — and the non-memoized SheetGrid beneath it — on every store change,
  // including activeCell updates that fire on each cell click. Reactive reads
  // are limited to the three values this page actually renders against;
  // setters are stable refs and never trigger a re-render.
  const searchText = useSheetStore((s) => s.searchText);
  const showGapyOnly = useSheetStore((s) => s.showGapyOnly);
  const commentsDrawerOpen = useSheetStore((s) => s.commentsDrawerOpen);
  const setCommentsDrawerOpen = useSheetStore((s) => s.setCommentsDrawerOpen);
  const setCommentsShipmentId = useSheetStore((s) => s.setCommentsShipmentId);
  const setCommentsFilter = useSheetStore((s) => s.setCommentsFilter);
  const setActiveCell = useSheetStore((s) => s.setActiveCell);
  const setPendingHighlightCommentId = useSheetStore((s) => s.setPendingHighlightCommentId);
  const openCommentsForCell = useSheetStore((s) => s.openCommentsForCell);
  const setRows = useSheetStore((s) => s.setRows);
  const sheetFullscreen = useSheetStore((s) => s.sheetFullscreen);
  const setSheetFullscreen = useSheetStore((s) => s.setSheetFullscreen);

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
      toast.success(t('sheet.row_hidden_toast'));
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

  // Fullscreen: Esc exits; always exit on unmount so navigating away can't
  // leave the store stuck in fullscreen (the overlay only renders on this page,
  // but the flag would persist otherwise).
  useEffect(() => {
    if (!sheetFullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetFullscreen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [sheetFullscreen, setSheetFullscreen]);

  useEffect(() => () => setSheetFullscreen(false), [setSheetFullscreen]);

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
    <div
      className={`sheet-page page-fullheight-grid${sheetFullscreen ? ' sheet-page--fullscreen' : ''}`}
      style={{ position: 'relative' }}
    >
      {sheetFullscreen ? (
        <Tooltip title={t('sheet.fullscreen_exit')} placement="left">
          <Button
            className="sheet-fullscreen-exit"
            shape="circle"
            icon={<FullscreenExitOutlined />}
            onClick={() => setSheetFullscreen(false)}
            aria-label={t('sheet.fullscreen_exit')}
          />
        </Tooltip>
      ) : (
        <SheetToolbar
          shipments={filtered}
          rows={rows}
          taskCounts={taskCounts}
          currentUserLang={currentUserLang}
          hiddenRowIds={userPreferences.hidden_rows}
          fieldKeyToRowId={fieldKeyToRowId}
          onUnhideRow={handleUnhideRow}
        />
      )}
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
