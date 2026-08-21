import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDrivers, useCreateDriver } from '@/hooks/useFleet';

interface ISheetDriverSelectEditorProps {
  initialDriverId: number | null;
  onCommit: (fields: { driver_id: number | null; driver_name: string }) => void;
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
 * `driver_phone` (R28) is deliberately NOT written here — it is its own cell
 * with its own comment thread and edit history, and 80 of the values in it were
 * typed by operators. Picking a driver must not reach across and overwrite it.
 *
 * The portal / position:fixed / one-shot-measure / dropdown-exclusion /
 * scroll-commit machinery below is copied from SheetTruckSelectEditor rather
 * than shared — see that file for why each piece exists.
 */
export default function SheetDriverSelectEditor({
  initialDriverId,
  onCommit,
  onClose,
}: ISheetDriverSelectEditorProps) {
  const { t } = useTranslation();
  const { data: drivers } = useDrivers();
  const createDriver = useCreateDriver();

  const [driverId, setDriverId] = useState<number | null>(initialDriverId);
  const [search, setSearch] = useState('');

  const anchorRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(false);
  // A just-created driver isn't in `drivers` yet (list refetch is async) —
  // remember the name so commit() sends the real one, not a lookup miss.
  const createdName = useRef<string | undefined>(undefined);

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    if (driverId === initialDriverId) {
      onClose();
      return;
    }
    const name = createdName.current ?? (drivers ?? []).find((d) => d.id === driverId)?.name ?? '';
    onCommit({ driver_id: driverId, driver_name: name });
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

  const norm = (s: string) => s.trim().toUpperCase();
  const nameExists = (drivers ?? []).some((d) => norm(d.name) === norm(search));

  async function addDriver() {
    // Registry names are stored upper-case (that is how Z_TIRWEB holds all 152),
    // so an inline add matches rather than creating a near-duplicate.
    const name = search.trim().toUpperCase();
    if (!name) return;
    try {
      const created = await createDriver.mutateAsync(name);
      createdName.current = created.name;
      setDriverId(created.id);
      setSearch('');
    } catch {
      toast.error(t('shipment_edit_drawer.save_error'));
    }
  }

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
          <Select
            aria-label={t('shipment_edit_drawer.field.driver_name')}
            autoFocus
            showSearch
            allowClear
            style={{ width: '100%', marginBottom: 8 }}
            value={driverId ?? undefined}
            options={(drivers ?? []).map((d) => ({ value: d.id, label: d.name }))}
            filterOption={(input, option) =>
              ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
            }
            popupMatchSelectWidth={false}
            searchValue={search}
            onSearch={setSearch}
            onChange={(v) => {
              // A manual pick/clear supersedes any earlier inline-add — the
              // registry lookup in commit() is authoritative again.
              createdName.current = undefined;
              setDriverId((v as number) ?? null);
              setSearch('');
            }}
            placeholder={t('shipment_edit_drawer.field.driver_name')}
            dropdownRender={(menu) => (
              <>
                {menu}
                {search.trim() && !nameExists && (
                  <Button
                    type="text"
                    loading={createDriver.isPending}
                    style={{ width: '100%', textAlign: 'left' }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={addDriver}
                  >
                    {t('shipment_edit_drawer.add_driver', { name: search.trim().toUpperCase() })}
                  </Button>
                )}
              </>
            )}
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
