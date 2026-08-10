import type { AxiosError } from 'axios';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleApiResponseError } from './api';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function conflict(body: unknown): AxiosError {
  return {
    config: { url: '/export/shipments/' },
    response: { status: 409, data: body },
  } as unknown as AxiosError;
}

describe('handleApiResponseError — 409 branches', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockReset();
  });

  it('toasts on 409 idempotency_in_progress', () => {
    handleApiResponseError(conflict({ error: 'idempotency_in_progress' }));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('still toasts on 409 season_closed', () => {
    handleApiResponseError(conflict({ error: 'season_closed' }));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('stays silent on an unrelated 409', () => {
    handleApiResponseError(conflict({ error: 'something_else' }));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
