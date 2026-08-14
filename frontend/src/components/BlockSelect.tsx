import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useGreenhouseBlocks } from '@/hooks/useAdmin';

// ─── Shared props ─────────────────────────────────────────────────────────

interface IBlockSelectBaseProps {
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
  /** Exclude specific block ids from the dropdown (e.g. already-selected blocks in composer) */
  excludeIds?: number[];
  /** When provided, restrict the dropdown to ONLY these block ids (e.g. blocks
   *  that have forecast remaining — drafts must be built from the forecast pool). */
  allowedIds?: number[];
}

// ─── Single-select overload ───────────────────────────────────────────────

interface IBlockSelectSingleProps extends IBlockSelectBaseProps {
  mode?: undefined;
  value?: number | null;
  onChange?: (value: number | null) => void;
}

// ─── Multi-select overload ────────────────────────────────────────────────

interface IBlockSelectMultipleProps extends IBlockSelectBaseProps {
  mode: 'multiple';
  value?: number[];
  onChange?: (value: number[]) => void;
}

export type IBlockSelectProps = IBlockSelectSingleProps | IBlockSelectMultipleProps;

// ─── Component ────────────────────────────────────────────────────────────

/**
 * Self-fetching Select for GreenhouseBlock reference data.
 * Supports single-select (default) and mode="multiple".
 * Single: emits number | null. Multiple: emits number[].
 */
export function BlockSelect(props: IBlockSelectProps) {
  const { disabled, allowClear = true, placeholder, size, style, excludeIds = [], allowedIds } = props;
  const { t } = useTranslation();
  const { data: blocks = [] } = useGreenhouseBlocks();

  const options = blocks
    .filter(
      (b) =>
        b.is_active &&
        !excludeIds.includes(b.id) &&
        (allowedIds === undefined || allowedIds.includes(b.id)),
    )
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

  const filterOption = (input: string, option: { label?: string } | undefined) =>
    (option?.label ?? '').toLowerCase().includes(input.toLowerCase());

  if (props.mode === 'multiple') {
    return (
      <Select
        mode="multiple"
        value={props.value ?? []}
        onChange={(v) => props.onChange?.(v)}
        options={options}
        showSearch
        allowClear={allowClear}
        disabled={disabled}
        placeholder={placeholder ?? t('draft.composer_block_ph')}
        size={size}
        style={style}
        filterOption={filterOption}
      />
    );
  }

  return (
    <Select
      value={props.value ?? undefined}
      onChange={(v: number | undefined) => props.onChange?.(v ?? null)}
      options={options}
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('draft.composer_block_ph')}
      size={size}
      style={style}
      filterOption={filterOption}
    />
  );
}
