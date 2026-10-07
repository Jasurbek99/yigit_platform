import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ProductTypeSelect } from './ProductTypeSelect';

vi.mock('@/hooks/useAdmin', () => ({
  useProductTypes: () => ({
    data: [
      { id: 1, name: 'Pomidor', code: 'tomato' },
      { id: 2, name: 'Bolgar burç', code: 'pepper' },
      { id: 3, name: 'Other', code: null },
    ],
  }),
}));

describe('ProductTypeSelect', () => {
  it('picks tomato when nothing is chosen yet', () => {
    const onChange = vi.fn();
    render(<ProductTypeSelect onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('leaves an existing choice alone', () => {
    const onChange = vi.fn();
    render(<ProductTypeSelect value={2} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});
