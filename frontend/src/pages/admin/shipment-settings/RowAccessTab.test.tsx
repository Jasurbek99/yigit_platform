import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import api from '@/services/api';
import RowAccessTab from './RowAccessTab';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const ROWS = [
  { id: 1, field_key: 'country', row_number: 11, display_order: 11264,
    label_en: 'Destination country', is_visible: true, triggered_roles: ['export_manager'] },
  { id: 2, field_key: 'import_firm', row_number: 14, display_order: 14336,
    label_en: 'Import firm', is_visible: true, triggered_roles: [] },
];

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><RowAccessTab canWrite /></QueryClientProvider>,
  );
}

describe('RowAccessTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: ROWS });
    vi.mocked(api.post).mockResolvedValue({ data: { role: 'document_team', added: 1, removed: 0 } });
  });

  it('lists every Sheet row for the selected role', async () => {
    renderTab();
    expect(await screen.findByText('country')).toBeInTheDocument();
    expect(screen.getByText('import_firm')).toBeInTheDocument();
  });

  it('saves the ticked rows for the selected role', async () => {
    renderTab();
    fireEvent.click(await screen.findByText('document_team'));
    fireEvent.click(await screen.findByLabelText('import_firm'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/export/admin/sheet-rows/role-access/',
      { role: 'document_team', field_keys: ['import_firm'] },
    ));
  });

  // Distinguishes a full-replacement save from a delta save. `export_manager`
  // already has `country` ticked in the fixture; ticking `import_firm` too and
  // saving without touching `country` must still send BOTH — a delta
  // implementation (session-toggles only) would send only ['import_firm'] and
  // silently drop `export_manager`'s pre-existing access to `country`.
  it('sends the full replacement set, including rows already ticked before this session', async () => {
    renderTab();
    fireEvent.click(await screen.findByLabelText('import_firm'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/export/admin/sheet-rows/role-access/',
      { role: 'export_manager', field_keys: ['country', 'import_firm'] },
    ));
  });
});
