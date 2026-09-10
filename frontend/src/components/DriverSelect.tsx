import { useMemo, useState } from 'react';
import { Select, Divider, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useDrivers } from '@/hooks/useFleet';

const { Text } = Typography;

interface IDriverSelectProps {
  value?: number | null;
  /**
   * Emits the driver id, its name AND its registry phone, because every
   * consumer writes the first two and conditionally the third: `driver_id` is
   * the link into Z_TIRWEB's id space, `driver_name` is what the Sheet, PDFs
   * and every existing report read, and `phone` feeds R28 via
   * `driverPatchFields()`. Clearing emits `(null, '', null)` — id and name must
   * never drift apart. This is the one deviation from the "emit the primitive
   * id only" rule in frontend/CLAUDE.md; these are further primitives, not the
   * option object.
   */
  onChange?: (id: number | null, name: string, phone: string | null) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  style?: React.CSSProperties;
  ariaLabel?: string;
  placeholder?: string;
  /** Option-list height in px. The Sheet overlay gives it more room than the
   *  drawer does, since scrolling 150 drivers in a 256px list is the whole
   *  complaint the taller list answers. */
  listHeight?: number;
}

/**
 * Self-fetching driver picker over the Z_TIRWEB registry (active drivers only —
 * a deactivated driver must not be offerable on a shipment).
 *
 * There is no inline "+ Add" any more (2026-09-10). A driver now needs a
 * passport serial and issue date to exist at all, which the API enforces on
 * create, and this one-line control has nowhere to collect them — the button
 * would simply 400. Creating a driver is Fleet Management's job now, and the
 * empty state says so.
 *
 * Shared by `ShipmentDriverSelector` (Detail card + edit drawer, saves on
 * change) and `SheetDriverSelectEditor` (Sheet R27, defers to a Done button),
 * so the option list, filtering and inline-add live in one place.
 */
export function DriverSelect({
  value,
  onChange,
  disabled,
  autoFocus,
  style,
  ariaLabel,
  placeholder,
  listHeight,
}: IDriverSelectProps) {
  const { t } = useTranslation();
  const { data: drivers } = useDrivers();
  const [search, setSearch] = useState('');

  // Two drivers can carry the same name (ids 30/31 are both
  // BATYROW BAYRAMMYRAT, kept apart only by their Logo code), so append the
  // code to the label — but ONLY for names that actually repeat, or 150
  // unambiguous rows would carry noise. The label stays a plain string because
  // `optionFilterProp="label"` filters on it, which also makes the code
  // searchable for the rows that show one.
  const options = useMemo(() => {
    const list = drivers ?? [];
    const seen = new Map<string, number>();
    for (const d of list) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
    return list.map((d) => ({
      value: d.id,
      label:
        (seen.get(d.name) ?? 0) > 1 && d.driver_logo_code
          ? `${d.name} · ${d.driver_logo_code}`
          : d.name,
    }));
  }, [drivers]);

  const norm = (s: string) => s.trim().toUpperCase();
  const exists = (drivers ?? []).some((d) => norm(d.name) === norm(search));
  const label = ariaLabel ?? t('shipment_edit_drawer.field.driver_name');

  return (
    <Select
      aria-label={label}
      autoFocus={autoFocus}
      showSearch
      allowClear
      disabled={disabled}
      style={style ?? { width: '100%' }}
      value={value ?? undefined}
      options={options}
      optionFilterProp="label"
      listHeight={listHeight}
      popupMatchSelectWidth={false}
      searchValue={search}
      onSearch={setSearch}
      placeholder={placeholder ?? label}
      onChange={(v) => {
        setSearch('');
        const id = (v as number | undefined) ?? null;
        const picked = id === null ? undefined : (drivers ?? []).find((d) => d.id === id);
        onChange?.(id, picked?.name ?? '', picked?.phone ?? null);
      }}
      dropdownRender={(menu) => (
        <>
          {menu}
          {search.trim() && !exists && (
            <>
              <Divider style={{ margin: '4px 0' }} />
              <Text type="secondary" style={{ display: 'block', padding: '4px 12px 8px' }}>
                {t('shipment_edit_drawer.driver_not_found_hint')}
              </Text>
            </>
          )}
        </>
      )}
    />
  );
}

/** One driver pick, with the driver it replaces. */
export interface IDriverPick {
  /**
   * The driver on the shipment BEFORE this pick. It is what decides whether a
   * number already sitting in the phone cell still belongs to the person now
   * named — see `pickedPhone()`.
   */
  previousId: number | null;
  id: number | null;
  name: string;
  phone: string | null;
}

/**
 * The phone a driver pick writes, or `undefined` to leave the phone cell alone.
 *
 * A registry phone always wins: it is newer information about this person.
 *
 * With no registry phone there are two cases, and they are opposites:
 *
 * - Swapping one known driver for a DIFFERENT one — the number in the cell was
 *   the previous driver's, so it must go, or the row ends up naming Berdimurat
 *   and carrying Aman's number. Send `''` (what a manually cleared phone cell
 *   sends too).
 * - Filling an empty slot, or clearing the driver — leave it. A number typed
 *   before the registry link existed is almost certainly about this same
 *   person, and the phone cell has its own history and its own comment thread.
 *   Z_TIRWEB supplies no phones at all while 80 of the 146 shipments carry a
 *   hand-typed one, so a blank registry value must never erase that work.
 */
function pickedPhone({ previousId, id, phone }: IDriverPick): string | undefined {
  const trimmed = phone?.trim();
  if (trimmed) return trimmed;
  return previousId !== null && id !== null && id !== previousId ? '' : undefined;
}

/** The fields a driver pick writes onto a shipment. */
export function driverPatchFields(
  pick: IDriverPick,
): { driver_id: number | null; driver_name: string; driver_phone?: string } {
  const fields = { driver_id: pick.id, driver_name: pick.name };
  const phone = pickedPhone(pick);
  return phone === undefined ? fields : { ...fields, driver_phone: phone };
}

/**
 * The same three fields for the truck's SECOND driver.
 *
 * A truck runs the long legs with two drivers and both are named on the
 * invoice and the CMR. The phone rule is identical to the first driver's, so
 * both go through `pickedPhone()`.
 */
export function driver2PatchFields(
  pick: IDriverPick,
): { driver_2_id: number | null; driver_2_name: string; driver_2_phone?: string } {
  const fields = { driver_2_id: pick.id, driver_2_name: pick.name };
  const phone = pickedPhone(pick);
  return phone === undefined ? fields : { ...fields, driver_2_phone: phone };
}
