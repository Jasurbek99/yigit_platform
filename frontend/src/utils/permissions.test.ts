import { describe, it, expect } from 'vitest';
import { canSeePage } from '@/utils/permissions';
import type { ICurrentUser } from '@/types';

function guard(pages: Record<string, boolean>): ICurrentUser {
  return {
    id: 1, username: 'g', email: '', first_name: '', last_name: '', role: 'garawul',
    is_superuser: false, managed_block_ids: [], permissions: [], page_permissions: pages,
    resource_permissions: {}, field_permissions: {}, active_season: null,
    can_view_closed_seasons: false,
  };
}

describe('gate route', () => {
  it('maps /export/gate to the export.gate page code', () => {
    expect(canSeePage(guard({ 'export.gate': true }), '/export/gate')).toBe(true);
    expect(canSeePage(guard({ 'export.gate': false }), '/export/gate')).toBe(false);
  });
});

describe('pomidor dukany route', () => {
  it('maps /export/pomidor-dukany to the export.pomidor_dukany page code', () => {
    expect(canSeePage(guard({ 'export.pomidor_dukany': true }), '/export/pomidor-dukany')).toBe(true);
    expect(canSeePage(guard({ 'export.pomidor_dukany': false }), '/export/pomidor-dukany')).toBe(false);
  });
});
