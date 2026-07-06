import { Select } from 'antd';
import type { SizeType } from 'antd/es/config-provider/SizeContext';
import { useTranslation } from 'react-i18next';
import { usePackingPresets } from '@/hooks/usePackingPresets';
import type { PackingProductType } from '@/types/packingPreset';

interface IPackingPresetSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: SizeType;
  style?: React.CSSProperties;
  /** When provided, filters options to this product type. */
  productType?: PackingProductType;
}

/**
 * Self-fetching select for packing presets.
 * Shows only active presets, optionally filtered by product_type.
 * Option label: "{name} — {net_kg} net / {pallet_count} pal"
 * Emits primitive id via onChange, not the full object.
 */
export function PackingPresetSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
  productType,
}: IPackingPresetSelectProps): JSX.Element {
  const { t } = useTranslation();
  const { data = [], isLoading } = usePackingPresets({ product_type: productType });

  const options = data.map((preset) => ({
    value: preset.id,
    label: `${preset.name} — ${parseFloat(preset.net_kg).toLocaleString()} net / ${parseFloat(preset.pallet_count).toLocaleString()} pal`,
  }));

  return (
    <Select
      value={value}
      onChange={(val) => onChange?.(val ?? null)}
      options={options}
      loading={isLoading}
      showSearch
      optionFilterProp="label"
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('packing_preset.select_placeholder')}
      size={size}
      style={style}
    />
  );
}
