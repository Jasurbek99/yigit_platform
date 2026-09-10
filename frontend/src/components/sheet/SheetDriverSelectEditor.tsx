import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { DriverSelect, driverPatchFields, driver2PatchFields } from '@/components/DriverSelect';
import { useAnchoredCellPanel } from './useAnchoredCellPanel';

const { Text } = Typography;

interface ISheetDriverSelectEditorProps {
  initialDriverId: number | null;
  initialDriver2Id: number | null;
  onCommit: (fields: {
    driver_id?: number | null;
    driver_name?: string;
    driver_phone?: string;
    driver_2_id?: number | null;
    driver_2_name?: string;
    driver_2_phone?: string;
  }) => void;
  onClose: () => void;
}

/**
 * Sheet-cell overlay for the `driver_name` cell (non-Gapy-Satys shipments only
 * — see SheetCellEditor's gapy branch). Two registry selects + a Done button:
 * a truck runs the long legs to Kazakhstan and Russia with two drivers, and
 * both are named on the invoice and the CMR.
 *
 * Commits `driver_id` + `driver_name` together, the way the truck cell commits
 * head/trailer/plate: `driver_id` is the machine link into Z_TIRWEB's id space,
 * `driver_name` is what the sheet, PDFs and every existing report read.
 *
 * `driver_phone` (R28) follows `pickedPhone()`: the registry number when there
 * is one, a blank when this pick swaps in a DIFFERENT driver and the registry
 * has none, and no write at all otherwise. R28 is its own cell with its own
 * comment thread and edit history, and 80 of the values in it were typed by
 * operators.
 *
 * The option list and filtering live in the shared `DriverSelect`
 * (frontend/CLAUDE.md's self-fetching-control rule); the portal /
 * position:fixed / re-anchor-on-scroll / dropdown-exclusion machinery lives in
 * `useAnchoredCellPanel`, shared with SheetTruckSelectEditor.
 */
export default function SheetDriverSelectEditor({
  initialDriverId,
  initialDriver2Id,
  onCommit,
  onClose,
}: ISheetDriverSelectEditorProps) {
  const { t } = useTranslation();

  const [driverId, setDriverId] = useState<number | null>(initialDriverId);
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState<string | null>(null);
  const [driver2Id, setDriver2Id] = useState<number | null>(initialDriver2Id);
  const [driver2Name, setDriver2Name] = useState('');
  const [driver2Phone, setDriver2Phone] = useState<string | null>(null);

  const committedRef = useRef(false);

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    // Each slot contributes to the PATCH only if it actually changed. The name
    // arrives via DriverSelect's onChange, not from a lookup, so an untouched
    // slot holds an empty name — sending it would write a blank over the driver
    // already on the shipment.
    const changed = {
      ...(driverId !== initialDriverId
        ? driverPatchFields({
            previousId: initialDriverId,
            id: driverId,
            name: driverName,
            phone: driverPhone,
          })
        : {}),
      ...(driver2Id !== initialDriver2Id
        ? driver2PatchFields({
            previousId: initialDriver2Id,
            id: driver2Id,
            name: driver2Name,
            phone: driver2Phone,
          })
        : {}),
    };
    if (Object.keys(changed).length === 0) {
      onClose();
      return;
    }
    onCommit(changed);
  }

  const { anchorRef, panelRef, coords } = useAnchoredCellPanel(() => commit());

  return (
    <>
      <span ref={anchorRef} />
      {createPortal(
        <div
          ref={panelRef}
          data-testid="sheet-driver-select-editor"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              committedRef.current = true;
              onClose();
            }
          }}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            zIndex: 1000,
            width: 300,
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            padding: 8,
          }}
        >
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 2 }}>
            {t('shipment_edit_drawer.field.driver_name')}
          </Text>
          <DriverSelect
            autoFocus
            value={driverId}
            listHeight={320}
            style={{ width: '100%', marginBottom: 8 }}
            onChange={(id, name, phone) => {
              setDriverId(id);
              setDriverName(name);
              setDriverPhone(phone);
            }}
          />
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 2 }}>
            {`${t('shipment_edit_drawer.field.driver_name')} 2`}
          </Text>
          <DriverSelect
            value={driver2Id}
            listHeight={320}
            ariaLabel={`${t('shipment_edit_drawer.field.driver_name')} 2`}
            style={{ width: '100%', marginBottom: 8 }}
            onChange={(id, name, phone) => {
              setDriver2Id(id);
              setDriver2Name(name);
              setDriver2Phone(phone);
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button size="small" type="primary" onClick={commit}>
              {t('sheet.multiselect_done')}
            </Button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
