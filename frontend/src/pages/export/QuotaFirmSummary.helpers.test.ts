import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import {
  buildFirmQuotaTotals,
  expiryStatus,
  sortFirmQuotaRows,
} from './QuotaFirmSummary.helpers';
import type { IQuotaFirmSummaryRow } from '@/hooks/useQuotaDashboard';

// Pinned so the suite cannot start failing because the calendar moved.
const TODAY = dayjs('2026-08-23');

function row(overrides: Partial<IQuotaFirmSummaryRow> = {}): IQuotaFirmSummaryRow {
  return {
    export_firm: 1,
    export_firm_name: 'Alpha',
    active_issuance_count: 1,
    issued_kg: 10000,
    used_kg: 2000,
    remaining_kg: 8000,
    nearest_expiry: '2026-09-30',
    ...overrides,
  };
}

describe('expiryStatus', () => {
  it('returns null when the firm holds no live quota', () => {
    expect(expiryStatus(null, TODAY)).toBeNull();
  });

  it('flags a past date as expired', () => {
    expect(expiryStatus('2026-08-22', TODAY)).toEqual({ status: 'expired', daysLeft: -1 });
  });

  it('flags the last day at exactly 7 days out as expiring', () => {
    expect(expiryStatus('2026-08-30', TODAY)).toEqual({ status: 'expiring', daysLeft: 7 });
  });

  it('flags today itself as expiring, not expired', () => {
    // `quota_expiry_date` returns the LAST usable day, so expiring-today quota
    // is still spendable — same rule the backend uses (`expiry < today`).
    expect(expiryStatus('2026-08-23', TODAY)).toEqual({ status: 'expiring', daysLeft: 0 });
  });

  it('treats 8 days out as comfortably active', () => {
    expect(expiryStatus('2026-08-31', TODAY)).toEqual({ status: 'active', daysLeft: 8 });
  });
});

describe('buildFirmQuotaTotals', () => {
  it('sums every column over the rows it is given', () => {
    const totals = buildFirmQuotaTotals([
      row({ active_issuance_count: 2, issued_kg: 10000, used_kg: 2000, remaining_kg: 8000 }),
      row({ active_issuance_count: 1, issued_kg: 5000, used_kg: 500, remaining_kg: 4500 }),
    ]);
    expect(totals).toEqual({
      active_issuance_count: 3,
      issued_kg: 15000,
      used_kg: 2500,
      remaining_kg: 12500,
    });
  });

  it('returns zeros for an empty table', () => {
    expect(buildFirmQuotaTotals([])).toEqual({
      active_issuance_count: 0,
      issued_kg: 0,
      used_kg: 0,
      remaining_kg: 0,
    });
  });
});

describe('sortFirmQuotaRows', () => {
  it('orders by remaining kg descending', () => {
    const sorted = sortFirmQuotaRows([
      row({ export_firm: 1, export_firm_name: 'Alpha', remaining_kg: 1000 }),
      row({ export_firm: 2, export_firm_name: 'Beta', remaining_kg: 9000 }),
      row({ export_firm: 3, export_firm_name: 'Gamma', remaining_kg: 0 }),
    ]);
    expect(sorted.map((r) => r.export_firm)).toEqual([2, 1, 3]);
  });

  it('breaks ties on firm name', () => {
    const sorted = sortFirmQuotaRows([
      row({ export_firm: 1, export_firm_name: 'Zeta', remaining_kg: 0 }),
      row({ export_firm: 2, export_firm_name: 'Alpha', remaining_kg: 0 }),
    ]);
    expect(sorted.map((r) => r.export_firm_name)).toEqual(['Alpha', 'Zeta']);
  });

  it('does not mutate its input', () => {
    const input = [
      row({ export_firm: 1, remaining_kg: 1 }),
      row({ export_firm: 2, remaining_kg: 2 }),
    ];
    sortFirmQuotaRows(input);
    expect(input.map((r) => r.export_firm)).toEqual([1, 2]);
  });
});
