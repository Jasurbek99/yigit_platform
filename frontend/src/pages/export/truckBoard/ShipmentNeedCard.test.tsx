import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { ShipmentNeedCard } from './ShipmentNeedCard';
import type { ICandidateShipment } from '@/types/externalTrip';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const shipment = {
  id: 1, shipment_code: '0110001/26', date: '2026-10-01', country_code: 'KZ', country_name: 'GAZAGYSTAN',
  customer: 1, customer_name: 'Berik', blocks: ['A1', 'B2'], export_code: '2909001/26',
  documents_status: 'in_progress', import_firm: 3, import_firm_name: 'Berik LLP',
  loading_location: 2, loading_location_name: 'Ahal', city: 5, city_name: 'Almaty',
  export_firms: [{ id: 7, name: 'YGT' }, { id: 8, name: 'Gadam' }],
} as ICandidateShipment;

describe('ShipmentNeedCard', () => {
  it('shows export code, documents, firms, importer and the route', () => {
    render(<ShipmentNeedCard shipment={shipment} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByText(/2909001\/26/)).toBeInTheDocument();
    expect(screen.getByText(/Documents: in progress/)).toBeInTheDocument();
    expect(screen.getByText(/YGT, Gadam → Berik LLP/)).toBeInTheDocument();
    expect(screen.getByText(/Ahal → Almaty/)).toBeInTheDocument();
  });

  it('marks a missing export code', () => {
    render(<ShipmentNeedCard shipment={{ ...shipment, export_code: null }} selected={false} onSelect={vi.fn()} />);
    expect(screen.getByText(/No export code/)).toBeInTheDocument();
  });
});
