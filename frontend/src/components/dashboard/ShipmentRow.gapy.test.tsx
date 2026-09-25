import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShipmentRow } from './ShipmentRow';
import type { IShipmentListItem } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

/**
 * A completed Gapy-Satyş truck sits at step 12 (`tamamlandy`) and has no
 * `arrived_at` — R35 is gapy_hidden, so nobody can fill it (ADR-025). The
 * export chain's "report missing" test (step >= 9 && !arrived_at) therefore
 * flagged every finished gate sale with a permanent red ✕ that the operator
 * had no cell to clear.
 */
function makeShipment(over: Partial<IShipmentListItem> = {}): IShipmentListItem {
  return {
    id: 1,
    shipment_code: 'GAPY-1/26',
    date: '2026-01-01',
    status: 13,
    status_display: 'Tamamlandy',
    status_step: 12,
    country_name: null,
    customer_name: 'ÝGT Gapy Satyş',
    weight_net: 18000,
    weight_gross: null,
    departed_at: '2026-01-01T08:00:00Z',
    arrived_at: null,
    is_gapy_satys: true,
    updated_at: '2026-01-01T08:00:00Z',
    ...over,
  } as IShipmentListItem;
}

describe('ShipmentRow — report indicator', () => {
  it('shows no "report missing" cross on a completed gapy truck', () => {
    render(<ShipmentRow shipment={makeShipment()} index={0} onSelect={() => {}} />);
    expect(screen.queryByText('✕')).toBeNull();
  });

  it('marks a completed gapy truck as done', () => {
    render(<ShipmentRow shipment={makeShipment()} index={0} onSelect={() => {}} />);
    expect(screen.getByText('✓')).toBeTruthy();
  });

  it('still flags a normal export truck that arrived with no report', () => {
    render(
      <ShipmentRow
        shipment={makeShipment({
          is_gapy_satys: false,
          status_step: 9,
          arrived_at: null,
          country_name: 'Kazakhstan',
        })}
        index={0}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('✕')).toBeTruthy();
  });
});
