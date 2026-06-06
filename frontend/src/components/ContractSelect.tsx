import { Select } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SizeType } from 'antd/es/config-provider/SizeContext';
import { useContracts } from '@/hooks/useContracts';
import { buildSearchBlob, normalizeSearch } from '@/utils/normalizeSearch';

interface IContractSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: SizeType;
  style?: React.CSSProperties;
  /**
   * When true, includes completed/closed contracts in addition to active ones.
   * Defaults to false (active only).
   */
  includeEnded?: boolean;
}

interface IContractOption {
  value: number;
  label: string;
  searchBlob: string;
}

/**
 * Self-fetching Select for Contract reference data.
 *
 * Label format: "{contract_number} · {export_firm_name} → {import_firm_name}"
 * Searchable by contract_number, export_firm_name, import_firm_name, export_firm_code.
 */
export function ContractSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
  includeEnded = false,
}: IContractSelectProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useContracts({ includeEnded });

  const contracts = data?.results ?? [];

  const options = useMemo<IContractOption[]>(
    () =>
      contracts.map((c) => {
        const exportName = c.export_firm_name ?? c.export_firm_code ?? '';
        const importName = c.import_firm_name ?? '';
        const label = [
          c.contract_number,
          exportName && importName
            ? `${exportName} → ${importName}`
            : exportName || importName,
        ]
          .filter(Boolean)
          .join(' · ');

        return {
          value: c.id,
          label,
          searchBlob: buildSearchBlob([
            c.contract_number,
            c.export_firm_name,
            c.export_firm_code,
            c.import_firm_name,
          ]),
        };
      }),
    [contracts],
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
      placeholder={placeholder ?? t('contracts.select.placeholder')}
      size={size}
      style={style}
      filterOption={(input, option) => {
        const needle = normalizeSearch(input);
        if (!needle) return true;
        return (option as unknown as IContractOption).searchBlob.includes(needle);
      }}
    />
  );
}
