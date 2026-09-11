import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useDrivers, useTruckHeads } from '@/hooks/useFleet';
import { useAuth } from '@/hooks/useAuth';
import { canSeePage } from '@/utils/permissions';
import type { IShipmentSheetItem } from '@/types';

interface ISheetFleetWarningProps {
  shipment: IShipmentSheetItem;
  fieldKey: 'truck_plate' | 'driver_name';
}

/**
 * Warning marker on the Sheet's truck-plate and driver cells: the row is filled
 * in, but the fleet record behind it is not — no truck model, no tech passport
 * scan, no driver passport. Those gaps only surface when a document is being
 * issued, which is far too late, so they are shown where the operator already
 * looks.
 *
 * Rendered ONLY for those two field keys (SheetCell branches on it), which is
 * also why the fleet hooks live here rather than in SheetCell: the grid mounts
 * ~900 cells and this keeps the subscriptions to the two rows that need them.
 *
 * Completeness comes from the API's `missing_details`, not from the passport
 * fields — those reach fleet editors only, so computing it here would show every
 * driver as incomplete to everyone else. The list ships the status without the
 * values for exactly this.
 *
 * Both rig slots are checked. A second driver with no passport is not fine just
 * because the first one is in order.
 */
export function SheetFleetWarning({ shipment, fieldKey }: ISheetFleetWarningProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: drivers } = useDrivers();
  const { data: truckHeads } = useTruckHeads();

  const isDriver = fieldKey === 'driver_name';
  const ids = isDriver
    ? [shipment.driver_id, shipment.driver_2_id]
    : [shipment.truck_head_id, shipment.truck_head_2_id];
  // The Sheet is transposed: these two rows mount one marker per shipment
  // column, so a full season renders ~180 of them. Rebuilding a 150-entry Map
  // in each on every render is exactly the per-cell cost this file avoids
  // elsewhere. React Query hands back stable array references, so this holds.
  const byId = useMemo(
    () =>
      new Map<number, { label: string; missing: string[] }>(
        isDriver
          ? (drivers ?? []).map((d) => [d.id, { label: d.name, missing: d.missing_details ?? [] }])
          : (truckHeads ?? []).map((h) => [
              h.id, { label: h.plate_number, missing: h.missing_details ?? [] },
            ]),
      ),
    [isDriver, drivers, truckHeads],
  );

  // A row the list does not carry — a deactivated driver, say — cannot be
  // judged. Silence beats inventing a warning about a record we cannot see.
  const incomplete = ids
    .map((id) => (id == null ? undefined : byId.get(id)))
    .filter((row) => row !== undefined && row.missing.length > 0)
    .map((row) => row!);

  if (incomplete.length === 0) return null;

  const title = [
    t('sheet.fleet_warning.title'),
    ...incomplete.map(
      (row) =>
        `${row.label}: ${row.missing
          .map((key) => t(`sheet.fleet_warning.missing.${key}`))
          .join(', ')}`,
    ),
  ].join('\n');

  const canOpenFleet = canSeePage(user, 'transport.fleet');

  return (
    <span
      data-testid="sheet-fleet-warning"
      className="sheet-cell__fleet-warning"
      title={title}
      style={{ cursor: canOpenFleet ? 'pointer' : 'default' }}
      onClick={(e) => {
        // The cell opens its editor on a single click; this marker must not.
        e.stopPropagation();
        if (canOpenFleet) navigate(`/admin/fleet?tab=${isDriver ? 'drivers' : 'trucks'}`);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <WarningOutlined />
    </span>
  );
}
