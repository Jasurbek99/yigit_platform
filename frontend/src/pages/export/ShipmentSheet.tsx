import { useEffect, useMemo, useRef } from 'react';
import { Spin } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { useShipmentSheet } from '@/hooks/useShipmentSheet';
import { useSheetStore } from '@/stores/sheetStore';
import { SheetToolbar } from '@/components/sheet/SheetToolbar';
import { SheetGrid } from '@/components/sheet/SheetGrid';
import { CommentsDrawer } from '@/components/sheet/CommentsDrawer';
import '@/components/sheet/SheetStyles.css';

export default function ShipmentSheet() {
  const { data, isLoading } = useShipmentSheet();
  const shipments = data?.shipments;
  const commentCounts = data?.comment_counts ?? {};
  const taskCounts = data?.task_counts ?? {};
  const rows = data?.rows ?? [];
  const rowSettings = data?.row_settings ?? {};
  const lastEdits = data?.last_edits ?? {};

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
      <SheetToolbar shipments={filtered} rows={rows} taskCounts={taskCounts} />
      <SheetGrid
        shipments={filtered}
        rows={rows}
        commentCounts={commentCounts}
        taskCounts={taskCounts}
        rowSettings={rowSettings}
        lastEdits={lastEdits}
      />
      <CommentsDrawer
        open={commentsDrawerOpen}
        onClose={() => setCommentsDrawerOpen(false)}
      />
    </div>
  );
}
