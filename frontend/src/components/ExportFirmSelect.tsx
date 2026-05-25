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
  /** IDs to exclude from the options list (e.g. already selected in other rows). */
  excludeIds?: number[];
}

/**
 * Self-fetching Select for ExportFirm reference data.
 * Emits number | null via onChange. Filters to is_active=true.
 */
export function ExportFirmSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
  excludeIds = [],
}: IExportFirmSelectProps) {
  const { t } = useTranslation();
  const { data: firms = [], isLoading } = useAdminFirms();

  const options = firms
    .filter((f) => f.is_active && !excludeIds.includes(f.id))
    .map((f) => ({
      value: f.id,
      label: f.name_tk,
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
      placeholder={placeholder ?? t('common.select_export_firm')}
      size={size}
      style={style}
      filterOption={(input, option) =>
        String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
