import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select, Typography } from 'antd';

const { Text } = Typography;
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useTruckHeads, useTrailers, useCreateTrailer } from '@/hooks/useFleet';
import { composeTruckPlate } from '@/utils/truckPlate';
import { useAnchoredCellPanel } from './useAnchoredCellPanel';

interface ISheetTruckSelectEditorProps {
  initialHeadId: number | null;
  initialHead2Id: number | null;
  initialTrailerId: number | null;
  onCommit: (fields: {
    truck_head_id: number | null;
    trailer_id: number | null;
    truck_plate: string;
    truck_head_2_id: number | null;
    truck_plate_2: string;
  }) => void;
  onClose: () => void;
}

/**
 * Sheet-cell overlay for the `truck_plate` virtual cell (non-Gapy-Satys
 * shipments only — see SheetCellEditor's gapy branch). Two fleet selects +
 * a Done button; mirrors ShipmentTruckSelector's inline-add and
 * controlled-searchValue-clear patterns but defers saving until commit
 * (Done / outside-click) instead of saving on every change, since this is a
 * single overlay covering five backing fields in one PATCH.
 *
 * The second head (2026-09-10) is the same truck's tractor after it is
 * exchanged mid-route — a transshipment or a border swap — while the trailer
 * stays with the load. That is why there is a second head and deliberately no
 * second trailer, and why `truck_plate_2` holds a bare tractor plate where
 * `truck_plate` holds the composed `"{head}/{trailer}"`.
 *
 * The portal / position:fixed / re-anchor-on-scroll / dropdown-exclusion
 * machinery lives in `useAnchoredCellPanel`, shared with
 * SheetDriverSelectEditor.
 */
export default function SheetTruckSelectEditor({
  initialHeadId,
  initialHead2Id,
  initialTrailerId,
  onCommit,
  onClose,
}: ISheetTruckSelectEditorProps) {
  const { t } = useTranslation();
  const { data: truckHeads } = useTruckHeads();
  const { data: trailers } = useTrailers();
  const createTrailer = useCreateTrailer();

  const [headId, setHeadId] = useState<number | null>(initialHeadId);
  const [head2Id, setHead2Id] = useState<number | null>(initialHead2Id);
  const [trailerId, setTrailerId] = useState<number | null>(initialTrailerId);
  const [headSearch, setHeadSearch] = useState('');
  const [head2Search, setHead2Search] = useState('');
  const [trailerSearch, setTrailerSearch] = useState('');

  const committedRef = useRef(false);
  // Just-created plates aren't in `truckHeads`/`trailers` yet (list refetch
  // is async) — remember them here so commit() composes truck_plate from the
  // real new plate, not a blank lookup miss (SP3c `knownPlates` lesson).
  const createdPlates = useRef<{ head?: string; trailer?: string }>({});

  const plateFor = (id: number | null) =>
    (truckHeads ?? []).find((h) => h.id === id)?.plate_number ?? '';

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    if (headId === initialHeadId && head2Id === initialHead2Id && trailerId === initialTrailerId) {
      onClose();
      return;
    }
    const headPlate = createdPlates.current.head ?? plateFor(headId);
    const trailerPlate =
      createdPlates.current.trailer ?? (trailers ?? []).find((r) => r.id === trailerId)?.plate_number ?? '';
    onCommit({
      truck_head_id: headId,
      trailer_id: trailerId,
      truck_plate: composeTruckPlate(headPlate, trailerPlate),
      truck_head_2_id: head2Id,
      // Bare tractor plate — the second head takes over the same trailer, so
      // composing it with one would print the trailer twice on the CMR.
      truck_plate_2: plateFor(head2Id),
    });
  }

  const { anchorRef, panelRef, coords } = useAnchoredCellPanel(() => commit());

  const norm = (s: string) => s.trim().toUpperCase();
  const headExists = (truckHeads ?? []).some((h) => norm(h.plate_number) === norm(headSearch));
  const head2Exists = (truckHeads ?? []).some((h) => norm(h.plate_number) === norm(head2Search));
  const trailerExists = (trailers ?? []).some((r) => norm(r.plate_number) === norm(trailerSearch));

  // `addHead` was removed on 2026-09-10 — a truck head needs a `truck_model`,
  // which this one-line control cannot collect, so the create would 400.
  // Trailers are unaffected; `addTrailer` below still works.

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
            width: 300,
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            padding: 8,
          }}
        >
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 2 }}>
            {t('shipment_edit_drawer.field.truck_head')}
          </Text>
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
            listHeight={320}
            style={{ width: '100%', marginBottom: 8 }}
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
                  <Text
                    type="secondary"
                    style={{ display: 'block', padding: '4px 12px 8px' }}
                  >
                    {t('shipment_edit_drawer.truck_not_found_hint')}
                  </Text>
                )}
              </>
            )}
          />
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 2 }}>
            {t('shipment_edit_drawer.field.trailer')}
          </Text>
          <Select
            aria-label={t('shipment_edit_drawer.field.trailer')}
            showSearch
            allowClear
            listHeight={320}
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
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 2 }}>
            {`${t('shipment_edit_drawer.field.truck_head')} 2`}
          </Text>
          <Select
            aria-label={`${t('shipment_edit_drawer.field.truck_head')} 2`}
            showSearch
            allowClear
            listHeight={320}
            style={{ width: '100%', marginBottom: 8 }}
            value={head2Id ?? undefined}
            options={(truckHeads ?? []).map((h) => ({ value: h.id, label: h.plate_number }))}
            filterOption={(input, option) =>
              ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
            }
            popupMatchSelectWidth={false}
            searchValue={head2Search}
            onSearch={setHead2Search}
            onChange={(v) => {
              setHead2Id((v as number) ?? null);
              setHead2Search('');
            }}
            placeholder={`${t('shipment_edit_drawer.field.truck_head')} 2`}
            dropdownRender={(menu) => (
              <>
                {menu}
                {head2Search.trim() && !head2Exists && (
                  <Text type="secondary" style={{ display: 'block', padding: '4px 12px 8px' }}>
                    {t('shipment_edit_drawer.truck_not_found_hint')}
                  </Text>
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
