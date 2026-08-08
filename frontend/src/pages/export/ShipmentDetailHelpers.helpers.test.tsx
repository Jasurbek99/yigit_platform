import { describe, it, expect, beforeAll, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { DetailFieldRow } from '@/components/shipment/DetailFieldRow';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import { jumpToField } from './ShipmentDetailHelpers.helpers';
import type { IEditFieldConfig } from '@/constants/shipmentEditConfig';

vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
}));

const TEXT_CONFIG: IEditFieldConfig = {
  key: 'truck_plate',
  labelKey: 'shipment_edit_drawer.field.truck_plate',
  inputType: 'text',
};

function renderRow(readOnly: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DetailFieldRow shipment={MOCK_SHIPMENT_DETAIL} config={TEXT_CONFIG} readOnly={readOnly} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('jumpToField', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  // The completeness bar's chips call jumpToField. It only actually opens the
  // field if the selector still matches the read-state value cell that
  // DetailFieldRow marks with tabIndex=0 — a contract that silently breaks if
  // that cell ever stops being focusable.
  it('focuses the value cell and opens the editor for an editable row', async () => {
    renderRow(false);
    expect(screen.queryByRole('textbox')).toBeNull();

    act(() => jumpToField('truck_plate'));

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });

  it('leaves a read-only row closed (its value cell is not focusable)', () => {
    renderRow(true);

    act(() => jumpToField('truck_plate'));

    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('does nothing when no row carries the key', () => {
    renderRow(false);

    expect(() => jumpToField('no_such_field')).not.toThrow();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
