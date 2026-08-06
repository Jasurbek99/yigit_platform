import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import ProcessNodeLinksPage from './ProcessNodeLinksPage';
import api from '@/services/api';
import type { IProcessNodeLink } from '@/types';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const MOCK_LINKS: IProcessNodeLink[] = [
  { id: 1, node_id: 'plan', label: 'Meýilnama', route: '/export/plan', is_active: true },
  { id: 2, node_id: 'quota', label: 'Kwota', route: '', is_active: false },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProcessNodeLinksPage />
    </QueryClientProvider>,
  );
}

async function openEditModal(nodeId: string) {
  const row = screen.getByText(nodeId).closest('tr');
  if (!row) throw new Error(`row for node_id ${nodeId} not found`);
  const editButton = within(row).getByRole('button');
  await userEvent.click(editButton);
  await screen.findByRole('dialog');
}

describe('ProcessNodeLinksPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the rows returned by the API', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: MOCK_LINKS });
    renderPage();

    expect(await screen.findByText('plan')).toBeInTheDocument();
    expect(screen.getByText('quota')).toBeInTheDocument();
    expect(screen.getByText('Meýilnama')).toBeInTheDocument();
    expect(screen.getByText('/export/plan')).toBeInTheDocument();
  });

  it('editing a route and saving issues a PATCH to the right URL with the right body', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: MOCK_LINKS });
    vi.mocked(api.patch).mockResolvedValueOnce({ data: MOCK_LINKS[0] });
    renderPage();

    await screen.findByText('plan');
    await openEditModal('plan');

    const routeInput = screen.getByRole('combobox');
    await userEvent.clear(routeInput);
    await userEvent.type(routeInput, '/export/quota');

    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith(
        '/export/admin/process-node-links/1/',
        { route: '/export/quota', is_active: true },
      );
    });
  });

  it('does not render node_id as an editable field', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: MOCK_LINKS });
    renderPage();

    await screen.findByText('plan');
    await openEditModal('plan');

    // node_id is shown nowhere inside the modal as an input/combobox — only
    // the route AutoComplete and the is_active Switch are interactive.
    expect(screen.queryByDisplayValue('plan')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('rejects a route that does not start with "/" and does not send a PATCH', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: MOCK_LINKS });
    renderPage();

    await screen.findByText('plan');
    await openEditModal('plan');

    const routeInput = screen.getByRole('combobox');
    await userEvent.clear(routeInput);
    await userEvent.type(routeInput, 'export/plan');

    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => {
      expect(screen.getByText('Route must start with "/"')).toBeInTheDocument();
    });
    expect(api.patch).not.toHaveBeenCalled();
  });
});
