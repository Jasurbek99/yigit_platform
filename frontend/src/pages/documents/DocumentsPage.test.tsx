import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import type { IDocumentPacket } from '@/types';
import DocumentsPage from './DocumentsPage';

const { mockUseDocumentPackets } = vi.hoisted(() => ({
  mockUseDocumentPackets: vi.fn(),
}));
vi.mock('@/hooks/useDocumentPackets', () => ({
  useDocumentPackets: mockUseDocumentPackets,
}));
// Only rendered inside an expanded row; stubbed so this file tests the row's
// own code cell rather than the packet panel's hooks.
vi.mock('@/components/DocumentPacketPanel', () => ({
  DocumentPacketPanel: () => <div />,
}));

const packet = (over: Partial<IDocumentPacket>): IDocumentPacket => ({
  id: 1,
  shipment_code: '0101701/25',
  export_code: null,
  date: '2026-09-10',
  status_code: 'yola_chykdy',
  status_display: 'On the road',
  country_name: 'Kazakhstan',
  city_name: 'Almaty',
  buyer_name: 'BUYER',
  packing_complete: true,
  missing_packing: [],
  missing_setup: [],
  is_ready: true,
  firms: [],
  ...over,
});

function renderWith(row: IDocumentPacket): void {
  mockUseDocumentPackets.mockReturnValue({
    data: { results: [row], count: 1 },
    isLoading: false,
    error: null,
  });
  render(
    <MemoryRouter>
      <DocumentsPage />
    </MemoryRouter>,
  );
}

/**
 * The office identifies a shipment by the Export Code an operator types on the
 * Sheet, not by the code the platform generates. The generated code stays the
 * deep-link key, so both must be present and only the label switches.
 */
describe('DocumentsPage — which code the first column prints', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('heads the column Shipment, not Truck', () => {
    renderWith(packet({}));

    // ProTable renders a hidden measure row, so the header text appears more
    // than once — assert on presence and on the old label being gone.
    expect(screen.getAllByRole('columnheader', { name: 'Shipment' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('columnheader', { name: 'Truck' })).toBeNull();
  });

  it('prints the operator-typed export code when it is filled', () => {
    renderWith(packet({ export_code: 'TM-EXP-001' }));

    expect(screen.getByText('TM-EXP-001')).toBeInTheDocument();
    expect(screen.queryByText('0101701/25')).toBeNull();
  });

  it('falls back to the platform code when the export code is empty', () => {
    renderWith(packet({ export_code: null }));

    expect(screen.getByText('0101701/25')).toBeInTheDocument();
  });

  it('treats a whitespace-only export code as empty', () => {
    renderWith(packet({ export_code: '   ' }));

    expect(screen.getByText('0101701/25')).toBeInTheDocument();
  });

  it('keeps the generated code in the Sheet link even when an export code shows', () => {
    renderWith(packet({ export_code: 'TM-EXP-001' }));

    expect(screen.getByRole('link', { name: 'TM-EXP-001' })).toHaveAttribute(
      'href',
      '/export/shipments/sheet?code=0101701%2F25',
    );
  });
});
