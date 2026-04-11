import { useState } from 'react';
import { Select, Button, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useCities, useCreateCity } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';

interface ICitySelectProps {
  countryId?: number | null;
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

export function CitySelect({
  countryId,
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: ICitySelectProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchValue, setSearchValue] = useState('');

  const { data: cities = [] } = useCities(countryId ?? null);

  const createCity = useCreateCity({
    onSuccess: () => setSearchValue(''),
  });

  const canCreate = (user?.is_superuser || user?.role === 'director') && !!countryId;

  const options = cities.map((c) => ({ value: c.id, label: c.name }));

  const hasExactMatch = searchValue
    ? options.some((o) => o.label.toLowerCase() === searchValue.toLowerCase())
    : false;

  function handleCreate() {
    if (!searchValue.trim() || !countryId) return;
    createCity.mutate(
      { name: searchValue.trim(), country: countryId },
      {
        onSuccess: (newCity) => {
          onChange?.(newCity.id);
          setSearchValue('');
        },
      },
    );
  }

  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      showSearch
      allowClear={allowClear}
      disabled={disabled || !countryId}
      placeholder={placeholder ?? t('common.select_city')}
      size={size}
      style={style}
      searchValue={searchValue}
      onSearch={setSearchValue}
      filterOption={(input, option) =>
        (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
      }
      dropdownRender={(menu) => (
        <>
          {menu}
          {canCreate && searchValue.trim() && !hasExactMatch && (
            <>
              <Divider style={{ margin: '4px 0' }} />
              <div style={{ padding: '4px 8px' }}>
                <Button
                  type="text"
                  icon={<PlusOutlined />}
                  size="small"
                  loading={createCity.isPending}
                  onClick={handleCreate}
                  style={{ width: '100%', textAlign: 'left' }}
                >
                  {t('common.create_option', { name: searchValue.trim() })}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    />
  );
}
