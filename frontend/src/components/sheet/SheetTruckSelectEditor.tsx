import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useTruckHeads, useTrailers, useCreateTruckHead, useCreateTrailer } from '@/hooks/useFleet';
import { composeTruckPlate } from '@/utils/truckPlate';

interface ISheetTruckSelectEditorProps {
  initialHeadId: number | null;
  initialTrailerId: number | null;
  onCommit: (fields: { truck_head_id: number | null; trailer_id: number | null; truck_plate: string }) => void;
  onClose: () => void;
}

/**
 * Sheet-cell overlay for the `truck_plate` virtual cell (non-Gapy-Satys
 * shipments only — see SheetCellEditor's gapy branch). Two fleet selects +
 * a Done button; mirrors ShipmentTruckSelector's inline-add and
 * controlled-searchValue-clear patterns but defers saving until commit
 * (Done / outside-click) instead of saving on every change, since this is a
 * single overlay covering three backing fields in one PATCH.
 */
export default function SheetTruckSelectEditor({
  initialHeadId,
  initialTrailerId,
  onCommit,
  onClose,
}: ISheetTruckSelectEditorProps) {
  const { t } = useTranslation();
  const { data: truckHeads } = useTruckHeads();
  const { data: trailers } = useTrailers();
  const createHead = useCreateTruckHead();
  const createTrailer = useCreateTrailer();

  const [headId, setHeadId] = useState<number | null>(initialHeadId);
  const [trailerId, setTrailerId] = useState<number | null>(initialTrailerId);
  const [headSearch, setHeadSearch] = useState('');
  const [trailerSearch, setTrailerSearch] = useState('');

  // `.sheet-cell` has `contain: layout paint` and `.sheet-grid` scrolls with
  // overflow — an in-flow-positioned panel gets clipped/mispositioned inside
  // the editing cell. `anchorRef` stays in-flow (so it measures the cell's
  // real on-screen position) while the actual panel is portaled to
  // document.body and placed with `position: fixed` at the anchor's rect —
  // same escape hatch AntD's own Select dropdowns already use below.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef(false);
  // Just-created plates aren't in `truckHeads`/`trailers` yet (list refetch
  // is async) — remember them here so commit() composes truck_plate from the
  // real new plate, not a blank lookup miss (SP3c `knownPlates` lesson).
  const createdPlates = useRef<{ head?: string; trailer?: string }>({});

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    if (headId === initialHeadId && trailerId === initialTrailerId) {
      onClose();
      return;
    }
    const headPlate =
      createdPlates.current.head ?? (truckHeads ?? []).find((h) => h.id === headId)?.plate_number ?? '';
    const trailerPlate =
      createdPlates.current.trailer ?? (trailers ?? []).find((r) => r.id === trailerId)?.plate_number ?? '';
    onCommit({
      truck_head_id: headId,
      trailer_id: trailerId,
      truck_plate: composeTruckPlate(headPlate, trailerPlate),
    });
  }

  // Latest `commit` for the document listener below, without re-subscribing
  // the listener (and without a stale closure) on every keystroke.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // One-shot measurement at open time — the editor is transient (closes on
  // commit/Escape), so no scroll/resize re-tracking is needed. In jsdom
  // (tests) getBoundingClientRect() returns all zeros, which is fine: the
  // panel still renders and is queryable via `screen` since it's portaled
  // to document.body either way.
  useLayoutEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom, left: rect.left });
    }
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      // The Select dropdowns render in an AntD portal on document.body (not
      // as a DOM descendant of panelRef) — deliberately NOT overridden via
      // getPopupContainer, since the sheet grid clips absolutely-positioned
      // descendants with overflow. So a click on an option is "outside"
      // panelRef by DOM containment; excluding `.ant-select-dropdown`
      // prevents that from firing a premature commit() mid-pick.
      const target = e.target as HTMLElement;
      if (panelRef.current && !panelRef.current.contains(target) && !target.closest('.ant-select-dropdown')) {
        commitRef.current();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // The panel is `position: fixed`, measured once at open time (see the
  // one-shot useLayoutEffect above) — it doesn't track the sheet grid's
  // scroll container, so scrolling would leave it visually stranded over
  // the wrong cell. Rather than re-anchoring on every scroll tick, commit
  // and close on the first scroll (matches this editor's transient model).
  // capture=true so this also catches the grid's inner scroll container,
  // not just window-level scroll.
  useEffect(() => {
    function handleScroll() {
      commitRef.current();
    }
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, []);

  const norm = (s: string) => s.trim().toUpperCase();
  const headExists = (truckHeads ?? []).some((h) => norm(h.plate_number) === norm(headSearch));
  const trailerExists = (trailers ?? []).some((r) => norm(r.plate_number) === norm(trailerSearch));

  async function addHead() {
    const plate = headSearch.trim().toUpperCase();
    if (!plate) return;
    try {
      const created = await createHead.mutateAsync(plate);
      createdPlates.current.head = created.plate_number;
      setHeadId(created.id);
      setHeadSearch('');
    } catch {
      toast.error(t('shipment_edit_drawer.save_error'));
    }
  }

  async function addTrailer() {
    const plate = trailerSearch.trim().toUpperCase();
    if (!plate) return;
    try {
      const created = await createTrailer.mutateAsync(plate);
      createdPlates.current.trailer = created.plate_number;
      setTrailerId(created.id);
      setTrailerSearch('');
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
          data-testid="sheet-truck-select-editor"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              // Guard against a late outside-click/scroll committing a
              // cancelled selection after Escape has already closed the panel.
              committedRef.current = true;
              onClose();
            }
          }}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            zIndex: 1000,
            minWidth: 220,
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            padding: 8,
          }}
        >
          <Select
            aria-label={t('shipment_edit_drawer.field.truck_head')}
            // SheetCellEditor's mount-time auto-focus finds the editor's
            // first input via `containerRef.querySelector` — that only
            // reaches DOM descendants of the cell, and the Select inputs are
            // no longer descendants once portaled out. Focus it ourselves so
            // opening the cell still drops the caret straight into the head
            // picker.
            autoFocus
            showSearch
            allowClear
            style={{ width: '100%', marginBottom: 4 }}
            value={headId ?? undefined}
            options={(truckHeads ?? []).map((h) => ({ value: h.id, label: h.plate_number }))}
            filterOption={(input, option) =>
              ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
            }
            popupMatchSelectWidth={false}
            searchValue={headSearch}
            onSearch={setHeadSearch}
            onChange={(v) => {
              // A manual pick/clear supersedes any earlier inline-add — the fleet
              // list lookup below is authoritative again.
              createdPlates.current.head = undefined;
              setHeadId((v as number) ?? null);
              setHeadSearch('');
            }}
            placeholder={t('shipment_edit_drawer.field.truck_head')}
            dropdownRender={(menu) => (
              <>
                {menu}
                {headSearch.trim() && !headExists && (
                  <Button
                    type="text"
                    loading={createHead.isPending}
                    style={{ width: '100%', textAlign: 'left' }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={addHead}
                  >
                    {t('shipment_edit_drawer.add_truck', { plate: headSearch.trim() })}
                  </Button>
                )}
              </>
            )}
          />
          <Select
            aria-label={t('shipment_edit_drawer.field.trailer')}
            showSearch
            allowClear
            style={{ width: '100%', marginBottom: 8 }}
            value={trailerId ?? undefined}
            options={(trailers ?? []).map((r) => ({ value: r.id, label: r.plate_number }))}
            filterOption={(input, option) =>
              ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
            }
            popupMatchSelectWidth={false}
            searchValue={trailerSearch}
            onSearch={setTrailerSearch}
            onChange={(v) => {
              // A manual pick/clear supersedes any earlier inline-add — the fleet
              // list lookup below is authoritative again.
              createdPlates.current.trailer = undefined;
              setTrailerId((v as number) ?? null);
              setTrailerSearch('');
            }}
            placeholder={t('shipment_edit_drawer.field.trailer')}
            dropdownRender={(menu) => (
              <>
                {menu}
                {trailerSearch.trim() && !trailerExists && (
                  <Button
                    type="text"
                    loading={createTrailer.isPending}
                    style={{ width: '100%', textAlign: 'left' }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={addTrailer}
                  >
                    {t('shipment_edit_drawer.add_trailer', { plate: trailerSearch.trim() })}
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
