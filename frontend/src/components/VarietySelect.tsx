import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTomatoVarieties } from '@/hooks/useAdmin';

// ─── Shared props ─────────────────────────────────────────────────────────

interface IVarietySelectBaseProps {
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
  excludeIds?: number[];
}

// ─── Single-select overload ───────────────────────────────────────────────

interface IVarietySelectSingleProps extends IVarietySelectBaseProps {
  mode?: undefined;
  value?: number | null;
  onChange?: (value: number | null) => void;
}

// ─── Multi-select overload ────────────────────────────────────────────────

interface IVarietySelectMultipleProps extends IVarietySelectBaseProps {
  mode: 'multiple';
  value?: number[];
  onChange?: (value: number[]) => void;
}

export type IVarietySelectProps = IVarietySelectSingleProps | IVarietySelectMultipleProps;

// ─── Shared option builder ────────────────────────────────────────────────

function buildOptions(varieties: { id: number; code: string | null; name: string; is_experimental: boolean }[], excludeIds: number[]) {
  const filtered = varieties
    .filter((v) => v.code !== null && !excludeIds.includes(v.id))
    .sort((a, b) => {
      if (a.is_experimental !== b.is_experimental) return a.is_experimental ? 1 : -1;
      return (a.code ?? '').localeCompare(b.code ?? '');
    });

  return filtered.map((v) => ({
    value: v.id,
    label: (
      <span>
        <span style={{ fontFamily: 'monospace' }}>{v.code}</span>
        {' · '}
        {v.name}
        {v.is_experimental && (
          <span style={{ color: '#854F0B', marginLeft: 4 }}>(exp)</span>
        )}
      </span>
    ),
    code: v.code ?? '',
    name: v.name,
    is_experimental: v.is_experimental,
  }));
}

// ─── Component ────────────────────────────────────────────────────────────

/**
 * Self-fetching Select for TomatoVariety reference data.
 * Supports single-select (default) and mode="multiple".
 * Single: emits number | null. Multiple: emits number[].
 * Renders label as "08 · Redity" with amber "(exp)" suffix for experimental.
 */
export function VarietySelect(props: IVarietySelectProps) {
  const { disabled, allowClear = true, placeholder, size, style, excludeIds = [] } = props;
  const { t } = useTranslation();
  const { data: varieties = [] } = useTomatoVarieties();
  const options = buildOptions(varieties, excludeIds);

  const filterOption = (input: string, option: { code: string; name: string } | undefined) => {
    if (!option) return false;
    const q = input.toLowerCase();
    return option.code.toLowerCase().includes(q) || option.name.toLowerCase().includes(q);
  };

  if (props.mode === 'multiple') {
    return (
      <Select
        mode="multiple"
        value={props.value ?? []}
        onChange={(v) => props.onChange?.(v)}
        showSearch
        allowClear={allowClear}
        disabled={disabled}
        placeholder={placeholder ?? t('official_code.field_variety')}
        size={size}
        style={style}
        filterOption={filterOption}
        optionLabelProp="label"
        options={options}
      />
    );
  }

  return (
    <Select
      value={props.value ?? undefined}
      onChange={(v: number | undefined) => props.onChange?.(v ?? null)}
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder ?? t('official_code.field_variety')}
      size={size}
      style={style}
      filterOption={filterOption}
      optionLabelProp="label"
      options={options}
    />
  );
}
