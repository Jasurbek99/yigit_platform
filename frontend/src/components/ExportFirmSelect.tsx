import { Select } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminFirms } from '@/hooks/useAdmin';
import { buildSearchBlob, normalizeSearch } from '@/utils/normalizeSearch';

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

interface IFirmOption {
  value: number;
  label: string;
  searchBlob: string;
}

/**
 * Self-fetching Select for ExportFirm reference data.
 * Searchable by code + name_tk + name_ru + name_en (punctuation- and
 * diacritic-insensitive). Label shows code and Turkmen name.
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

  const options = useMemo<IFirmOption[]>(
    () =>
      firms
        .filter((f) => f.is_active && !excludeIds.includes(f.id))
        .map((f) => {
          const displayName = f.name_tk || f.name_ru || f.name_en || f.code;
          return {
            value: f.id,
            label: f.code ? `${displayName} · ${f.code}` : displayName,
            searchBlob: buildSearchBlob([
              f.code,
              f.name_tk,
              f.name_ru,
              f.name_en,
            ]),
          };
        }),
    [firms, excludeIds],
  );

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
      filterOption={(input, option) => {
        const needle = normalizeSearch(input);
        if (!needle) return true;
        return (option as unknown as IFirmOption).searchBlob.includes(needle);
      }}
    />
  );
}
