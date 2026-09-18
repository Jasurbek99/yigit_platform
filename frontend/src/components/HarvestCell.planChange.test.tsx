import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import { HarvestCell } from './HarvestCell';
import { planChangeRange } from './HarvestCell.helpers';
import type { IHarvestDayEntry } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const TODAY = dayjs().format('YYYY-MM-DD');

function entry(overrides: Partial<IHarvestDayEntry> = {}): IHarvestDayEntry {
  return {
    id: 42, block: 7, season: 1, weekly_plan: 3, entry_date: TODAY, weekday: 0,
    plan_value: '10000.00', plan_submitted_at: '2020-01-05T08:00:00Z', plan_submitted_by: null,
    plan_state: 'on_time', plan_baseline_value: null, pending_change: null,
    forecast_value: null, forecast_submitted_at: null, forecast_submitted_by: null, forecast_revision_count: 0,
    actual_value: null, actual_finalized_at: null, actual_source: '',
    last_override_at: null, last_override_by: null, last_override_reason: '',
    ...overrides,
  } as IHarvestDayEntry;
}

const managerProps = {
  canEditPlan: true, canEditActual: false, onSave: vi.fn(), onCellClick: vi.fn(),
  isAdmin: false, planOnly: true, savingKey: null, maxChangePct: 15, onRangeError: vi.fn(),
};

describe('planChangeRange', () => {
  const today = dayjs('2026-06-10'); // Wed of ISO 2026-W24

  it('is null before the plan week starts', () => {
    expect(planChangeRange(entry({ entry_date: '2026-06-17' }), 15, today)).toBeNull();
  });
  it('bounds a started week by the baseline, falling back to the plan value', () => {
    expect(planChangeRange(entry({ entry_date: '2026-06-11' }), 15, today)).toEqual({ min: 8500, max: 11500 });
    expect(
      planChangeRange(entry({ entry_date: '2026-06-11', plan_value: '11500.00', plan_baseline_value: '10000.00' }), 15, today),
    ).toEqual({ min: 8500, max: 11500 });
  });
  it('is null for an empty or zero baseline', () => {
    expect(planChangeRange(entry({ entry_date: '2026-06-11', plan_value: null }), 15, today)).toBeNull();
    expect(planChangeRange(entry({ entry_date: '2026-06-11', plan_value: '0.00' }), 15, today)).toBeNull();
  });
});

describe('HarvestCell — in-week plan change', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the pending change with its percentage', () => {
    const pending = { id: 1, requested_value: '11500.00', change_pct: '15.00', requested_by_name: 'Myrat', requested_at: '' };
    render(<HarvestCell {...managerProps} entry={entry({ pending_change: pending })} />);
    expect(screen.getByTestId('pending-change')).toHaveTextContent('→ 11,500 (+15%)');
  });

  it('shows no badge when nothing is pending', () => {
    render(<HarvestCell {...managerProps} entry={entry()} />);
    expect(screen.queryByTestId('pending-change')).not.toBeInTheDocument();
  });

  it('refuses an out-of-range value without saving', () => {
    const { container } = render(<HarvestCell {...managerProps} entry={entry()} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '12000' } });
    fireEvent.blur(input);
    expect(managerProps.onRangeError).toHaveBeenCalledWith(8500, 11500);
    expect(managerProps.onSave).not.toHaveBeenCalled();
  });

  it('saves an in-range value', () => {
    const { container } = render(<HarvestCell {...managerProps} entry={entry()} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '11000' } });
    fireEvent.blur(input);
    expect(managerProps.onSave).toHaveBeenCalledWith(42, 'plan_value', 11000);
  });

  it('typing the approved value back over a pending change saves it (withdraws the request)', () => {
    const pending = { id: 1, requested_value: '11500.00', change_pct: '15.00', requested_by_name: 'Myrat', requested_at: '' };
    const { container } = render(<HarvestCell {...managerProps} entry={entry({ pending_change: pending })} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = screen.getByRole('spinbutton');
    // Retyping over the selected text passes through other values; React drops
    // a change event whose value equals the current one.
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '10000' } });
    fireEvent.blur(input);
    expect(managerProps.onSave).toHaveBeenCalledWith(42, 'plan_value', 10000);
  });

  it('entering a pending cell and leaving without typing does not withdraw it', () => {
    // Click-in/click-out and Tab/arrow traversal (tableNavigation) both do this.
    const pending = { id: 1, requested_value: '11500.00', change_pct: '15.00', requested_by_name: 'Myrat', requested_at: '' };
    const { container } = render(<HarvestCell {...managerProps} entry={entry({ pending_change: pending })} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    fireEvent.blur(screen.getByRole('spinbutton'));
    expect(managerProps.onSave).not.toHaveBeenCalled();
  });

  it('the approved value with nothing pending is not re-saved', () => {
    const { container } = render(<HarvestCell {...managerProps} entry={entry()} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '10000' } });
    fireEvent.blur(input);
    expect(managerProps.onSave).not.toHaveBeenCalled();
  });

  it('does not range-check admin-like users', () => {
    const { container } = render(<HarvestCell {...managerProps} isAdmin entry={entry({ plan_value: null })} />);
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '99000' } });
    fireEvent.blur(input);
    expect(managerProps.onRangeError).not.toHaveBeenCalled();
    expect(managerProps.onSave).toHaveBeenCalledWith(42, 'plan_value', 99000);
  });
});
