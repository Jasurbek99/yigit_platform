import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import * as hook from '@/hooks/useShipmentCustomField';
import { ShipmentCustomFieldRows } from './ShipmentCustomFieldRows';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';

vi.mock('@/hooks/useShipmentCustomField');
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const shipment = {
  ...MOCK_SHIPMENT_DETAIL,
  custom_fields: [
    { field_key: 'custom_seal', label_tk: 'Plomba', label_ru: 'Пломба', label_en: 'Seal', value: 'A-17' },
  ],
};

let mutate: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await i18n.changeLanguage('ru');
  mutate = vi.fn();
  vi.mocked(hook.usePatchCustomField).mockReturnValue(
    { mutate, isPending: false } as unknown as ReturnType<typeof hook.usePatchCustomField>,
  );
});

describe('ShipmentCustomFieldRows', () => {
  it('labels the row in the UI language', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly={false} />);
    expect(screen.getByText('Пломба')).toBeInTheDocument();
  });

  it('unchanged blur does not save', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly={false} />);
    fireEvent.blur(screen.getByDisplayValue('A-17'));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('saves a changed value on blur', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly={false} />);
    const input = screen.getByDisplayValue('A-17');
    fireEvent.change(input, { target: { value: 'B-2' } });
    fireEvent.blur(input);
    expect(mutate).toHaveBeenCalledWith({ fieldKey: 'custom_seal', value: 'B-2' }, expect.anything());
  });

  it('read-only shows text, no input', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly />);
    expect(screen.getByText('A-17')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('A-17')).toBeNull();
  });
  it('follows a newer server value and does not write the old one back', () => {
    const { rerender } = render(<ShipmentCustomFieldRows shipment={shipment} readOnly={false} />);
    const newer = { ...shipment, custom_fields: [{ ...shipment.custom_fields[0], value: 'C-3' }] };
    rerender(<ShipmentCustomFieldRows shipment={newer} readOnly={false} />);
    const input = screen.getByDisplayValue('C-3');
    fireEvent.blur(input);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('Enter then blur saves once', () => {
    render(<ShipmentCustomFieldRows shipment={shipment} readOnly={false} />);
    const input = screen.getByDisplayValue('A-17');
    fireEvent.change(input, { target: { value: 'B-2' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    fireEvent.blur(input);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
