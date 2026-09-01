import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ShipmentDetailHero } from './ShipmentDetailHero';
import { useAuth } from '@/hooks/useAuth';
import { useSeasons } from '@/hooks/useAdmin';
import { useUiStore } from '@/stores/uiStore';
import type { ICurrentUser, ISeason, IShipmentDetail, UserRole } from '@/types';

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
// ShipmentDetailHero now calls useSeasonReadOnly(), which calls useSeasons()
// unconditionally (Rules of Hooks) — mocked here so this suite, which is
// about the transition-button role gate and never about season status,
// doesn't need a real QueryClient-backed network call.
vi.mock('@/hooks/useAdmin', () => ({ useSeasons: vi.fn() }));

// TransitionButton owns its own mutation + API client. Replaced with a marker so
// this test asserts only whether the hero RENDERS it, which is the gate under test.
vi.mock('@/components/TransitionButton', () => ({
  TransitionButton: () => <div>TRANSITION_BUTTON</div>,
}));

// JoinSupplyModal (rendered unconditionally by the hero, gated open by
// `open`) also pulls useDrafts/useJoinShipments from this module — mocked
// here too so mounting the hero doesn't hit the network.
vi.mock('@/hooks/useDrafts', () => ({
  usePromoteFromDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDrafts: () => ({ data: [], isLoading: false }),
  useJoinShipments: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useShipments', () => ({
  useCancelShipment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useHardDeleteDraftShipment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const shipment = {
  id: 1,
  shipment_code: 'SH-0001',
  export_code: '10AP116/26',
  status_code: 'yuklenme',
  status_display: 'Loading',
  phase: 'LOAD',
  in_phase_seconds: 10,
  phase_avg_seconds: null,
  freshness: 'today',
  harvest_age_days: 1,
  comment_count: 0,
  can_promote_from_draft: false,
  allowed_transitions: ['yola_chykdy'],
} as unknown as IShipmentDetail;

function fakeUser(overrides: Partial<ICurrentUser> = {}): ICurrentUser {
  return {
    id: 1,
    username: 'kaka',
    email: '',
    first_name: '',
    last_name: '',
    role: 'boss' as UserRole,
    is_superuser: false,
    managed_block_ids: [],
    permissions: [],
    page_permissions: {},
    resource_permissions: { shipment: { view: true, create: true, edit: true, delete: true } },
    field_permissions: { shipment: ['*'] },
    ...overrides,
  } as ICurrentUser;
}

function renderHero(shipmentOverride: IShipmentDetail = shipment) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ShipmentDetailHero shipment={shipmentOverride} onOpenComments={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// Destination draft: has country/customer, no block_sources yet — the shape
// isDestinationDraft() (joinHelpers) looks for.
const destinationDraftShipment = {
  ...shipment,
  status_code: 'draft',
  status_display: 'Draft',
  country: 1,
  customer: 1,
  block_sources: [],
  allowed_transitions: [],
} as unknown as IShipmentDetail;

describe('ShipmentDetailHero — transition button gate', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    vi.mocked(useSeasons).mockReturnValue({ data: [] as ISeason[] } as ReturnType<typeof useSeasons>);
    useUiStore.setState({ bossEditMode: false });
  });

  it('hides the transition button for a boss in view mode', () => {
    // Moving a truck through the state machine is the sharpest capability this
    // feature granted. Without the canDo gate the boss could drive the whole
    // lifecycle while the header still reads "Просмотр".
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(), isLoading: false, isError: false });
    renderHero();
    expect(screen.queryByText('TRANSITION_BUTTON')).not.toBeInTheDocument();
  });

  it('shows the transition button once the boss switches to edit mode', () => {
    vi.mocked(useAuth).mockReturnValue({ user: fakeUser(), isLoading: false, isError: false });
    useUiStore.setState({ bossEditMode: true });
    renderHero();
    expect(screen.getByText('TRANSITION_BUTTON')).toBeInTheDocument();
  });

  it('is unaffected for a role with shipment edit rights', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({ role: 'export_manager' as UserRole }),
      isLoading: false,
      isError: false,
    });
    renderHero();
    expect(screen.getByText('TRANSITION_BUTTON')).toBeInTheDocument();
  });

  it('hides the transition button for a role with no shipment edit right', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({
        role: 'accountant' as UserRole,
        resource_permissions: {
          shipment: { view: true, create: false, edit: false, delete: false },
        },
      }),
      isLoading: false,
      isError: false,
    });
    renderHero();
    expect(screen.queryByText('TRANSITION_BUTTON')).not.toBeInTheDocument();
  });
});

