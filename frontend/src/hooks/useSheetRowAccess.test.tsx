import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import api from '@/services/api';
import { useSaveRoleAccess } from './useSheetRowSettings';

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useSaveRoleAccess', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('posts the role and its field keys to role-access/', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { role: 'document_team', added: 2, removed: 0 },
    });

    const { result } = renderHook(() => useSaveRoleAccess(), { wrapper });
    result.current.mutate({ role: 'document_team', field_keys: ['country', 'import_firm'] });

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/export/admin/sheet-rows/role-access/',
      { role: 'document_team', field_keys: ['country', 'import_firm'] },
    ));
  });
});
