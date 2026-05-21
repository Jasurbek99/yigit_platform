import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';

interface IBlockSelectProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
  /** Exclude specific block ids from the dropdown (e.g. already-selected blocks in composer) */
  excludeIds?: number[];
}

/**
 * Self-fetching Select for GreenhouseBlock reference data.
 * Emits the primitive block id (number | null) via onChange.
 */
export function BlockSelect({
  value,
  onChange,
  disabled,
  allowClear = true,
  placeholder,
  size,
  style,
  excludeIds = [],
}: IBlockSelectProps) {
  const { t } = useTranslation();
  const { data: blocks = [] } = useGreenhouseBlocks();

  const options = blocks
    .filter((b) => b.is_active && !excludeIds.includes(b.id))
    .map((b) => ({
      value: b.id,
      // The block name already starts with its code (code "A" → name
      // "A-Ýyladyşhana"), so prepending the code again doubles the letter
      // ("A — A-Ýyladyş…"). Only prepend the code when the name lacks it.
      label:
        b.name && b.name !== b.code && !b.name.startsWith(`${b.code}-`)
          ? `${b.code} — ${b.name}`
          : b.name || b.code,
    }));

  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('draft.composer_block_ph')}
      size={size}
      style={style}
      filterOption={(input, option) =>
        (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
      }
    />
  );
}
