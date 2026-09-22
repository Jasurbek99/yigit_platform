import { useEffect, useMemo, useRef, useCallback } from 'react';
import { Spin } from 'antd';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useShipmentSheet } from '@/hooks/useShipmentSheet';
import { useSheetLiveSync } from '@/hooks/useSheetLiveSync';
import { useSheetStore } from '@/stores/sheetStore';
import { useUndoStore } from '@/stores/undoStore';
import {
  useUserSheetPreferences,
  useSaveUserSheetPreferences,
  useUserSheetPrefsBroadcast,
} from '@/hooks/useUserSheetPreferences';
import { SheetGrid } from '@/components/sheet/SheetGrid';
import { CommentsDrawer } from '@/components/comments/CommentsDrawer';
import '@/components/sheet/SheetStyles.css';
import '@/components/sheet/SheetVariantIos.css';

/**
 * Tır Takip → Tırlar — the trucks sheet, in the Sera Bütçe skin.
 *
 * A copy of `pages/export/ShipmentSheet.tsx` (the page wrapper only), NOT a
 * second grid. `SheetGrid` and every component under it are reused, not forked;
 * their only edit is the optional `variant` pin described below. Reusing them is
 * what keeps the cell-level permission chain (`isCellEditable`, the row access
 * grants, the field-level backend checks) identical between this tab and
 * `/export/shipments/sheet`. Reimplementing cell rendering here is the one
 * change that would actually be dangerous.
 *
 * ── Why the grid needs no restyling ──────────────────────────────────────
 * The Sheet already ships the Sera look: its `ios` design variant IS a
 * reproduction of this very screen — see the header comment on
 * `components/sheet/sheetTopicOrder.ts`, which orders rows into Sera's topic
 * sections (Genel Bilgiler, Ýük & Gümrük, Transport, Ýükleme Zamanlary, Ýolda,
 * Satyş & Hasabat) instead of the classic per-owner role bands, and
 * `SheetVariantIos.css`, which is the skin. So this tab pins `variant="ios"`
 * and adds no grid CSS of its own. `sera.css` only takes the tab card away and
 * makes the sheet fill the page — see `.sera-sheet` there.
 *
 * Pinned by prop, deliberately, not by writing the store: `setSheetVariant`
 * persists to `localStorage`, so pinning through the store would follow the
 * user back to `/export/shipments/sheet` and leave the classic Sheet wearing
 * this skin. The prop leaves that page byte-identical.
 *
 * ── What this copy drops, and why ────────────────────────────────────────
 * Each of these is page-level chrome that misbehaves inside a tab panel:
 *
 *   · `usePresenceSheet()` — joins the `presence.sheet` room. Mounted from a
 *     second location the roster would stop meaning "who is on the Sheet".
 *   · The `?shipment=`/`?row=`/`?comment=`/`?code=` deep-link effects — those
 *     params address the Sheet route, and would fire on `/tir-takip` URLs.
 *   · Fullscreen + zoom controls and the `sheet-page page-fullheight-grid`
 *     classes — that pair pins the grid to the viewport by stripping
 *     `<Content>`'s padding, which would strip it from the tab strip too.
 *   · `SheetToolbar` — search, filters and the variant toggle. Keeping it
 *     would put the `classic`/`ios` switch inside a page whose whole premise
 *     is the Sera skin, reintroducing the localStorage leak above.
 *
 * Dropping the toolbar is why `shipments` is passed straight to the grid with
 * no filter step. `searchText`/`sheetFilters` live in a module-level store that
 * survives client-side navigation, so filtering here would let a search typed
 * on the Sheet silently hide trucks in a tab with no filter UI to clear it.
 * Sera's own screen has filters (year, month, block, status) and they are a
 * separate piece of work — its filter model is not this store's.
 */
export default function TirlarTab() {
  const { t } = useTranslation();
  // Refetch when someone ELSE writes; skips your own pokes and holds off
  // mid-edit. Cheap to keep, and the tab is as live as the Sheet without it.
  useSheetLiveSync();
  const { data, isLoading } = useShipmentSheet();
  const shipments = data?.shipments;
  const commentCounts = data?.comment_counts ?? {};
  const cellColors = data?.cell_colors ?? {};
  const taskCounts = data?.task_counts ?? {};
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const rowSettings = useMemo(() => data?.row_settings ?? {}, [data?.row_settings]);
  const lastEdits = data?.last_edits ?? {};
  const currentUserLang = data?.current_user_lang ?? 'tk';

  // No `groupRowsByOwner` here — that is the CLASSIC variant's grouping, and
  // the grid re-groups by topic anyway once the variant is `ios`. Passing the
  // server order keeps the user's saved row positions applied underneath.
  const { data: userPrefs } = useUserSheetPreferences();
  const hiddenRows = useMemo(() => userPrefs?.hidden_rows ?? [], [userPrefs?.hidden_rows]);
  useUserSheetPrefsBroadcast();

  const setRows = useSheetStore((s) => s.setRows);
  const commentsDrawerOpen = useSheetStore((s) => s.commentsDrawerOpen);
  const setCommentsDrawerOpen = useSheetStore((s) => s.setCommentsDrawerOpen);
  const clearUndo = useUndoStore((s) => s.clearUndo);

  // field_key → SheetRowSetting.id. Enables the per-row hide control; the
  // reorder control is already disabled by the grid in this variant, because
  // persisting a nudge would save the topic order as the user's personal one.
  const fieldKeyToRowId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [fk, setting] of Object.entries(rowSettings)) {
      if (setting?.id != null) map[fk] = setting.id;
    }
    return map;
  }, [rowSettings]);

  const savePrefs = useSaveUserSheetPreferences();
  const handleHideRow = useCallback(
    (rowId: number) => {
      savePrefs.mutate({ hidden_rows: Array.from(new Set([...hiddenRows, rowId])) });
      toast.success(t('sheet.row_hidden_toast'));
    },
    [savePrefs, hiddenRows, t],
  );

  // Deep components (CommentItem, MentionPopover) read the row map from the
  // store rather than by prop-drilling, so it has to be filled here too.
  const prevRowsRef = useRef<typeof rows | null>(null);
  useEffect(() => {
    if (rows.length > 0 && rows !== prevRowsRef.current) {
      prevRowsRef.current = rows;
      setRows(rows);
    }
  }, [rows, setRows]);

  // Undo entries reference cached shipment rows that won't exist next visit.
  useEffect(() => () => clearUndo(), [clearUndo]);

  if (isLoading) {
    return (
      <div className="sera-sheet sera-sheet--loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="sera-sheet">
      <SheetGrid
        variant="ios"
        shipments={shipments ?? []}
        rows={rows}
        commentCounts={commentCounts}
        taskCounts={taskCounts}
        cellColors={cellColors}
        rowSettings={rowSettings}
        lastEdits={lastEdits}
        currentUserLang={currentUserLang}
        fieldKeyToRowId={fieldKeyToRowId}
        onHideRow={handleHideRow}
      />
      <CommentsDrawer open={commentsDrawerOpen} onClose={() => setCommentsDrawerOpen(false)} />
    </div>
  );
}
