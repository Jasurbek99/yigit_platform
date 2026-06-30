import { useRef, useState } from 'react';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useDebounce } from '@/hooks/useDebounce';
import { useShipments } from '@/hooks/useShipments';

interface IShipmentMultiSelectProps {
  value?: number[];
  onChange?: (value: number[]) => void;
  disabled?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

/**
 * Self-fetching, search-driven multi-Select for shipments. Emits an array of
 * shipment ids (number[]). Searches by shipment code / customer / export code
 * server-side so it never loads the full season at once.
 *
 * Used by the New Advance modal to link an advance to one or more shipments —
 * those links are what flip the Sheet's R24 "Resminama pul berildi" cell to ✓.
 */
export function ShipmentMultiSelect({
  value,
  onChange,
  disabled,
  placeholder,
  size,
  style,
}: IShipmentMultiSelectProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const { data, isFetching } = useShipments({ search: debounced, page_size: 20 });

  // Retain labels for already-picked shipments so their chips keep showing the
  // shipment code after the search query changes the loaded results.
  const labelCache = useRef<Map<number, string>>(new Map());

  const results = data?.results ?? [];
  results.forEach((s) => {
    labelCache.current.set(
      s.id,
      `${s.shipment_code}` +
        `${s.export_code ? ` · ${s.export_code}` : ''}` +
        `${s.customer_name ? ` — ${s.customer_name}` : ''}`,
    );
  });

  const resultIds = new Set(results.map((s) => s.id));
  const selectedNotInResults = (value ?? []).filter((id) => !resultIds.has(id));
  const options = [
    ...results.map((s) => ({ value: s.id, label: labelCache.current.get(s.id) ?? String(s.id) })),
    ...selectedNotInResults.map((id) => ({
      value: id,
      label: labelCache.current.get(id) ?? String(id),
    })),
  ];

  function handleChange(v: number[]): void {
    onChange?.(v ?? []);
  }

  return (
    <Select
      mode="multiple"
      value={value}
      onChange={handleChange}
      disabled={disabled}
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
