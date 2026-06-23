import { useMemo, useState } from 'react';
import { Select } from 'antd';
import type { SizeType } from 'antd/es/config-provider/SizeContext';
import { useTranslation } from 'react-i18next';
import { useDebounce } from '@/hooks/useDebounce';
import { useMentionable } from '@/hooks/useMentionable';

interface IUserSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: SizeType;
  style?: React.CSSProperties;
}

/**
 * Self-fetching, search-driven Select for users. Emits the primitive user id
 * (number | null). Backed by the mentionable endpoint so any authenticated
 * user can populate it (the admin user-CRUD list is admin/EM only). The picked
 * user's name is cached locally so the chip keeps its label after the search
 * results change.
 */
export function UserSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: IUserSelectProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const debounced = useDebounce(search, 300);
  const { users, isFetching } = useMentionable(debounced);

  const options = useMemo(() => {
    const base = users.map((u) => ({ value: u.id, label: u.name }));
    // Keep the selected user visible even when it drops out of the search results.
    if (picked && value === picked.id && !base.some((o) => o.value === picked.id)) {
      return [{ value: picked.id, label: picked.name }, ...base];
    }
    return base;
  }, [users, picked, value]);

  function handleChange(v: number | undefined): void {
    const id = v ?? null;
    onChange?.(id);
    setPicked(id == null ? null : users.find((u) => u.id === id) ?? picked);
  }

  return (
    <Select
      value={value ?? undefined}
      onChange={handleChange}
      disabled={disabled}
      allowClear={allowClear}
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
