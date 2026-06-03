import { Select } from 'antd';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { buildSearchBlob, normalizeSearch } from '@/utils/normalizeSearch';

interface ISelectOption {
  id: number;
  name: string;
}

interface ICustomerSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

interface ICustomerOption {
  value: number;
  label: string;
  searchBlob: string;
}

export function CustomerSelect({
  value,
  onChange,
  disabled,
  allowClear,
  placeholder,
  size,
  style,
}: ICustomerSelectProps) {
  const { t } = useTranslation();

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['core', 'customers'],
    queryFn: async () => {
      const { data } = await api.get<{ results: ISelectOption[] }>('/core/customers/?page_size=500');
      return data.results;
    },
    staleTime: 5 * 60_000,
  });

  const options = useMemo<ICustomerOption[]>(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: c.name,
        searchBlob: buildSearchBlob([c.name]),
      })),
    [customers],
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
      placeholder={placeholder ?? t('shipment_create.customer')}
      size={size}
      style={style}
      filterOption={(input, option) => {
        const needle = normalizeSearch(input);
        if (!needle) return true;
        return (option as unknown as ICustomerOption).searchBlob.includes(needle);
      }}
    />
  );
}
