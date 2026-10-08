import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import type { ICandidateShipment, IExternalTrip } from '@/types/externalTrip';
import { TruckMatchPanel } from './TruckMatchPanel';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const shipment = { id: 1, shipment_code: 'KZ-1', country_code: 'KZ' } as unknown as ICandidateShipment;
const trip = {
  id: 2, tractor_plate: 'A', trailer_plate: 'B', destination_country_code: 'KZ',
  rejected_at: '2026-10-07T10:00:00Z', rejection_reason: 'No visa',
} as unknown as IExternalTrip;

describe('TruckMatchPanel', () => {
  it('does not offer Assign for a rejected trip', () => {
    render(<TruckMatchPanel shipment={shipment} trip={trip} canAssign isReadOnly={false} isLoading={false}
      onAssign={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
    expect(screen.getByText('Waiting for Planning to change the truck or driver')).toBeInTheDocument();
  });
});
