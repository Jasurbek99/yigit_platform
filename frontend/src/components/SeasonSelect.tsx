import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSeasons } from '@/hooks/useAdmin';

interface ISeasonSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

/**
 * Self-fetching Select for Season reference data.
 * Defaults to showing the active season first.
 * Emits number | null via onChange.
 */
export function SeasonSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
}: ISeasonSelectProps) {
  const { t } = useTranslation();
  const { data: seasons = [], isLoading } = useSeasons();

  const options = seasons
    .slice()
    .sort((a, b) => {
      // Active season first, then newest by name
      if (a.is_active && !b.is_active) return -1;
      if (!a.is_active && b.is_active) return 1;
      return b.name.localeCompare(a.name);
    })
    .map((s) => ({
      value: s.id,
      label: s.is_active ? `${s.name} ★` : s.name,
    }));

  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      loading={isLoading}
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('common.select_season')}
      size={size}
      style={style}
    />
  );
}
