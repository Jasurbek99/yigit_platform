import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HarvestCell } from './HarvestCell';
import type { IHarvestDayEntry } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'value' in opts ? `${key}:${String(opts.value)}` : key,
  }),
}));

function entryOn(entry_date: string, overrides: Partial<IHarvestDayEntry> = {}): IHarvestDayEntry {
  return {
    id: 42,
    block: 7,
    season: 1,
    weekly_plan: 3,
    entry_date,
    weekday: 0,
    plan_value: '12000.00',
    plan_submitted_at: '2020-01-05T08:00:00Z',
    plan_submitted_by: null,
    plan_state: 'on_time',
    forecast_value: null,
    forecast_submitted_at: null,
    forecast_submitted_by: null,
    forecast_revision_count: 0,
    actual_value: '14250.00',
    actual_finalized_at: '2020-01-07T02:00:00Z',
    actual_source: 'shipment_rollup',
    last_override_at: null,
    last_override_by: null,
    last_override_reason: '',
    ...overrides,
  } as IHarvestDayEntry;
}

/** Boss: one value, and no path to the actual. */
const bossProps = {
  canEditPlan: true,
  canEditActual: false, // WeeklyPlanGrid returns false for boss when planOnly
  onSave: vi.fn(),
  onCellClick: vi.fn(),
  isAdmin: true, // still admin-like: plan overwrites must ask for a reason
  planOnly: true,
  savingKey: null,
};

describe('HarvestCell — planOnly (boss layout)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    ['a past day', '2020-01-06'],
    ['today', new Date().toISOString().slice(0, 10)],
    ['a future day', '2999-01-06'],
  ])('shows only the plan value on %s — the actual is absent', (_label, date) => {
    render(<HarvestCell {...bossProps} entry={entryOn(date)} />);
    expect(screen.getByText('12,000')).toBeInTheDocument();
    // The actual (14,250) and its hint line must not render anywhere.
    expect(screen.queryByText('14,250')).not.toBeInTheDocument();
    expect(screen.queryByText(/cell_actual_hint/)).not.toBeInTheDocument();
    expect(screen.queryByTitle('plan.admin_click_edit_actual')).not.toBeInTheDocument();
  });

  it('clicking a past cell opens the PLAN editor, never the actual', () => {
    const { container } = render(
      <HarvestCell {...bossProps} entry={entryOn('2020-01-06')} />,
    );
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    expect(container.querySelector('input')).toHaveValue('12000');
  });

  it('overwriting a filled plan still asks for a reason (backend requires it)', () => {
    const onSave = vi.fn();
    const { container } = render(
      <HarvestCell {...bossProps} onSave={onSave} entry={entryOn('2020-01-06')} />,
    );
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '9000' } });
    fireEvent.blur(input);
    // Intercepted by AdminOverrideReasonModal — nothing saved yet.
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('plan.override_modal_title')).toBeInTheDocument();
  });

  it('without planOnly an admin past cell still shows the actual (unchanged)', () => {
    render(
      <HarvestCell
        {...bossProps}
        planOnly={false}
        canEditActual
        entry={entryOn('2020-01-06')}
      />,
    );
    expect(screen.getByText('14,250')).toBeInTheDocument();
  });
});
