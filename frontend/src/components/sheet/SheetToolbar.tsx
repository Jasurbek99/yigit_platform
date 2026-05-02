import { useMemo, useState } from 'react';
import { Button, Input, Switch, Typography, Badge, Modal, List, Select, Space } from 'antd';
import { PlusOutlined, SearchOutlined, CommentOutlined, EyeOutlined, SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { DeadlineTimer } from '@/components/DeadlineTimer';
import { useSheetStore } from '@/stores/sheetStore';
import { useSheetCreate } from '@/hooks/useSheetCreate';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import type { IRowConfig, ISheetTaskCounts, IShipmentSheetItem } from '@/types';

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
  const {
    searchText,
    setSearchText,
    showGapyOnly,
    setShowGapyOnly,
    commentsDrawerOpen,
    toggleCommentsDrawer,
    frozenRowCount,
    frozenColCount,
    setFrozenRowCount,
    setFrozenColCount,
  } = useSheetStore();
  const createMutation = useSheetCreate();

  const [unhideModalOpen, setUnhideModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const canCreate = canDo(user, 'shipment', 'create');
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

  return (
    <>
      <div className="sheet-toolbar">
        <div className="sheet-toolbar__left">
          {canCreate && (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {t('sheet.add_column')}
            </Button>
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
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('sheet.total_count', { count: shipmentCount })}
          </Text>

          {/* Phase 2a: Hidden rows pill — shown only when user has hidden rows */}
          {hiddenCount > 0 && (
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setUnhideModalOpen(true)}
              style={{ color: '#8c8c8c', borderColor: '#d9d9d9' }}
            >
              {t('sheet.hidden_rows_count', { count: hiddenCount })}
            </Button>
          )}
        </div>
        <div className="sheet-toolbar__right">
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
          <DeadlineTimer compact />
        </div>
      </div>

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
