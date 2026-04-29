import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useCrateTypes } from '@/hooks/useAdmin';

interface ICrateTypeSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

/**
 * Self-fetching Select for CrateType reference data.
 * Only shows active crate types (is_active = true).
 * Label format: "{name} ({weight_kg} kg)"
 * Emits the primitive crate type id (number | null) via onChange.
 */
export function CrateTypeSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: ICrateTypeSelectProps) {
  const { t } = useTranslation();
  const { data: crateTypes = [] } = useCrateTypes();

  const options = crateTypes
    .filter((ct) => ct.is_active)
    .map((ct) => ({
      value: ct.id,
      label: `${ct.name} (${ct.weight_kg} kg)`,
    }));

  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('pallet.col_crate_type')}
      size={size}
      style={style}
      filterOption={(input, option) =>
        (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
