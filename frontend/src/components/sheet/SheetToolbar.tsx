import { useMemo, useState } from 'react';
import { Button, Input, Switch, Typography, Badge, Modal, List, Select, Space, Tooltip, Alert } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  CommentOutlined,
  EyeOutlined,
  SettingOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  MergeCellsOutlined,
  FullscreenOutlined,
  ColumnWidthOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSheetStore, SHEET_ZOOM_MIN, SHEET_ZOOM_MAX } from '@/stores/sheetStore';
import { useAuth } from '@/hooks/useAuth';
import { useCreateEmptyColumn } from '@/hooks/useDrafts';
import { canDo } from '@/utils/permissions';
import type { IRowConfig, ISheetTaskCounts, IShipmentSheetItem } from '@/types';
import { COLORS } from '@/constants/styles';
import { JoinActionBar } from './JoinActionBar';
import { SwapActionBar } from './SwapActionBar';

// Cap on how many SHIPMENT columns the user can freeze (on top of the 3
// row-label columns: Row #, Who, Field name). Beyond this, freezing more
// just hides the scrollable pane. 20 is a generous practical ceiling.
const MAX_FROZEN_SHIPMENT_COLS = 20;
// The row-label band always sits at the left of the sheet: # / Who / Field.
const TOTAL_LABEL_COLS = 3;

const { Text } = Typography;

interface ISheetToolbarProps {
  shipments: IShipmentSheetItem[];
  taskCounts?: ISheetTaskCounts;
  /**
   * Full row config list from the sheet payload — used by the hidden-rows pill
   * to label which rows are hidden. Optional for backward compat.
   */
  rows?: IRowConfig[];
  /** Current user language for label resolution. */
  currentUserLang?: 'tk' | 'ru' | 'en';
  /**
   * Phase 2a: IDs of rows the user has currently hidden.
   * When non-empty, shows a "Hidden rows (N)" pill that opens an unhide modal.
   */
  hiddenRowIds?: number[];
  /**
   * Phase 2a: field_key → SheetRowSetting.id mapping.
   * Needed to resolve which row label to show in the unhide modal.
   */
  fieldKeyToRowId?: Record<string, number>;
  /** Called when the user clicks Unhide for a specific row. */
  onUnhideRow?: (rowId: number) => void;
}

