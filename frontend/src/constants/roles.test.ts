import { describe, it, expect } from 'vitest';
import { EXTERNAL_ROLES, ROLE_CHOICES, STAFF_ROLE_CHOICES } from './roles';

describe('STAFF_ROLE_CHOICES', () => {
  it('drops the agent-market roles and keeps every staff role', () => {
    const staff = STAFF_ROLE_CHOICES.map((r) => r.value);
    for (const role of EXTERNAL_ROLES) expect(staff).not.toContain(role);
    expect(staff).toHaveLength(ROLE_CHOICES.length - EXTERNAL_ROLES.length);
    expect(staff).toContain('sales_rep');
  });
});
