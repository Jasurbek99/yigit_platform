import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAdminFirms } from '@/hooks/useAdmin';

interface IExportFirmSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

/**
 * Self-fetching export-firm Select.
 * Wraps useAdminFirms() — the page never duplicates the query.
 * Label resolves by language: ru → name_ru, tk → name_tk, else name_en.
 * onChange emits the primitive ID (number | null).
 */
export function ExportFirmSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: IExportFirmSelectProps) {
  const { t, i18n } = useTranslation();
  const { data: firms = [], isLoading } = useAdminFirms();

  const options = firms
    .filter((f) => f.is_active)
    .map((f) => ({
      value: f.id,
      label: i18n.language.startsWith('ru')
        ? (f.name_ru || f.name_en || f.name_tk)
        : i18n.language.startsWith('tk')
        ? (f.name_tk || f.name_en || '')
        : (f.name_en || f.name_tk),
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
      placeholder={placeholder ?? t('split.row_export_firm_ph')}
      size={size}
      style={style}
      filterOption={(input, option) =>
        (String(option?.label ?? '')).toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