describe('ShipmentDetailHero — join supply gate', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.mocked(useAuth).mockReset();
    vi.mocked(useSeasons).mockReturnValue({ data: [] as ISeason[] } as ReturnType<typeof useSeasons>);
    useUiStore.setState({ bossEditMode: false });
  });

  it('shows the Join supply button for a destination draft + export_manager', () => {
    // active_season must resolve so useSeasonReadOnly() sees seasonId ===
    // activeSeasonId (both null otherwise falls through to the "no season
    // selected" read-only branch) — this test is about the join gate, not
    // season read-only, so pin an active season to isolate it.
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({
        role: 'export_manager' as UserRole,
        active_season: { id: 1, name: 'Season 1', status: 'ACTIVE' },
      }),
      isLoading: false,
      isError: false,
    });
    renderHero(destinationDraftShipment);
    expect(screen.getByText('Join supply')).toBeInTheDocument();
  });

  it('hides the Join supply button once the shipment has block_sources', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({
        role: 'export_manager' as UserRole,
        active_season: { id: 1, name: 'Season 1', status: 'ACTIVE' },
      }),
      isLoading: false,
      isError: false,
    });
    renderHero({
      ...destinationDraftShipment,
      block_sources: [{ block_id: 1, block_code: 'B1', weight_kg: 100 }],
    } as unknown as IShipmentDetail);
    expect(screen.queryByText('Join supply')).not.toBeInTheDocument();
  });

  it('hides the Join supply button for a non-privileged role', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({
        role: 'accountant' as UserRole,
        active_season: { id: 1, name: 'Season 1', status: 'ACTIVE' },
      }),
      isLoading: false,
      isError: false,
    });
    renderHero(destinationDraftShipment);
    expect(screen.queryByText('Join supply')).not.toBeInTheDocument();
  });

  it('shows the Join supply button for a boss on a destination draft', () => {
    // canJoinSupply mirrors the backend's PRIVILEGED_ROLES (includes boss) and
    // deliberately does NOT route through canDo/bossEditMode the way canTransition
    // does — so the button must appear even though beforeEach leaves bossEditMode
    // false. Flipping bossEditMode on here would defeat the point of this test.
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({
        role: 'boss' as UserRole,
        active_season: { id: 1, name: 'Season 1', status: 'ACTIVE' },
      }),
      isLoading: false,
      isError: false,
    });
    renderHero(destinationDraftShipment);
    expect(screen.getByText('Join supply')).toBeInTheDocument();
  });

  // ── Promote to customs (the /assign/ endpoint) ─────────────────────────
  // The button used to be gated on a hardcoded ['export_manager','director',
  // 'admin'] literal that omitted `boss`, even though the backend widened
  // /assign/ to him on 2026-08-05 (FINDINGS_BACKLOG F20). Same shape as
  // canJoinSupply above: mirrors the backend list, not canDo/bossEditMode.
  const promotableDraft = {
    ...destinationDraftShipment,
    can_promote_from_draft: true,
  } as unknown as IShipmentDetail;

  it('shows the promote button for a boss on a promotable draft', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({
        role: 'boss' as UserRole,
        active_season: { id: 1, name: 'Season 1', status: 'ACTIVE' },
      }),
      isLoading: false,
      isError: false,
    });
    renderHero(promotableDraft);
    expect(screen.getByText(/Promote to/)).toBeInTheDocument();
  });

  it('still hides the promote button for a role the API refuses', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({
        role: 'document_team' as UserRole,
        active_season: { id: 1, name: 'Season 1', status: 'ACTIVE' },
      }),
      isLoading: false,
      isError: false,
    });
    renderHero(promotableDraft);
    expect(screen.queryByText(/Promote to/)).not.toBeInTheDocument();
  });

  it('names the status the button actually moves the shipment to', () => {
    // The button, its confirm dialog and its success toast all said "Loading"
    // in all three languages, while /assign/ calls
    // transition_to(..., 'gumruk_girish') -- TM Customs Entry. Pressing it did
    // something other than what it said. All four strings are asserted, not
    // just the button: fixing the label alone would have left the dialog
    // contradicting it, which reads as a bug rather than a wording slip.
    for (const key of [
      'shipment.detail.promote_button',
      'shipment.detail.promote_confirm_title',
      'shipment.detail.promote_confirm_body',
      'shipment.detail.promote_toast_success',
    ]) {
      expect(i18n.t(key)).not.toMatch(/Loading/);
      expect(i18n.t(key)).toMatch(/Customs/);
    }
  });

  it('names the team the promotion actually notifies', () => {
    // STATUS_NOTIFY_ROLES['gumruk_girish'] is ['document_team']; the body
    // promised the warehouse would be told.
    expect(i18n.t('shipment.detail.promote_confirm_body')).not.toMatch(/warehouse/i);
    expect(i18n.t('shipment.detail.promote_confirm_body')).toMatch(/document team/i);
  });

  it('hides the Join supply button for a non-draft shipment', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: fakeUser({
        role: 'export_manager' as UserRole,
        active_season: { id: 1, name: 'Season 1', status: 'ACTIVE' },
      }),
      isLoading: false,
      isError: false,
    });
    renderHero(shipment);
    expect(screen.queryByText('Join supply')).not.toBeInTheDocument();
  });
});
