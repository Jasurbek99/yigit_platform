import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HarvestCell } from './HarvestCell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'value' in opts ? `${key}:${String(opts.value)}` : key,
  }),
}));

/**
 * `entry: null` — the block/date has no `HarvestDayEntry` yet (the week was
 * never initialised). Create-on-write: the cell renders like any other empty
 * cell, and the first value typed creates the row on the server via `onSave`
 * with a `null` entryId. Covers the four behaviours called out in the task:
 * an editor gets an input, the save carries no id, an admin filling it never
 * sees the override-reason modal (nothing to override), and a non-editor
 * just sees the em-dash — same as today.
 */
const baseProps = {
  entry: null,
  cellKey: '7-2026-01-06',
  canEditActual: false,
  onCellClick: vi.fn(),
  planOnly: true,
  savingKey: null,
};

describe('HarvestCell — missing cell (create-on-write)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the em-dash for a non-editor, with no click handler', () => {
    const onCellClick = vi.fn();
    const { container } = render(
      <HarvestCell
        {...baseProps}
        canEditPlan={false}
        isAdmin={false}
        onSave={vi.fn()}
        onCellClick={onCellClick}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.querySelector('[data-edit-cell]')).toBeNull();
    expect(container.querySelector('input')).toBeNull();

    // Nothing to click into — no id exists for a history lookup.
    fireEvent.click(screen.getByText('—'));
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it('renders an input for an editor', () => {
    const { container } = render(
      <HarvestCell {...baseProps} canEditPlan isAdmin={false} onSave={vi.fn()} />,
    );
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    expect(container.querySelector('input')).toBeInTheDocument();
  });

  it('calls save with no id', () => {
    const onSave = vi.fn();
    const { container } = render(
      <HarvestCell {...baseProps} canEditPlan isAdmin={false} onSave={onSave} />,
    );
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith(null, 'plan_value', 5000);
  });

  it('does not open the reason modal for an admin filling an empty cell', () => {
    const onSave = vi.fn();
    const { container } = render(
      <HarvestCell {...baseProps} canEditPlan isAdmin onSave={onSave} />,
    );
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '3000' } });
    fireEvent.blur(input);

    // Saved straight through — no AdminOverrideReasonModal in the way.
    expect(onSave).toHaveBeenCalledWith(null, 'plan_value', 3000);
    expect(screen.queryByText('plan.override_modal_title')).not.toBeInTheDocument();
  });

  it('blurring without typing anything creates nothing', () => {
    const onSave = vi.fn();
    const { container } = render(
      <HarvestCell {...baseProps} canEditPlan isAdmin={false} onSave={onSave} />,
    );
    fireEvent.click(container.querySelector('[data-edit-cell]')!);
    fireEvent.blur(container.querySelector('input')!, { target: { value: '' } });

    expect(onSave).not.toHaveBeenCalled();
    // Back to the read/click state, not stuck in the input.
    expect(container.querySelector('input')).toBeNull();
  });
});
