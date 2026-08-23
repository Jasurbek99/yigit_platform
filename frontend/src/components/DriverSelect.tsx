import { useMemo, useState } from 'react';
import { Select, Button, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDrivers, useCreateDriver } from '@/hooks/useFleet';

interface IDriverSelectProps {
  value?: number | null;
  /**
   * Emits the driver id AND its name, because every consumer writes both:
   * `driver_id` is the link into Z_TIRWEB's id space and `driver_name` is what
   * the Sheet, PDFs and every existing report read. Clearing emits
   * `(null, '')` — the two must never drift apart. This is the one deviation
   * from the "emit the primitive id only" rule in frontend/CLAUDE.md; the name
   * is a second primitive, not the option object.
   */
  onChange?: (id: number | null, name: string) => void;
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

  const options = useMemo(
    () => (drivers ?? []).map((d) => ({ value: d.id, label: d.name })),
    [drivers],
  );

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
      onChange?.(created.id, created.name);
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
        onChange?.(id, id === null ? '' : (drivers ?? []).find((d) => d.id === id)?.name ?? '');
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
