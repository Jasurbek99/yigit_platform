import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAdminImportFirms } from '@/hooks/useAdmin';

interface IImportFirmSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

/**
 * Self-fetching import-firm Select.
 * Wraps useAdminImportFirms() — the page never duplicates the query.
 * Display label: name_short if set, otherwise name_company.
 * onChange emits the primitive ID (number | null).
 */
export function ImportFirmSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: IImportFirmSelectProps) {
  const { t } = useTranslation();
  const { data: firms = [], isLoading } = useAdminImportFirms();

  const options = firms
    .filter((f) => f.is_active)
    .map((f) => ({
      value: f.id,
      label: f.name_short || f.name_company,
    }));

  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      showSearch
      loading={isLoading}
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('split.row_import_firm_ph')}
      size={size}
      style={style}
      filterOption={(input, option) =>
        (String(option?.label ?? '')).toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
