import { useEffect } from 'react';
import { Select } from 'antd';
import { useProductTypes } from '@/hooks/useAdmin';

interface IProductTypeSelectProps {
  value?: number | null;
  onChange?: (value: number) => void;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

/**
 * Product picker for a new shipment (tomato / pepper). Starts on tomato: as
 * soon as the product list loads and nothing is chosen, it reports tomato up.
 * Products without a code (neither tomato nor pepper) are not offered.
 */
export function ProductTypeSelect({ value, onChange, disabled, size, style }: IProductTypeSelectProps) {
  const { data: productTypes = [] } = useProductTypes();
  const offered = productTypes.filter((p) => p.code);
  const tomatoId = offered.find((p) => p.code === 'tomato')?.id;

  useEffect(() => {
    if (value == null && tomatoId != null) onChange?.(tomatoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tomatoId]);

  return (
    <Select
      value={value ?? undefined}
      onChange={(v) => onChange?.(v)}
      options={offered.map((p) => ({ value: p.id, label: p.name }))}
      disabled={disabled}
      size={size}
      style={style}
    />
  );
}