export function SheetToolbar({
  shipments,
  taskCounts = {},
  rows = [],
  // currentUserLang is part of the interface for future label resolution;
  // currently the toolbar uses i18n keys (not DB labels), so it is not read here.
  hiddenRowIds = [],
  fieldKeyToRowId = {},
  onUnhideRow,
}: ISheetToolbarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const searchText = useSheetStore((s) => s.searchText);
  const setSearchText = useSheetStore((s) => s.setSearchText);
  const showGapyOnly = useSheetStore((s) => s.showGapyOnly);
  const setShowGapyOnly = useSheetStore((s) => s.setShowGapyOnly);
  const commentsDrawerOpen = useSheetStore((s) => s.commentsDrawerOpen);
  const toggleCommentsDrawer = useSheetStore((s) => s.toggleCommentsDrawer);
  const frozenRowCount = useSheetStore((s) => s.frozenRowCount);
  const frozenColCount = useSheetStore((s) => s.frozenColCount);
  const setFrozenRowCount = useSheetStore((s) => s.setFrozenRowCount);
  const setFrozenColCount = useSheetStore((s) => s.setFrozenColCount);
  const sheetZoom = useSheetStore((s) => s.sheetZoom);
  const zoomIn = useSheetStore((s) => s.zoomIn);
  const zoomOut = useSheetStore((s) => s.zoomOut);
  const resetZoom = useSheetStore((s) => s.resetZoom);
  const joinMode = useSheetStore((s) => s.joinMode);
  const setJoinMode = useSheetStore((s) => s.setJoinMode);
  const swapMode = useSheetStore((s) => s.swapMode);
  const setSwapMode = useSheetStore((s) => s.setSwapMode);
  const setSheetFullscreen = useSheetStore((s) => s.setSheetFullscreen);
  const reorderMode = useSheetStore((s) => s.reorderMode);
  const toggleReorderMode = useSheetStore((s) => s.toggleReorderMode);
  const setReorderMode = useSheetStore((s) => s.setReorderMode);

  const [unhideModalOpen, setUnhideModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const createEmptyColumn = useCreateEmptyColumn();

  const canCreate = canDo(user, 'shipment', 'create');

  // Join flow: join is restricted to export_manager / director.
  // (canCreateSupply removed when the "Ýük goş" button was commented out — the
  // primary "New Shipment" button now covers supply create via canDo('shipment','create').)
  const userRole = user?.role ?? '';
  const canJoin =
    user?.is_superuser || ['export_manager', 'director'].includes(userRole);
  // Column reorder is restricted to admins and export managers — it changes the
  // GLOBAL column order visible to all users, so it is not a per-user setting.
  const canReorderColumns =
    user?.is_superuser || ['admin', 'export_manager'].includes(userRole);
  const shipmentCount = shipments.length;

  // Sum of open tasks assigned to me across all shipments
  const myOpenTaskCount = Object.values(taskCounts).reduce(
    (acc, tc) => acc + (tc.assigned_to_me_open ?? 0),
    0,
  );

  // ─── Hidden rows pill ───────────────────────────────────────────────────────
  const hiddenCount = hiddenRowIds.length;

  // Build a reverse map: rowId → field_key
  const rowIdToFieldKey = useMemo(() => {
    const map: Record<number, string> = {};
    for (const [fk, id] of Object.entries(fieldKeyToRowId)) {
      map[id] = fk;
    }
    return map;
  }, [fieldKeyToRowId]);

  // Build a label map: field_key → display label (DB label → i18n fallback)
  const fieldKeyToLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.field_key] = t(row.label_key);
    }
    return map;
  }, [rows, t]);

  // Items shown in the unhide modal — one per hidden row
  const hiddenRowItems = useMemo(
    () =>
      hiddenRowIds.map((rowId) => {
        const fk = rowIdToFieldKey[rowId] ?? String(rowId);
        const label = fieldKeyToLabel[fk] ?? fk;
        return { rowId, label };
      }),
    [hiddenRowIds, rowIdToFieldKey, fieldKeyToLabel],
  );

  // ─── Settings modal: freeze pickers ─────────────────────────────────────
  // The row picker uses the runtime `rows` array (which already reflects
  // user-reordered + visible rows from the API), so position N matches what
  // the user sees on screen — not the original Excel row number. We still
  // surface the original row_number as "(R14)" for cross-reference with the
  // legacy spreadsheet.
  const rowOptions = useMemo(
    () => [
      { value: 0, label: t('sheet.settings.no_freeze') },
      ...rows.map((r, idx) => ({
        value: idx + 1,
        label: `${t(r.label_key)} (R${r.row_number})`,
      })),
    ],
    [rows, t],
  );

  // frozenColCount counts ALL frozen columns: 1=Row#, 2=Who, 3=Field name (the
  // full row-label band — the v1 default), 4+ = +shipments. The picker shows
  // every option from "No freeze" to "After column 3 + N shipments" capped at
  // MAX_FROZEN_SHIPMENT_COLS shipments to keep the dropdown reasonable.
  const colMax =
    TOTAL_LABEL_COLS + Math.min(MAX_FROZEN_SHIPMENT_COLS, shipments.length);
  const colOptions = useMemo(
    () => {
      const opts: { value: number; label: string }[] = [
        { value: 0, label: t('sheet.settings.no_freeze') },
      ];
      for (let col = 1; col <= colMax; col++) {
        let label: string;
        if (col === 1) label = t('sheet.settings.col_option_num');
        else if (col === 2) label = t('sheet.settings.col_option_who');
        else if (col === 3) label = t('sheet.settings.col_option_field');
        else
          label = t('sheet.settings.col_option_shipment', {
            col,
            n: col - TOTAL_LABEL_COLS,
          });
        opts.push({ value: col, label });
      }
      return opts;
    },
    [colMax, t],
  );

  // Default = freeze the full row-label band (Row #, Who, Field name).
  const isDefaultFreeze = frozenRowCount === 13 && frozenColCount === TOTAL_LABEL_COLS;

  // ─── "Ýük goş": one-click create of an empty supply column ───────────────
  // Soltanmyrat creates a blank draft column here, fills its values in the
  // sheet cells, and joins it with Gadam's destination column afterward.
  function handleAddCargo() {
    createEmptyColumn.mutate(undefined, {
      onSuccess: (draft) => {
        toast.success(t('sheet.add_cargo.toast_saved', { code: draft.cargo_code }));
      },
      onError: (err) => {
        const data = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
        if (data && typeof data === 'object' && typeof data.error === 'string' && data.error) {
          toast.error(data.error);
          return;
        }
        toast.error(t('sheet.add_cargo.toast_error'));
      },
    });
  }

  return (
    <>
      <div className="sheet-toolbar">
        <div className="sheet-toolbar__left">
          {canCreate && (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              loading={createEmptyColumn.isPending}
              onClick={handleAddCargo}
            >
              {t('sheet.add_column')}
            </Button>
          )}
          {/* "Ýük goş" — commented out: now duplicates the "New Shipment" button above.
              Both call handleAddCargo → useCreateEmptyColumn. Kept here in case the
              supply-role gate (canCreateSupply) needs to be restored as a separate path. */}
          {/* {canCreateSupply && (
            <Tooltip title={t('sheet.add_cargo.tooltip')}>
              <Button
                size="small"
                icon={<InboxOutlined />}
                loading={createEmptyColumn.isPending}
                onClick={handleAddCargo}
              >
                {t('sheet.add_cargo.btn')}
              </Button>
            </Tooltip>
          )} */}
          {canJoin && (
            <Tooltip title={joinMode ? undefined : t('sheet.join.tooltip')}>
              <Button
                size="small"
                type={joinMode ? 'primary' : 'default'}
                icon={<MergeCellsOutlined />}
                onClick={() => setJoinMode(!joinMode)}
              >
                {t('sheet.join.btn')}
              </Button>
            </Tooltip>
          )}
          <Tooltip title={swapMode ? undefined : t('sheet.swap.tooltip')}>
            <Button
              size="small"
              type={swapMode ? 'primary' : 'default'}
              icon={<SwapOutlined />}
              onClick={() => setSwapMode(!swapMode)}
            >
              {t('sheet.swap.btn')}
            </Button>
          </Tooltip>
          {canReorderColumns && (
            <Tooltip title={reorderMode ? undefined : t('sheet.reorder_columns')}>
              <Button
                size="small"
                type={reorderMode ? 'primary' : 'default'}
                icon={<ColumnWidthOutlined />}
                onClick={toggleReorderMode}
              >
                {t('sheet.reorder_columns')}
              </Button>
            </Tooltip>
          )}
          <Input
            prefix={<SearchOutlined />}
            placeholder={t('sheet.search_ph')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            size="small"
            style={{ width: 200 }}
          />
          <div className="sheet-toolbar__toggle">
            <Switch
              size="small"
              checked={showGapyOnly}
              onChange={setShowGapyOnly}
            />
            <Text style={{ fontSize: 12 }}>{t('sheet.gapy_only')}</Text>
          </div>
          <Badge dot={!isDefaultFreeze} offset={[-2, 4]}>
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            >
              {t('sheet.settings.label')}
            </Button>
          </Badge>

          {/* Zoom: − / current % / + . Click the % to reset to 100%. */}
          <Space.Compact size="small">
            <Tooltip title={t('sheet.zoom_out')}>
              <Button
                icon={<ZoomOutOutlined />}
                onClick={zoomOut}
                disabled={sheetZoom <= SHEET_ZOOM_MIN}
                aria-label={t('sheet.zoom_out')}
              />
            </Tooltip>
            <Tooltip title={t('sheet.zoom_reset')}>
              <Button onClick={resetZoom} style={{ width: 52, padding: 0 }}>
                {Math.round(sheetZoom * 100)}%
              </Button>
            </Tooltip>
            <Tooltip title={t('sheet.zoom_in')}>
              <Button
                icon={<ZoomInOutlined />}
                onClick={zoomIn}
                disabled={sheetZoom >= SHEET_ZOOM_MAX}
                aria-label={t('sheet.zoom_in')}
              />
            </Tooltip>
          </Space.Compact>

          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('sheet.total_count', { count: shipmentCount })}
          </Text>

          {/* Phase 2a: Hidden rows pill — shown only when user has hidden rows */}
          {hiddenCount > 0 && (
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setUnhideModalOpen(true)}
              style={{ color: COLORS.textSecondary, borderColor: COLORS.borderLight }}
            >
              {t('sheet.hidden_rows_count', { count: hiddenCount })}
            </Button>
          )}
        </div>
        <div className="sheet-toolbar__right">
          <Tooltip title={t('sheet.fullscreen_enter')}>
            <Button
              size="small"
              icon={<FullscreenOutlined />}
              onClick={() => setSheetFullscreen(true)}
              aria-label={t('sheet.fullscreen_enter')}
            />
          </Tooltip>
          <Badge count={myOpenTaskCount} size="small" offset={[-4, 4]}>
            <Button
              size="small"
              icon={<CommentOutlined />}
              onClick={toggleCommentsDrawer}
              type={commentsDrawerOpen ? 'primary' : 'default'}
            >
              {t('comments.toolbar_btn')}
            </Button>
          </Badge>
        </div>
      </div>

      {/* Join flow: column-selection action bar — shown below toolbar when armed */}
      {joinMode && <JoinActionBar shipments={shipments} />}

      {/* Swap flow: column-selection action bar — shown below toolbar when armed */}
      {swapMode && <SwapActionBar shipments={shipments} />}

      {/* Column reorder mode banner — shown below toolbar when reorder is active */}
      {reorderMode && (
        <Alert
          type="info"
          banner
          message={
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>{t('sheet.reorder_columns_hint')}</span>
              <Button
                size="small"
                type="primary"
                onClick={() => setReorderMode(false)}
              >
                {t('sheet.reorder_columns_done')}
              </Button>
            </span>
          }
          style={{ fontSize: 12 }}
        />
      )}

      {/* Phase 2a: Unhide modal */}
      <Modal
        open={unhideModalOpen}
        onCancel={() => setUnhideModalOpen(false)}
        title={t('sheet.hidden_rows_modal_title')}
        footer={null}
        width={400}
      >
        <List
          dataSource={hiddenRowItems}
          renderItem={({ rowId, label }) => (
            <List.Item
              key={rowId}
              actions={[
                <Button
                  key="unhide"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => {
                    onUnhideRow?.(rowId);
                    // Close modal only if this was the last hidden row
                    if (hiddenCount <= 1) {
                      setUnhideModalOpen(false);
                    }
                  }}
                >
                  {t('sheet.unhide_row')}
                </Button>,
              ]}
            >
              <Text>{label}</Text>
            </List.Item>
          )}
        />
      </Modal>

      {/* Sheet display settings modal — currently only houses freeze pickers,
          but is the natural home for any future per-user sheet preferences. */}
      <Modal
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        title={t('sheet.settings.modal_title')}
        footer={[
          <Button
            key="reset"
            onClick={() => {
              setFrozenRowCount(13);
              setFrozenColCount(TOTAL_LABEL_COLS);
            }}
          >
            {t('sheet.settings.reset_default')}
          </Button>,
          <Button key="done" type="primary" onClick={() => setSettingsOpen(false)}>
            {t('sheet.settings.done')}
          </Button>,
        ]}
        width={520}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong>{t('sheet.settings.freeze_section')}</Text>
        </div>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <div style={{ marginBottom: 6 }}>
              <Text>{t('sheet.settings.freeze_rows_after')}</Text>
            </div>
            <Select
              style={{ width: '100%' }}
              value={Math.min(frozenRowCount, rows.length)}
              onChange={(v) => setFrozenRowCount(v)}
              options={rowOptions}
              showSearch
              optionFilterProp="label"
              placeholder={t('sheet.settings.no_freeze')}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('sheet.settings.freeze_rows_hint')}
            </Text>
          </div>
          <div>
            <div style={{ marginBottom: 6 }}>
              <Text>{t('sheet.settings.freeze_cols_after')}</Text>
            </div>
            <Select
              style={{ width: '100%' }}
              value={Math.min(frozenColCount, colMax)}
              onChange={(v) => setFrozenColCount(v)}
              options={colOptions}
              placeholder={t('sheet.settings.no_freeze')}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('sheet.settings.freeze_cols_hint')}
            </Text>
          </div>
        </Space>
      </Modal>

    </>
  );
}
