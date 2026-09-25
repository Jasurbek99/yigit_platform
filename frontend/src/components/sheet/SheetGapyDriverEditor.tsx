import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, DatePicker, Input, Typography } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useAnchoredCellPanel } from './useAnchoredCellPanel';

const { Text } = Typography;

interface IGapyDriverFields {
  driver_name: string | null;
  driver_phone: string | null;
  driver_passport_serial: string | null;
  driver_passport_issue_date: string | null;
  driver_2_name: string | null;
  driver_2_phone: string | null;
  driver_2_passport_serial: string | null;
  driver_2_passport_issue_date: string | null;
}

interface ISheetGapyDriverEditorProps {
  initial: IGapyDriverFields;
  onCommit: (fields: Partial<IGapyDriverFields>) => void;
  onClose: () => void;
}

/**
 * Sheet-cell overlay for the `driver_name` cell on Gapy-Satys shipments —
 * the free-text counterpart to `SheetDriverSelectEditor`'s fleet picker.
 * Gapy shipments run on the local buyer's own truck and driver — HARD RULE,
 * no link into transport.Driver — so every field here is typed, never
 * picked from a registry.
 *
 * Asks for passport series + issue date alongside the name because document
 * generation (CMR, TIR carnet) needs them and there is no fleet record to
 * fall back on (see `_driver_passports()` in
 * `contracts/services/document_context.py`). `driver_phone` is optional —
 * contact info only, never printed on a document.
 *
 * Two drivers, matching the non-gapy overlay's shape: a truck can run with
 * two drivers on long legs. Both slots commit through this one cell, same
 * as `driver_2_name`/`driver_2_phone` do for non-gapy shipments.
 */
export default function SheetGapyDriverEditor({
  initial,
  onCommit,
  onClose,
}: ISheetGapyDriverEditorProps) {
  const { t } = useTranslation();

  const [name, setName] = useState(initial.driver_name ?? '');
  const [phone, setPhone] = useState(initial.driver_phone ?? '');
  const [passportSerial, setPassportSerial] = useState(initial.driver_passport_serial ?? '');
  const [passportDate, setPassportDate] = useState(initial.driver_passport_issue_date ?? '');
  const [name2, setName2] = useState(initial.driver_2_name ?? '');
  const [phone2, setPhone2] = useState(initial.driver_2_phone ?? '');
  const [passportSerial2, setPassportSerial2] = useState(initial.driver_2_passport_serial ?? '');
  const [passportDate2, setPassportDate2] = useState(initial.driver_2_passport_issue_date ?? '');

  const committedRef = useRef(false);

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;

    const next: IGapyDriverFields = {
      driver_name: name.trim() || null,
      driver_phone: phone.trim() || null,
      driver_passport_serial: passportSerial.trim() || null,
      driver_passport_issue_date: passportDate || null,
      driver_2_name: name2.trim() || null,
      driver_2_phone: phone2.trim() || null,
      driver_2_passport_serial: passportSerial2.trim() || null,
      driver_2_passport_issue_date: passportDate2 || null,
    };

    // Only the keys that actually changed — the shared saveOverlayFields
    // undo snapshot keys off the payload, so an untouched second-driver slot
    // must never ride along as a written blank.
    const changed = (Object.keys(next) as (keyof IGapyDriverFields)[]).reduce<
      Partial<IGapyDriverFields>
    >((acc, key) => {
      if (next[key] !== (initial[key] ?? null)) acc[key] = next[key];
      return acc;
    }, {});

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
          data-testid="sheet-gapy-driver-editor"
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
            width: 320,
            maxHeight: '80vh',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            padding: 8,
          }}
        >
          <Text strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            {t('shipment_edit_drawer.field.driver_name')}
          </Text>
          <Input
            autoFocus
            placeholder={t('shipment_edit_drawer.field.driver_name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <Input
            placeholder={t('shipment_edit_drawer.field.driver_phone')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <Input
            placeholder={t('shipment_edit_drawer.field.driver_passport_serial')}
            value={passportSerial}
            onChange={(e) => setPassportSerial(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <DatePicker
            placeholder={t('shipment_edit_drawer.field.driver_passport_issue_date')}
            value={passportDate ? dayjs(passportDate) : null}
            onChange={(picked) => setPassportDate(picked ? picked.format('YYYY-MM-DD') : '')}
            style={{ width: '100%', marginBottom: 10 }}
          />

          <Text strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            {`${t('shipment_edit_drawer.field.driver_name')} 2`}
          </Text>
          <Input
            placeholder={t('shipment_edit_drawer.field.driver_name')}
            value={name2}
            onChange={(e) => setName2(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <Input
            placeholder={t('shipment_edit_drawer.field.driver_phone')}
            value={phone2}
            onChange={(e) => setPhone2(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <Input
            placeholder={t('shipment_edit_drawer.field.driver_passport_serial')}
            value={passportSerial2}
            onChange={(e) => setPassportSerial2(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <DatePicker
            placeholder={t('shipment_edit_drawer.field.driver_passport_issue_date')}
            value={passportDate2 ? dayjs(passportDate2) : null}
            onChange={(picked) => setPassportDate2(picked ? picked.format('YYYY-MM-DD') : '')}
            style={{ width: '100%', marginBottom: 10 }}
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
