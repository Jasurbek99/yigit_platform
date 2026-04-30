import { useMemo, useState } from 'react';
import { Button, Input, Switch, Typography, Badge, Dropdown, Modal, List } from 'antd';
import type { MenuProps } from 'antd';
import { PlusOutlined, SearchOutlined, CommentOutlined, LockOutlined, EyeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { DeadlineTimer } from '@/components/DeadlineTimer';
import { useSheetStore } from '@/stores/sheetStore';
import { useSheetCreate } from '@/hooks/useSheetCreate';
import { useAuth } from '@/hooks/useAuth';
import { canDo } from '@/utils/permissions';
import { SHEET_ROW_CONFIG } from '@/constants/sheetRowConfig';
import type { IRowConfig, ISheetTaskCounts, IShipmentSheetItem } from '@/types';

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
    activeCell,
  } = useSheetStore();
  const createMutation = useSheetCreate();

  const [unhideModalOpen, setUnhideModalOpen] = useState(false);

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

  // ─── Freeze dropdown ────────────────────────────────────────────────────
  const activeRowIndex = useMemo(() => {
    if (!activeCell) return -1;
    return SHEET_ROW_CONFIG.findIndex((r) => r.fieldKey === activeCell.rowKey);
  }, [activeCell]);

  const activeColIndex = useMemo(() => {
    if (!activeCell) return -1;
    return shipments.findIndex((s) => s.id === activeCell.shipmentId);
  }, [activeCell, shipments]);

  const activeRowNumber =
    activeRowIndex >= 0 ? SHEET_ROW_CONFIG[activeRowIndex].rowNumber : null;

  const freezeMenu: MenuProps = {
    selectable: false,
    onClick: ({ key }) => {
      const [axis, value] = key.split(':');
      if (axis === 'r') {
        if (value === 'active' && activeRowIndex >= 0) {
          setFrozenRowCount(activeRowIndex + 1);
        } else {
          setFrozenRowCount(parseInt(value, 10));
        }
      } else if (axis === 'c') {
        if (value === 'active' && activeColIndex >= 0) {
          setFrozenColCount(activeColIndex + 1);
        } else {
          setFrozenColCount(parseInt(value, 10));
        }
      }
    },
    items: [
      {
        key: 'rows-grp',
        type: 'group',
        label: t('sheet.freeze.rows'),
        children: [
          { key: 'r:0', label: t('sheet.freeze.no_rows') },
          { key: 'r:1', label: t('sheet.freeze.one_row') },
          { key: 'r:2', label: t('sheet.freeze.n_rows', { count: 2 }) },
          {
            key: 'r:active',
            disabled: activeRowIndex < 0,
            label:
              activeRowNumber != null
                ? t('sheet.freeze.up_to_row_n', { row: activeRowNumber })
                : t('sheet.freeze.up_to_row'),
          },
          { key: 'r:13', label: t('sheet.freeze.default_rows') },
        ],
      },
      { type: 'divider' },
      {
        key: 'cols-grp',
        type: 'group',
        label: t('sheet.freeze.cols'),
        children: [
          { key: 'c:0', label: t('sheet.freeze.no_cols') },
          { key: 'c:1', label: t('sheet.freeze.one_col') },
          { key: 'c:2', label: t('sheet.freeze.n_cols', { count: 2 }) },
          {
            key: 'c:active',
            disabled: activeColIndex < 0,
            label:
              activeColIndex >= 0
                ? t('sheet.freeze.up_to_col_n', { col: activeColIndex + 1 })
                : t('sheet.freeze.up_to_col'),
          },
        ],
      },
    ],
  };

  const freezeSummary = `${frozenRowCount}R · ${frozenColCount}C`;

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
          <Dropdown menu={freezeMenu} trigger={['click']} placement="bottomLeft">
            <Button size="small" icon={<LockOutlined />}>
              {t('sheet.freeze.label')}
              <Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>
                {freezeSummary}
              </Text>
            </Button>
          </Dropdown>
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
    </>
  );
}
