import { Select } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminImportFirms } from '@/hooks/useAdmin';
import { buildSearchBlob, normalizeSearch } from '@/utils/normalizeSearch';

interface IImportFirmSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

interface IFirmOption {
  value: number;
  label: string;
  searchBlob: string;
}

/**
 * Self-fetching Select for ImportFirm reference data.
 * Searchable by code + name_short + name_company (punctuation- and
 * diacritic-insensitive). Label shows short name with the code appended
 * when it differs.
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

  const options = useMemo<IFirmOption[]>(
    () =>
      firms
        .filter((f) => f.is_active)
        .map((f) => {
          const displayName = f.name_short || f.name_company;
          const showCode = f.code && f.code !== displayName;
          return {
            value: f.id,
            label: showCode ? `${displayName} · ${f.code}` : displayName,
            searchBlob: buildSearchBlob([
              f.code,
              f.name_short,
              f.name_company,
            ]),
          };
        }),
    [firms],
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
      placeholder={placeholder ?? t('common.select_import_firm')}
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
