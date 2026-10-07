import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ShipmentDetailStageCards } from './ShipmentDetailStageCards';
import { ShipmentSaleSection } from './ShipmentSaleSection';
import { EDITABLE_FIELD_KEYS, sectionAnchorFor } from './ShipmentCompletenessBar.helpers';
import { MOCK_SHIPMENT_DETAIL } from '@/mock/shipmentDetail';
import type { IShipmentDetail } from '@/types';

vi.mock('@/services/api', () => ({
  default: { patch: vi.fn(), get: vi.fn(() => Promise.resolve({ data: [] })), post: vi.fn() },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'admin', is_superuser: true } }) }));
vi.mock('@/components/shipment/tripAccess', () => ({ canManageTrips: () => true }));
vi.mock('@/components/shipment/ShipmentTripBanner', () => ({ ShipmentTripBanner: () => null }));
vi.mock('@/components/shipment/ShipmentFirmSelector', () => ({ ShipmentFirmSelector: () => null }));
vi.mock('@/components/shipment/VarietyOverrideRow', () => ({ VarietyOverrideRow: () => null }));
vi.mock('@/components/shipment/ShipmentPackingActions', () => ({ ShipmentPackingActions: () => null }));
vi.mock('@/components/sheet/ShipmentPackingPanel', () => ({ ShipmentPackingPanel: () => null }));
vi.mock('@/components/sheet/ShipmentFirmContractsPanel', () => ({ ShipmentFirmContractsPanel: () => null }));
vi.mock('@/pages/export/ShipmentDetailHelpers', async (orig) => ({
  ...(await orig<typeof import('@/pages/export/ShipmentDetailHelpers')>()),
  SalesReportForm: () => null,
}));

/**
 * Every TaskRule.target_fields key seeded by
 * backend/apps/export/management/commands/seed_task_rules.py (2026-09-30).
 * When a rule gains a target, add it here — the chip for it must lead somewhere.
 */
const TASK_TARGET_KEYS = [
  'country', 'customer', 'import_firm', 'city', 'firm_splits', 'block_sources', 'trip_id',
  'driver_name', 'driver_phone', 'truck_plate', 'border_point', 'documents_status',
  'packing_template', 'has_current_advance', 'customs_exit_at', 'loading_started_at',
  'variety', 'weight_net', 'loading_ended_at',
  'quality.azyk_maglumatnama', 'quality.suriji_gozukdiriji', 'quality.hil_sertifikaty', 'quality.kalibrowka_analiz',
  'transit_days', 'transport_temp_c', 'shelf_life_days', 'departed_at', 'border_crossed_at',
  'sales_report', 'dest_entry_at', 'customs_entry_at', 'has_peregruz', 'peregruz_date',
  'arrived_at', 'sale_started_at', 'sale_ended_at', 'sales_report.approved_at',
];
// shipment_code is excluded: system-filled, shown in the hero, nothing to jump to.

beforeAll(async () => { await i18n.changeLanguage('en'); });

function renderDetail(shipment: IShipmentDetail, missingKeys: Set<string> = new Set()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ShipmentDetailStageCards shipment={shipment} isDesktop={false} missingKeys={missingKeys} readOnly={false}
          onOpenComments={() => {}} commentCountsByField={{}} canOverrideVariety={false} />
        <ShipmentSaleSection shipment={shipment} missingKeys={new Set()} readOnly={false} canEditSalesReport={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Where the completeness chip for `key` leads, or null if nowhere. */
function target(key: string): HTMLElement | null {
  if (EDITABLE_FIELD_KEYS.has(key)) return document.getElementById(`detail-field-${key}`);
  const anchor = sectionAnchorFor(key);
  return anchor ? document.getElementById(anchor) : null;
}

describe('every task target field is reachable on the Detail page', () => {
  it.each([
    ['regular', { is_gapy_satys: false, status_code: 'draft', trip_id: null }, TASK_TARGET_KEYS],
    ['gapy', { is_gapy_satys: true, status_code: 'draft', trip_id: null }, TASK_TARGET_KEYS.filter((k) => k !== 'trip_id')],
  ] as const)('%s shipment', (_name, over, keys) => {
    renderDetail({ ...MOCK_SHIPMENT_DETAIL, ...over } as IShipmentDetail);
    const unreachable = keys.filter((key) => target(key) === null);
    expect(unreachable).toEqual([]);
  });
});

// E2E 2026-10-01: the Quality card said "complete" with no scan uploaded — its
// badge was hard-coded to zero missing.
describe('the Quality card badge', () => {
  function qualityCardText(): string {
    const title = [...document.querySelectorAll('.ant-card-head')]
      .find((head) => head.textContent?.includes('Quality Certificates'));
    return title?.textContent ?? '';
  }

  it('counts the certificates still owed', () => {
    renderDetail(MOCK_SHIPMENT_DETAIL, new Set(['quality.hil_sertifikaty', 'quality.kalibrowka_analiz', 'weight_net']));
    expect(qualityCardText()).toContain('2 missing');
  });

  it('reads complete when none is owed', () => {
    renderDetail(MOCK_SHIPMENT_DETAIL, new Set(['weight_net']));
    expect(qualityCardText()).toContain('complete');
  });
});

describe('the export date row', () => {
  it('sits in the Loading card right after the export code, before the other goods rows', () => {
    renderDetail({ ...MOCK_SHIPMENT_DETAIL, export_date: '2026-09-30' } as IShipmentDetail);
    const row = document.getElementById('detail-field-export_date');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('30.09.2026');
    const loadingStart = document.getElementById('detail-field-loading_started_at')!;
    expect(row!.compareDocumentPosition(loadingStart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the product row', () => {
  it('is on the Detail page and shows the shipment product by name', () => {
    renderDetail({ ...MOCK_SHIPMENT_DETAIL, product_type: 2, product_type_code: 'pepper', product_type_name: 'Bolgar burç' } as IShipmentDetail);
    const row = document.getElementById('detail-field-product_type');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('Bolgar burç');
  });
});
