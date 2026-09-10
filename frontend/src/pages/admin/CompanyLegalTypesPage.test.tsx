import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import i18n from '@/i18n';
import { MemoryRouter } from 'react-router-dom';
import CompanyLegalTypesPage from './CompanyLegalTypesPage';
import ExportFirmsPage from './ExportFirmsPage';
import {
  useCompanyLegalTypes,
  useCreateCompanyLegalType,
  useUpdateCompanyLegalType,
  useDeleteCompanyLegalType,
  useCountries,
  useAdminFirms,
} from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import type { ICompanyLegalType } from '@/types';

const navigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/hooks/useAdmin', () => ({
  useCompanyLegalTypes: vi.fn(),
  useCreateCompanyLegalType: vi.fn(),
  useUpdateCompanyLegalType: vi.fn(),
  useDeleteCompanyLegalType: vi.fn(),
  useCountries: vi.fn(),
  useAdminFirms: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function legalType(overrides: Partial<ICompanyLegalType> = {}): ICompanyLegalType {
  return {
    id: 1,
    code: 'HJ',
    abbr_tk: 'HJ',
    abbr_ru: 'ХО',
    abbr_en: 'HJ',
    full_tk: 'Hojalyk jemgyýeti',
    full_ru: 'Хозяйственное общество',
    full_en: 'Economic society',
    gen_tk: 'hojalyk jemgyýetiniň',
    gen_ru: 'Хозяйственного общества',
    position_tk: 'SUFFIX',
    position_ru: 'PREFIX',
    position_en: 'SUFFIX',
    countries: [16],
    country_codes: ['TM'],
    sort_order: 10,
    is_active: true,
    ...overrides,
  };
}

const noopMutation = { mutate: vi.fn(), isPending: false };

// i18n falls back to Turkmen; these assertions read the English strings.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCreateCompanyLegalType).mockReturnValue(noopMutation as never);
  vi.mocked(useUpdateCompanyLegalType).mockReturnValue(noopMutation as never);
  vi.mocked(useDeleteCompanyLegalType).mockReturnValue(noopMutation as never);
  vi.mocked(useCountries).mockReturnValue({ data: [] } as never);
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, role: 'admin', is_superuser: true },
  } as never);
});

function renderWith(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CompanyLegalTypesPage', () => {
  it('lists the legal forms with both abbreviations', async () => {
    vi.mocked(useCompanyLegalTypes).mockReturnValue({
      data: [legalType(), legalType({ id: 2, code: 'TOO', abbr_tk: 'JÇB', abbr_ru: 'ТОО' })],
      isLoading: false,
    } as never);

    renderWith(<CompanyLegalTypesPage />);

    expect(await screen.findByText('HJ')).toBeInTheDocument();
    expect(screen.getByText('TOO')).toBeInTheDocument();
    expect(screen.getByText('HJ / ХО')).toBeInTheDocument();
    expect(screen.getByText('JÇB / ТОО')).toBeInTheDocument();
  });

  it('flags a form whose genitive is still blank, since the contract preamble needs it', async () => {
    vi.mocked(useCompanyLegalTypes).mockReturnValue({
      data: [legalType(), legalType({ id: 2, code: 'TOV', gen_tk: null, gen_ru: null })],
      isLoading: false,
    } as never);

    renderWith(<CompanyLegalTypesPage />);

    expect(await screen.findByText('Filled')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  it('shows the countries a form is valid in, and says so when it is valid everywhere', async () => {
    vi.mocked(useCompanyLegalTypes).mockReturnValue({
      data: [
        legalType({ country_codes: ['RU', 'UZ', 'KG'] }),
        legalType({ id: 2, code: 'LLC', country_codes: [] }),
      ],
      isLoading: false,
    } as never);

    renderWith(<CompanyLegalTypesPage />);

    expect(await screen.findByText('RU, UZ, KG')).toBeInTheDocument();
    expect(screen.getByText('All countries')).toBeInTheDocument();
  });

  it('hides the add and row buttons from a user who cannot edit either firm registry', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, role: 'loading_dept_head', is_superuser: false },
    } as never);
    vi.mocked(useCompanyLegalTypes).mockReturnValue({
      data: [legalType()],
      isLoading: false,
    } as never);

    renderWith(<CompanyLegalTypesPage />);

    await screen.findByText('HJ');
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
  });
});

describe('the gear button on the export firms list', () => {
  it('opens the legal forms page', async () => {
    vi.mocked(useAdminFirms).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as never);

    renderWith(<ExportFirmsPage />);

    const gear = await screen.findByLabelText('Legal forms');
    fireEvent.click(gear);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin/legal-forms'));
  });
});
