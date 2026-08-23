import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { DriverSelect, driverPatchFields } from '@/components/DriverSelect';

interface ISheetDriverSelectEditorProps {
  initialDriverId: number | null;
  onCommit: (fields: {
    driver_id: number | null;
    driver_name: string;
    driver_phone?: string;
  }) => void;
  onClose: () => void;
}

/**
 * Sheet-cell overlay for the `driver_name` cell (non-Gapy-Satys shipments only
 * — see SheetCellEditor's gapy branch). One registry select + a Done button.
 *
 * Commits `driver_id` + `driver_name` together, the way the truck cell commits
 * head/trailer/plate: `driver_id` is the machine link into Z_TIRWEB's id space,
 * `driver_name` is what the sheet, PDFs and every existing report read.
 *
 * `driver_phone` (R28) is written ONLY when the registry holds one — see
 * `driverPatchFields()`. It is its own cell with its own comment thread and edit
 * history, and 80 of the values in it were typed by operators, so a blank
 * registry value must never reach across and erase one.
 *
 * The option list, filtering and inline-add live in the shared `DriverSelect`
 * (frontend/CLAUDE.md's self-fetching-control rule); only the portal /
 * position:fixed / one-shot-measure / dropdown-exclusion / scroll-commit
 * machinery is local, copied from SheetTruckSelectEditor — see that file for
 * why each piece exists.
 */
export default function SheetDriverSelectEditor({
  initialDriverId,
  onCommit,
  onClose,
}: ISheetDriverSelectEditorProps) {
  const { t } = useTranslation();

  const [driverId, setDriverId] = useState<number | null>(initialDriverId);
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState<string | null>(null);

  const anchorRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(false);

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    if (driverId === initialDriverId) {
      onClose();
      return;
    }
    // DriverSelect hands back the name with the id (including for a row it just
    // created, which the list refetch hasn't landed yet), so there is nothing
    // to look up here.
    onCommit(driverPatchFields(driverId, driverName, driverPhone));
  }

  const commitRef = useRef(commit);
  commitRef.current = commit;

  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom, left: rect.left });
    }
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (panelRef.current && !panelRef.current.contains(target) && !target.closest('.ant-select-dropdown')) {
        commitRef.current();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  useEffect(() => {
    function handleScroll() {
      commitRef.current();
    }
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

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
            minWidth: 240,
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            padding: 8,
          }}
        >
          <DriverSelect
            autoFocus
            value={driverId}
            style={{ width: '100%', marginBottom: 8 }}
            onChange={(id, name, phone) => {
              setDriverId(id);
              setDriverName(name);
              setDriverPhone(phone);
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
