import { useMemo, useState } from 'react';
import { Select, Button, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDrivers, useCreateDriver } from '@/hooks/useFleet';

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
}

/**
 * Self-fetching driver picker over the Z_TIRWEB registry (active drivers only —
 * a deactivated driver must not be offerable on a shipment), with inline
 * "+ Add" that creates a registry row and selects it in one step.
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
}: IDriverSelectProps) {
  const { t } = useTranslation();
  const { data: drivers } = useDrivers();
  const createDriver = useCreateDriver();
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

  async function handleAdd() {
    // Registry names are stored upper-case (that is how Z_TIRWEB holds all of
    // them), so an inline add matches rather than creating a near-duplicate.
    const name = norm(search);
    if (!name) return;
    try {
      const created = await createDriver.mutateAsync(name);
      setSearch('');
      // Emit the created name directly — `drivers` won't include it until the
      // list invalidation refetch lands, so a lookup here would miss.
      onChange?.(created.id, created.name, created.phone);
    } catch {
      toast.error(t('shipment_edit_drawer.save_error'));
    }
  }

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
              <Button
                type="text"
                icon={<PlusOutlined />}
                loading={createDriver.isPending}
                style={{ width: '100%', textAlign: 'left' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAdd}
              >
                {t('shipment_edit_drawer.add_driver', { name: norm(search) })}
              </Button>
            </>
          )}
        </>
      )}
    />
  );
}

/**
 * The fields a driver pick writes onto a shipment.
 *
 * `driver_phone` (Sheet R28) is included ONLY when the registry actually holds
 * one. Z_TIRWEB supplies no phones at all, while 80 of the 146 shipments carry a
 * number an operator typed by hand — so writing an empty registry value would
 * do nothing but erase their work. A registry phone is newer information and
 * does replace what is there; a blank one is not information at all.
 *
 * Clearing the driver deliberately leaves `driver_phone` alone for the same
 * reason: R28 is its own cell with its own history, and the operator's number
 * is not ours to wipe.
 */
export function driverPatchFields(
  id: number | null,
  name: string,
  phone: string | null,
): { driver_id: number | null; driver_name: string; driver_phone?: string } {
  const fields = { driver_id: id, driver_name: name };
  const trimmed = phone?.trim();
  return trimmed ? { ...fields, driver_phone: trimmed } : fields;
}
