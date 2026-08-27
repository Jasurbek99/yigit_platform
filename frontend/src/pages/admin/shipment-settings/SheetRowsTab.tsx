import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, Modal, Spin } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { ISheetRowSetting } from '@/types';
import {
  useSheetRowSettings,
  useReorderSheetRows,
  useSoftDeleteSheetRow,
} from '@/hooks/useSheetRowSettings';
import { ROLE_CHOICES } from '@/constants/roles';
import { COLORS } from '@/constants/styles';
import { SheetRowList, type RowFilter } from './sheet-rows/SheetRowList';
import SheetRowDetail from './sheet-rows/SheetRowDetail';
import { CustomRowModal } from './sheet-rows/CustomRowModal';

interface IProps {
  canWrite: boolean;
}

/**
 * Sheet-row admin: a searchable list of the rows on the left, everything
 * configurable about the selected row on the right. Replaces the previous
 * 13-column table, where a single row's settings were spread across ~2000px
 * of horizontal scroll and each cell saved on its own.
 */
export default function SheetRowsTab({ canWrite }: IProps) {
  const { t } = useTranslation();
  const { data: rows = [], isLoading } = useSheetRowSettings();
  const reorderRows = useReorderSheetRows();
  const softDelete = useSoftDeleteSheetRow();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RowFilter>('all');
  const [customModalOpen, setCustomModalOpen] = useState(false);
  // A confirm dialog is imperative and modeless to React — without this guard a
  // second click while it is open would stack a second dialog, each with its own
  // captured target row, and both switches would fire.
  const switchPending = useRef(false);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected && rows.length > 0) setSelectedId(rows[0].id);
  }, [rows, selected]);

  const roleOptions = ROLE_CHOICES.map((r) => ({ value: r.value, label: t(r.labelKey) }));

  // Switching rows would silently drop an unedited draft — ask first.
  const handleSelect = useCallback(
    (row: ISheetRowSetting) => {
      if (row.id === selectedId || switchPending.current) return;
      if (!isDirty) {
        setSelectedId(row.id);
        return;
      }
      switchPending.current = true;
      Modal.confirm({
        title: t('sheet_rows.unsaved_title'),
        content: t('sheet_rows.unsaved_body'),
        okText: t('sheet_rows.unsaved_discard'),
        okButtonProps: { danger: true },
        cancelText: t('common.cancel'),
        onOk: () => {
          setIsDirty(false);
          setSelectedId(row.id);
        },
        afterClose: () => {
          switchPending.current = false;
        },
      });
    },
    [selectedId, isDirty, t],
  );

  const handleMove = useCallback(
    (record: ISheetRowSetting, direction: 'up' | 'down') => {
      if (!canWrite) return;
      const idx = rows.findIndex((r) => r.id === record.id);
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || newIdx < 0 || newIdx >= rows.length) return;
      const newOrder = rows.map((r) => r.id);
      [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
      reorderRows.mutate(
        { order: newOrder },
        { onError: () => toast.error(t('sheet_rows.toast_reorder_error')) },
      );
    },
    [canWrite, rows, reorderRows, t],
  );

  const handleDeleteCustom = useCallback(
    (record: ISheetRowSetting) => {
      if (!canWrite || !record.is_custom || softDelete.isPending) return;
      Modal.confirm({
        title: t('sheet_rows.custom_delete_confirm_title', { field_key: record.field_key }),
        content: t('sheet_rows.custom_delete_confirm_body'),
        okText: t('sheet_rows.custom_delete_confirm_ok'),
        okButtonProps: { danger: true },
        cancelText: t('common.cancel'),
        onOk: () =>
          new Promise<void>((resolve, reject) => {
            softDelete.mutate(
              { id: record.id },
              {
                onSuccess: () => {
                  toast.success(t('sheet_rows.custom_deleted', { field_key: record.field_key }));
                  setIsDirty(false);
                  setSelectedId(null);
                  resolve();
                },
                onError: () => {
                  toast.error(t('sheet_rows.custom_delete_error'));
                  reject();
                },
              },
            );
          }),
      });
    },
    [canWrite, softDelete, t],
  );

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div>
      {canWrite && (
        <div style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCustomModalOpen(true)}>
            {t('sheet_rows.add_custom_row')}
          </Button>
          <span style={{ marginLeft: 8, color: COLORS.textSecondary, fontSize: 12 }}>
            {t('sheet_rows.add_custom_hint')}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 330px)', minHeight: 420 }}>
        <div style={{ width: 360, flexShrink: 0 }}>
          <SheetRowList
            rows={rows}
            selectedId={selectedId}
            canWrite={canWrite}
            search={search}
            filter={filter}
            onSearchChange={setSearch}
            onFilterChange={setFilter}
            onSelect={handleSelect}
            onMove={handleMove}
          />
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 6,
            padding: 16,
            overflow: 'hidden',
          }}
        >
          {selected ? (
            <SheetRowDetail
              key={selected.id}
              record={selected}
              position={rows.indexOf(selected) + 1}
              canWrite={canWrite}
              roleOptions={roleOptions}
              onDirtyChange={setIsDirty}
              onDeleteCustom={handleDeleteCustom}
            />
          ) : (
            <Empty description={t('sheet_rows.select_row_hint')} />
          )}
        </div>
      </div>
      <CustomRowModal open={customModalOpen} onClose={() => setCustomModalOpen(false)} />
    </div>
  );
}
