import { memo, useCallback } from 'react';
import { Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import i18n from '@/i18n';
import type { IShipmentSheetItem, IRowConfig } from '@/types';
import { useSheetStore } from '@/stores/sheetStore';
import { COL_WIDTH_SHIPMENT, ROW_HEIGHT } from '@/constants/sheetRowConfig';

const COUNTRY_FLAGS: Record<string, string> = {
  KZ: '🇰🇿', RU: '🇷🇺', BY: '🇧🇾', KG: '🇰🇬', TJ: '🇹🇯', UZ: '🇺🇿', AF: '🇦🇫',
};

interface ISheetCellProps {
  shipment: IShipmentSheetItem;
  rowConfig: IRowConfig;
  isEditable: boolean;
}

function getCellValue(shipment: IShipmentSheetItem, rowConfig: IRowConfig): string {
  const { fieldKey } = rowConfig;

  switch (fieldKey) {
    case 'cargo_code':
      return shipment.cargo_code;
    case 'country':
      return shipment.country_name ?? '—';
    case 'customer':
      return shipment.customer_name ?? '—';
    case 'city':
      return shipment.city_name ?? '—';
    case 'import_firm':
      return shipment.import_firm_name ?? '—';
    case 'variety':
      return shipment.variety_name ?? '—';
    case 'vehicle_responsible':
      return shipment.vehicle_responsible ?? '—';
    case 'vehicle_condition':
      return shipment.vehicle_condition ?? '—';
    case 'border_point':
      return shipment.border_point_name ?? '—';
    case 'weight_net':
      return shipment.weight_net != null ? Number(shipment.weight_net).toLocaleString() : '—';
    case 'rejected_weight_kg':
      return shipment.rejected_weight_kg != null ? Number(shipment.rejected_weight_kg).toLocaleString() : '—';
    case 'transit_days':
      return shipment.transit_days != null ? `${shipment.transit_days}d` : '—';
    case 'has_peregruz':
      return shipment.has_peregruz ? i18n.t('sheet.has_peregruz_yes') : '—';
    case 'has_sales_report':
      return shipment.has_sales_report ? '✓' : '❌';
    case 'notes':
    case 'route_note':
    case 'vehicle_condition_note':
      return (shipment[fieldKey as keyof IShipmentSheetItem] as string) ?? '—';
    default:
      break;
  }

  // Timestamps
  const tsFields = [
    'loading_started_at', 'customs_entry_at', 'customs_exit_at', 'departed_at',
    'border_crossed_at', 'arrived_at', 'sale_started_at', 'sale_ended_at',
    'peregruz_date',
  ];
  if (tsFields.includes(fieldKey)) {
    const val = shipment[fieldKey as keyof IShipmentSheetItem] as string | null;
    if (!val) return '—';
    return dayjs(val).format('DD.MM HH:mm');
  }

  // Firm splits
  if (fieldKey === 'firm_splits') {
    if (!shipment.firm_splits.length) return '—';
    return shipment.firm_splits.map((f) => f.firm_code).join('-');
  }

  // Block sources
  if (fieldKey === 'block_sources') {
    if (!shipment.block_sources.length) return '—';
    return shipment.block_sources.map((b) => b.block_code).join('/');
  }

  // Status fields — show stored value or dash
  if (fieldKey === 'customs_clearance' || fieldKey === 'documents_status' || fieldKey === 'harvest_status') {
    const val = shipment[fieldKey as keyof IShipmentSheetItem] as string | null;
    return val ?? '—';
  }
  if (fieldKey === 'transit_days_temp') {
    const days = shipment.transit_days;
    const temp = shipment.transport_temp_c;
    if (days == null && temp == null) return '—';
    return `${days ?? '?'}d ${temp ?? '?'}°C`;
  }

  return '—';
}

function isEmpty(value: string): boolean {
  return !value || value === '—';
}

function SheetCellInner({ shipment, rowConfig, isEditable }: ISheetCellProps) {
  const { setActiveCell, setEditingCell, activeCell } = useSheetStore();
  const isActive = activeCell?.shipmentId === shipment.id && activeCell?.rowKey === rowConfig.fieldKey;
  const isGapy = shipment.is_gapy_satys;
  const isHidden = rowConfig.gapyHidden && isGapy;

  const value = getCellValue(shipment, rowConfig);
  const cellIsEmpty = isEmpty(value);

  const handleClick = useCallback(() => {
    // Empty editable cells → edit immediately on single click
    if (isEditable && !isHidden && cellIsEmpty) {
      setEditingCell({ shipmentId: shipment.id, rowKey: rowConfig.fieldKey });
      return;
    }
    setActiveCell({ shipmentId: shipment.id, rowKey: rowConfig.fieldKey });
  }, [isEditable, isHidden, cellIsEmpty, setActiveCell, setEditingCell, shipment.id, rowConfig.fieldKey]);

  const handleDoubleClick = useCallback(() => {
    // Filled editable cells → edit on double click
    if (isEditable && !isHidden && !cellIsEmpty) {
      setEditingCell({ shipmentId: shipment.id, rowKey: rowConfig.fieldKey });
    }
  }, [isEditable, isHidden, cellIsEmpty, setEditingCell, shipment.id, rowConfig.fieldKey]);

  if (isHidden) {
    return (
      <div className="sheet-cell sheet-cell--gapy-hidden" style={{ width: COL_WIDTH_SHIPMENT, height: ROW_HEIGHT }}>
        —
      </div>
    );
  }

  // Special rendering
  const { fieldKey } = rowConfig;

  // Country with flag
  if (fieldKey === 'country' && shipment.country_code) {
    const flag = COUNTRY_FLAGS[shipment.country_code] ?? '';
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: COL_WIDTH_SHIPMENT, height: ROW_HEIGHT }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <span className="sheet-cell__country">
          {flag} {shipment.country_name}
        </span>
      </div>
    );
  }

  // Firm splits as tags
  if (fieldKey === 'firm_splits' && shipment.firm_splits.length > 0) {
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: COL_WIDTH_SHIPMENT, height: ROW_HEIGHT }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="sheet-cell__tags">
          {shipment.firm_splits.map((f) => (
            <Tag
              key={f.firm_code}
              color={shipment.firm_splits.length > 1 ? 'purple' : undefined}
              style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
            >
              {f.firm_code}
            </Tag>
          ))}
        </div>
      </div>
    );
  }

  // Block sources as tags
  if (fieldKey === 'block_sources' && shipment.block_sources.length > 0) {
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: COL_WIDTH_SHIPMENT, height: ROW_HEIGHT }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div className="sheet-cell__tags">
          {shipment.block_sources.map((b) => (
            <Tag key={b.block_code} color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
              {b.block_code}
            </Tag>
          ))}
        </div>
      </div>
    );
  }

  // Report status
  if (fieldKey === 'has_sales_report') {
    return (
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: COL_WIDTH_SHIPMENT, height: ROW_HEIGHT }}
        onClick={handleClick}
      >
        <span style={{ color: shipment.has_sales_report ? '#067647' : '#b42318', fontWeight: 600 }}>
          {value}
        </span>
      </div>
    );
  }

  // Cargo code (key field)
  if (fieldKey === 'cargo_code') {
    return (
      <div
        className={`sheet-cell sheet-cell--key${isActive ? ' sheet-cell--active' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: COL_WIDTH_SHIPMENT, height: ROW_HEIGHT }}
        onClick={handleClick}
      >
        <span className="sheet-cell__code">{shipment.cargo_code}</span>
      </div>
    );
  }

  // Default rendering
  return (
    <Tooltip title={value.length > 15 ? value : undefined} mouseEnterDelay={0.5}>
      <div
        className={`sheet-cell sheet-cell--${rowConfig.style}${isActive ? ' sheet-cell--active' : ''}${isEditable ? ' sheet-cell--editable' : ''}${isGapy ? ' sheet-cell--gapy' : ''}`}
        style={{ width: COL_WIDTH_SHIPMENT, height: ROW_HEIGHT }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <span className="sheet-cell__text">{value}</span>
      </div>
    </Tooltip>
  );
}

export const SheetCell = memo(SheetCellInner);
