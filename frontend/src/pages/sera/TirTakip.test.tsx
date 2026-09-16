import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import TirTakip from './TirTakip';

/**
 * `canSeePage` is deliberately NOT mocked. The per-tab gate is the whole point
 * of this page — mocking the predicate out would leave these tests asserting
 * that an array of nine literals has nine entries.
 *
 * `OnumcilikTab` IS mocked. It is a copy of the Weekly Plan grid and drags in
 * TanStack Query, react-router and a dozen API hooks; mounting it here would
 * make every shell assertion below depend on that provider stack. These tests
 * are about the tab shell — which body a key maps to, not what the body does.
 * The grid's own behaviour is covered by `WeeklyPlanGrid.roles.test.ts` and the
 * `HarvestCell` suites.
 */
vi.mock('./OnumcilikTab', () => ({
  default: () => <div data-testid="onumcilik-body" />,
}));

// Same reasoning for `TirlarTab`: it wraps the Shipment Sheet's grid, comments
// drawer and live-sync hooks. Its own behaviour is in `TirlarTab.test.tsx`.
vi.mock('./TirlarTab', () => ({
  default: () => <div data-testid="tirlar-body" />,
}));

const ALL_TAB_CODES = [
  'tir_takip.onumcilik', 'tir_takip.gaplama', 'tir_takip.tirlar',
  'tir_takip.export_rapor', 'tir_takip.hasabat', 'tir_takip.gumruk_ewrak',
  'tir_takip.kwota_takibi', 'tir_takip.sertnamalar', 'tir_takip.datalar',
];

let pagePermissions: Record<string, boolean> = {};

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      role: 'transport',
      is_superuser: false,
      page_permissions: pagePermissions,
    },
  }),
}));

/** Grants every listed code, and nothing else. */
function grant(codes: string[]) {
  pagePermissions = Object.fromEntries(codes.map((code) => [code, true]));
}

const tabs = () => screen.queryAllByRole('tab');

describe('TirTakip', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders all nine tabs, in source order, when every tab is granted', () => {
    grant(ALL_TAB_CODES);
    render(<TirTakip />);

    expect(tabs().map((el) => el.textContent)).toEqual([
      'Production', 'Packing', 'Trucks', '📦 Export Report', '📊 Reports',
      'Customs Documents', 'Quota Tracking', 'Foreign Contracts', 'Data',
    ]);
  });

  it('selects the first visible tab by default', () => {
    grant(ALL_TAB_CODES);
    render(<TirTakip />);

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Production');
  });

  it('moves the selection when another tab is clicked', async () => {
    grant(ALL_TAB_CODES);
    render(<TirTakip />);

    await userEvent.click(screen.getByRole('tab', { name: 'Quota Tracking' }));

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Quota Tracking');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'sera-panel-kwota_takibi');
  });

  it('renders the Önümçilik body, not the placeholder, on the first tab', () => {
    grant([...ALL_TAB_CODES, 'export.plan']);
    render(<TirTakip />);

    expect(screen.getByTestId('onumcilik-body')).toBeInTheDocument();
    expect(screen.queryByText('This section has no content yet.')).toBeNull();
  });

  it('withholds the Önümçilik body from a role that cannot see /export/plan', () => {
    // `tir_takip.onumcilik` is granted to all 15 roles; `export.plan` to 8.
    // The tab must stay visible (the owner asked for the page to be open to
    // everyone) while the grid's data does not leak to the other seven.
    grant(ALL_TAB_CODES);
    render(<TirTakip />);

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Production');
    expect(screen.queryByTestId('onumcilik-body')).toBeNull();
    expect(
      screen.getByText(
        'You do not have access to this data. An administrator can grant it in the permission matrix.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the Tırlar body when the Sheet itself is granted', async () => {
    grant([...ALL_TAB_CODES, 'export.shipments_sheet']);
    render(<TirTakip />);

    await userEvent.click(screen.getByRole('tab', { name: 'Trucks' }));

    expect(screen.getByTestId('tirlar-body')).toBeInTheDocument();
    expect(screen.queryByText('This section has no content yet.')).toBeNull();
  });

  it('withholds the Tırlar body from a role that cannot see the Sheet', async () => {
    // `tir_takip.tirlar` is open to all 15 roles; the Sheet is not. The tab
    // stays in the strip, the trucks' customers and firm splits do not load.
    grant(ALL_TAB_CODES);
    render(<TirTakip />);

    await userEvent.click(screen.getByRole('tab', { name: 'Trucks' }));

    expect(screen.queryByTestId('tirlar-body')).toBeNull();
    expect(
      screen.getByText(
        'You do not have access to this data. An administrator can grant it in the permission matrix.',
      ),
    ).toBeInTheDocument();
  });

  it('still shows the placeholder on a tab that has no body yet', async () => {
    grant(ALL_TAB_CODES);
    render(<TirTakip />);

    await userEvent.click(screen.getByRole('tab', { name: 'Packing' }));

    expect(screen.queryByTestId('onumcilik-body')).toBeNull();
    expect(screen.getByText('This section has no content yet.')).toBeInTheDocument();
  });

  it('hides a tab whose page code is revoked', () => {
    grant(ALL_TAB_CODES.filter((code) => code !== 'tir_takip.gaplama'));
    render(<TirTakip />);

    const labels = tabs().map((el) => el.textContent);
    expect(labels).toHaveLength(8);
    expect(labels).not.toContain('Packing');
  });

  it('defaults to the first tab that survives the permission filter', () => {
    grant(['tir_takip.hasabat', 'tir_takip.datalar']);
    render(<TirTakip />);

    expect(tabs()).toHaveLength(2);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('📊 Reports');
  });

  it('shows an empty state instead of a tab strip when every tab is revoked', () => {
    // Reachable in production: `canSeePage` grants the `tir_takip` container
    // whenever any child is visible, but an admin can also grant the container
    // row directly and revoke all nine tabs. The route then opens on nothing.
    grant(['tir_takip']);
    render(<TirTakip />);

    expect(tabs()).toHaveLength(0);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(
      screen.getByText('You do not have access to any section of this page.'),
    ).toBeInTheDocument();
  });

  it('keeps the selection when an unrelated tab is revoked between renders', async () => {
    grant(ALL_TAB_CODES);
    render(<TirTakip />);
    await userEvent.click(screen.getByRole('tab', { name: 'Data' }));
    cleanup();

    grant(ALL_TAB_CODES.filter((code) => code !== 'tir_takip.gaplama'));
    render(<TirTakip />);

    // A fresh mount starts at the first visible tab — the point of the
    // assertion is that losing a tab never leaves the shell with nothing
    // selected, which is what a `useState(visibleTabs[0].key)` initialiser
    // would do once `user` resolved after first paint.
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Production');
  });
});
