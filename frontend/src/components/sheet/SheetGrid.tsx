import { useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { IShipmentSheetItem, IRowConfig } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { useAuth } from '@/hooks/useAuth';
import { SheetCell } from './SheetCell';
import { SheetCellEditor } from './SheetCellEditor';
import { SheetLabelRow } from './SheetLabelColumn';
import {
  FROZEN_ROWS,
  SCROLLABLE_ROWS,
  COL_WIDTH_SHIPMENT,
  COL_WIDTH_ROW_NUM,
  COL_WIDTH_WHO,
  COL_WIDTH_FIELD,
  ROW_HEIGHT,
} from '@/constants/sheetRowConfig';

// Role-based edit check — matches P3_Shipment_Sheet_Spec.md permission matrix
const ROLE_EDITABLE_FIELDS: Record<string, Set<string>> = {
  export_manager: new Set(['*']),
  warehouse_chief: new Set([
    'block_sources', 'variety', 'harvest_status',
    'loading_started_at', 'loading_ended_at',
    'weight_net', 'weight_gross', 'packaging_kg', 'box_count',
    'rejected_weight_kg', 'harvest_date',
  ]),
  document_team: new Set([
    'firm_splits', 'documents_status',
    'customs_exit_at',
  ]),
  transport: new Set([
    'route_note', 'vehicle_condition', 'vehicle_responsible',
    'truck_plate', 'driver_name', 'driver_phone',
    'border_point', 'border_crossed_at', 'truck_capacity',
  ]),
  sales_rep: new Set([
    'city', 'arrived_at', 'dest_entry_at', 'customs_entry_at',
    'has_peregruz', 'peregruz_date',
    'sale_started_at', 'sale_ended_at', 'has_sales_report',
    'additional_notes_arap',
  ]),
  finansist: new Set([
    'price_per_kg', 'total_amount_usd',
  ]),
  director: new Set(['*']),
};

function canEditCell(role: string | undefined, fieldKey: string): boolean {
  if (!role) return false;
  const fields = ROLE_EDITABLE_FIELDS[role];
  if (!fields) return false;
  if (fields.has('*')) return true;
  return fields.has(fieldKey);
}

interface ISheetGridProps {
  shipments: IShipmentSheetItem[];
}

export function SheetGrid({ shipments }: ISheetGridProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { editingCell } = useSheetStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const columnVirtualizer = useVirtualizer({
    count: shipments.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => COL_WIDTH_SHIPMENT,
    horizontal: true,
    overscan: 5,
  });

  const renderRow = useCallback(
    (rowConfig: IRowConfig, shipment: IShipmentSheetItem) => {
      const isEditing =
        editingCell?.shipmentId === shipment.id &&
        editingCell?.rowKey === rowConfig.fieldKey;

      const isEditable =
        rowConfig.inputType !== 'readonly' &&
        canEditCell(user?.role, rowConfig.fieldKey);

      if (isEditing) {
        return (
          <SheetCellEditor
            key={`${shipment.id}-${rowConfig.rowNumber}`}
            shipment={shipment}
            rowConfig={rowConfig}
          />
        );
      }

      return (
        <SheetCell
          key={`${shipment.id}-${rowConfig.rowNumber}`}
          shipment={shipment}
          rowConfig={rowConfig}
          isEditable={isEditable}
        />
      );
    },
    [editingCell, user?.role],
  );

  const virtualColumns = columnVirtualizer.getVirtualItems();

  // Column headers
  const columnHeaders = useMemo(
    () =>
      virtualColumns.map((vc) => {
        const shipment = shipments[vc.index];
        const codeShort = shipment.cargo_code.slice(0, 7);
        return (
          <div
            key={shipment.id}
            className="sheet-col-header"
            style={{
              position: 'absolute',
              left: vc.start,
              width: COL_WIDTH_SHIPMENT,
              height: ROW_HEIGHT,
            }}
          >
            <span className="sheet-col-header__seq">{vc.index + 1}</span>
            <span className="sheet-col-header__code">{codeShort}</span>
          </div>
        );
      }),
    [virtualColumns, shipments],
  );

  const renderSection = (rows: IRowConfig[]) =>
    rows.map((rowConfig) => (
      <div key={rowConfig.rowNumber} className="sheet-row" style={{ display: 'flex', height: ROW_HEIGHT }}>
        {/* Frozen left labels */}
        <SheetLabelRow rowConfig={rowConfig} />

        {/* Virtual data columns */}
        <div style={{ position: 'relative', width: columnVirtualizer.getTotalSize(), height: ROW_HEIGHT }}>
          {virtualColumns.map((vc) => {
            const shipment = shipments[vc.index];
            return (
              <div
                key={shipment.id}
                style={{
                  position: 'absolute',
                  left: vc.start,
                  width: COL_WIDTH_SHIPMENT,
                  height: ROW_HEIGHT,
                }}
              >
                {renderRow(rowConfig, shipment)}
              </div>
            );
          })}
        </div>
      </div>
    ));

  return (
    <div className="sheet-grid" ref={scrollContainerRef}>
      {/* Header row */}
      <div className="sheet-header-row" style={{ display: 'flex', height: ROW_HEIGHT, position: 'sticky', top: 0, zIndex: 10 }}>
        {/* Empty frozen left header */}
        <div style={{ width: COL_WIDTH_ROW_NUM, flexShrink: 0 }} className="sheet-label-col sheet-label-col--num">#</div>
        <div style={{ width: COL_WIDTH_WHO, flexShrink: 0 }} className="sheet-label-col sheet-label-col--who">{t('sheet.who.none')}</div>
        <div style={{ width: COL_WIDTH_FIELD, flexShrink: 0 }} className="sheet-label-col sheet-label-col--field">{t('sheet.row.shipment_code')}</div>
        {/* Column headers */}
        <div style={{ position: 'relative', width: columnVirtualizer.getTotalSize(), height: ROW_HEIGHT }}>
          {columnHeaders}
        </div>
      </div>

      {/* Frozen top section (rows 2-14) */}
      <div className="sheet-frozen-top" style={{ position: 'sticky', top: ROW_HEIGHT, zIndex: 5 }}>
        {renderSection(FROZEN_ROWS)}
      </div>

      {/* Scrollable bottom section (rows 15-45) */}
      <div className="sheet-scrollable-bottom">
        {renderSection(SCROLLABLE_ROWS)}
      </div>
    </div>
  );
}
