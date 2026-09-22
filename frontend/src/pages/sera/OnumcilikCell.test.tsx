import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { OnumcilikCell } from './OnumcilikCell';
import type { IHarvestDayEntry } from '@/types';

/**
 * The sera cell is the one piece of the restyle that carries behaviour, not
 * just appearance: it is always an input (no click-to-edit step), it still
 * has to route an admin's overwrite through the reason modal the backend
 * demands, and — since create-on-write — it has to work with no row at all.
 */

function makeEntry(over: Partial<IHarvestDayEntry> = {}): IHarvestDayEntry {
  return {
    id: 42,
    block: 7,
    entry_date: '2026-09-16',
    plan_value: null,
    plan_submitted_at: null,
    actual_value: null,
    ...over,
  } as IHarvestDayEntry;
}

const onSave = vi.fn();
const onCellClick = vi.fn();

function renderCell(props: Partial<Parameters<typeof OnumcilikCell>[0]> = {}) {
  return render(
    <OnumcilikCell
      entry={makeEntry()}
      block={7}
      entryDate="2026-09-16"
      canEdit
      onSave={onSave}
      onCellClick={onCellClick}
      isAdmin={false}
      savingKey={null}
      {...props}
    />,
  );
}

describe('OnumcilikCell', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    onSave.mockClear();
    onCellClick.mockClear();
  });

  it('shows an input without needing a click — the point of the sera design', () => {
    renderCell({ entry: makeEntry({ plan_value: '18500' }) });

    expect(screen.getByRole('spinbutton')).toHaveValue('18500');
  });

  it('renders plain text, not a disabled box, when the user may not edit', () => {
    // Sera has no read-only state to copy because it has no permissions. An
    // input nobody can use would promise an edit the backend would refuse.
    renderCell({ canEdit: false, entry: makeEntry({ plan_value: '18500' }) });

    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByText('18,500')).toBeInTheDocument();
  });

  it('opens the history modal when a read-only cell is clicked', async () => {
    renderCell({ canEdit: false, entry: makeEntry({ plan_value: '18500' }) });

    await userEvent.click(screen.getByText('18,500'));

    expect(onCellClick).toHaveBeenCalledWith(42);
  });

  it('distinguishes a confirmed zero from an untouched cell', () => {
    renderCell({
      canEdit: false,
      entry: makeEntry({ plan_value: '0', plan_submitted_at: '2026-09-15T10:00:00Z' }),
    });

    expect(screen.getByText('0 ✓')).toBeInTheDocument();
  });

  it('saves on blur, with no modal, when a non-admin fills a cell', async () => {
    renderCell();

    await userEvent.type(screen.getByRole('spinbutton'), '12000');
    await userEvent.tab();

    expect(onSave).toHaveBeenCalledWith({
      entryId: 42,
      block: 7,
      entryDate: '2026-09-16',
      value: 12000,
    });
  });

  it('does not save when the value is left unchanged', async () => {
    renderCell({ entry: makeEntry({ plan_value: '18500' }) });

    await userEvent.click(screen.getByRole('spinbutton'));
    await userEvent.tab();

    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves straight through when an admin fills an EMPTY cell', async () => {
    // Filling a blank is an entry, not an override — no reason is owed.
    renderCell({ isAdmin: true });

    await userEvent.type(screen.getByRole('spinbutton'), '9000');
    await userEvent.tab();

    expect(onSave).toHaveBeenCalledWith({
      entryId: 42,
      block: 7,
      entryDate: '2026-09-16',
      value: 9000,
    });
  });

  it('asks an admin for a reason before overwriting a filled cell', async () => {
    // The backend rejects an admin-like write with no reason, so the modal is
    // not a nicety — saving straight through here would 400.
    renderCell({ isAdmin: true, entry: makeEntry({ plan_value: '18500' }) });

    const input = screen.getByRole('spinbutton');
    await userEvent.clear(input);
    await userEvent.type(input, '17000');
    await userEvent.tab();

    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('passes the typed reason through once the admin confirms', async () => {
    renderCell({ isAdmin: true, entry: makeEntry({ plan_value: '18500' }) });

    const input = screen.getByRole('spinbutton');
    await userEvent.clear(input);
    await userEvent.type(input, '17000');
    await userEvent.tab();

    await screen.findByRole('dialog');
    await userEvent.type(screen.getByRole('textbox'), 'recount after packing');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({
      entryId: 42,
      block: 7,
      entryDate: '2026-09-16',
      value: 17000,
      reason: 'recount after packing',
    });
  });

  it('disables the input while that row is saving', () => {
    renderCell({ savingKey: '42' });

    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });

  describe('a cell with no row yet (create-on-write)', () => {
    it('renders an empty, editable input rather than the em-dash', () => {
      renderCell({ entry: null });

      expect(screen.getByRole('spinbutton')).toHaveValue('');
    });

    it('creates the row on blur — entryId absent, block + entryDate carry the write', async () => {
      renderCell({ entry: null, block: 9, entryDate: '2026-09-18' });

      await userEvent.type(screen.getByRole('spinbutton'), '5000');
      await userEvent.tab();

      expect(onSave).toHaveBeenCalledWith({
        entryId: undefined,
        block: 9,
        entryDate: '2026-09-18',
        value: 5000,
      });
    });

    it('never opens the reason modal for an admin filling a missing cell', async () => {
      renderCell({ entry: null, isAdmin: true });

      await userEvent.type(screen.getByRole('spinbutton'), '5000');
      await userEvent.tab();

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders the em-dash with no click handler when read-only', async () => {
      renderCell({ entry: null, canEdit: false });

      expect(screen.queryByRole('spinbutton')).toBeNull();
      const cell = screen.getByText('—');
      expect(cell).toBeInTheDocument();

      // Nothing to open history for — clicking must not call onCellClick with
      // a fabricated id.
      await userEvent.click(cell);
      expect(onCellClick).not.toHaveBeenCalled();
    });

    it('uses a block-date saving key, not "undefined", while the write is in flight', () => {
      renderCell({ entry: null, block: 9, entryDate: '2026-09-18', savingKey: '9-2026-09-18' });

      expect(screen.getByRole('spinbutton')).toBeDisabled();
    });
  });
});
