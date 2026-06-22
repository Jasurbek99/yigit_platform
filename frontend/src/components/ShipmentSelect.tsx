import { useState } from 'react';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useDebounce } from '@/hooks/useDebounce';
import { useShipments } from '@/hooks/useShipments';
import type { IShipmentListItem } from '@/types';

interface IShipmentSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  /**
   * Fires with the full picked shipment (or null on clear) when the value
   * changes to one currently in the loaded results — lets a parent auto-fill
   * related fields (shipment code, plate) from the chosen shipment.
   */
  onPick?: (shipment: IShipmentListItem | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

/**
 * Self-fetching, search-driven Select for shipments. Emits the primitive
 * shipment id (number | null). Searches by shipment code / customer server-side so
 * it never loads the full season at once.
 */
export function ShipmentSelect({
  value,
  onChange,
  onPick,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: IShipmentSelectProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const { data, isFetching } = useShipments({ search: debounced, page_size: 20 });

  const results = data?.results ?? [];
  // Search covers shipment_code AND export_code server-side; surface the export
  // code in the label so an export-code match is visible in the dropdown.
  const options = results.map((s) => ({
    value: s.id,
    label:
      `${s.shipment_code}` +
      `${s.export_code ? ` · ${s.export_code}` : ''}` +
      `${s.customer_name ? ` — ${s.customer_name}` : ''}`,
  }));

  function handleChange(v: number | undefined): void {
    const id = v ?? null;
    onChange?.(id);
    onPick?.(id == null ? null : results.find((s) => s.id === id) ?? null);
  }

  return (
    <Select
      value={value ?? undefined}
      onChange={handleChange}
      disabled={disabled}
      allowClear={allowClear}
      placeholder={placeholder ?? t('common.search')}
      size={size}
      style={style}
      showSearch
      filterOption={false}
      onSearch={setSearch}
      loading={isFetching}
      options={options}
      notFoundContent={null}
    />
  );
}
