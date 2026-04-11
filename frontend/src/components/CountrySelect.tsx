import { useState } from 'react';
import { Select, Button, Divider } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useCountries, useCreateCountry } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';

interface ICountrySelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

export function CountrySelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: ICountrySelectProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchValue, setSearchValue] = useState('');

  const { data: countries = [] } = useCountries();

  const createCountry = useCreateCountry({
    onSuccess: () => setSearchValue(''),
  });

  const canCreate = user?.is_superuser || user?.role === 'director';

  const options = countries.map((c) => ({
    value: c.id,
    label: i18n.language.startsWith('ru')
      ? (c.name_ru || c.name_en || c.name_tk)
      : i18n.language.startsWith('tk')
      ? (c.name_tk || c.name_en || '')
      : (c.name_en || c.name_tk),
  }));

  const hasExactMatch = searchValue
    ? options.some((o) => (o.label ?? '').toLowerCase() === searchValue.toLowerCase())
    : false;

  function handleCreate() {
    if (!searchValue.trim()) return;
    createCountry.mutate(
      { name_tk: searchValue.trim(), name_en: searchValue.trim(), name_ru: searchValue.trim() },
      {
        onSuccess: (newCountry) => {
          onChange?.(newCountry.id);
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
      disabled={disabled}
      placeholder={placeholder ?? t('common.select_country')}
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
                  loading={createCountry.isPending}
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
