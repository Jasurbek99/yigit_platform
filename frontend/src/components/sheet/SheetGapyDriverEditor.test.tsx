import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import SheetGapyDriverEditor from './SheetGapyDriverEditor';

const EMPTY = {
  driver_name: null,
  driver_phone: null,
  driver_passport_serial: null,
  driver_passport_issue_date: null,
  driver_2_name: null,
  driver_2_phone: null,
  driver_2_passport_serial: null,
  driver_2_passport_issue_date: null,
};

describe('SheetGapyDriverEditor', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders name, phone and both passport fields for two drivers, plus a Done button', () => {
    render(<SheetGapyDriverEditor initial={EMPTY} onCommit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByPlaceholderText('Driver name')).toHaveLength(2);
    expect(screen.getAllByPlaceholderText('Driver phone')).toHaveLength(2);
    expect(screen.getAllByPlaceholderText('Passport series')).toHaveLength(2);
    expect(screen.getAllByPlaceholderText('Passport issue date')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('typing name + passport (no phone) and Done commits only the required fields, phone omitted', async () => {
    const onCommit = vi.fn();
    render(<SheetGapyDriverEditor initial={EMPTY} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.type(screen.getAllByPlaceholderText('Driver name')[0], 'Amanmyrat A.');
    await userEvent.type(screen.getAllByPlaceholderText('Passport series')[0], 'AA1234567');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      driver_name: 'Amanmyrat A.',
      driver_passport_serial: 'AA1234567',
    });
  });

  it('leaving every field untouched closes without committing', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    render(<SheetGapyDriverEditor initial={EMPTY} onCommit={onCommit} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('only reports the second driver when just its fields changed', async () => {
    const onCommit = vi.fn();
    const initial = { ...EMPTY, driver_name: 'Existing Driver' };
    render(<SheetGapyDriverEditor initial={initial} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.type(screen.getAllByPlaceholderText('Driver name')[1], 'Bayram B.');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onCommit).toHaveBeenCalledWith({ driver_2_name: 'Bayram B.' });
  });

  it('Escape closes without committing, even after typing', async () => {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    render(<SheetGapyDriverEditor initial={EMPTY} onCommit={onCommit} onClose={onClose} />);

    await userEvent.type(screen.getAllByPlaceholderText('Driver name')[0], 'Amanmyrat A.');
    fireEvent.keyDown(screen.getByTestId('sheet-gapy-driver-editor'), { key: 'Escape' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking outside the panel commits the typed fields', async () => {
    const onCommit = vi.fn();
    render(<SheetGapyDriverEditor initial={EMPTY} onCommit={onCommit} onClose={vi.fn()} />);

    await userEvent.type(screen.getAllByPlaceholderText('Driver name')[0], 'Amanmyrat A.');
    fireEvent.mouseDown(document.body);

    expect(onCommit).toHaveBeenCalledWith({ driver_name: 'Amanmyrat A.' });
  });

  it('opening the passport date calendar does not dismiss the panel', async () => {
    // Regression guard for the useAnchoredCellPanel fix: AntD's DatePicker
    // portals its calendar to document.body, same as Select's dropdown — a
    // click inside it must not read as an "outside click".
    const onCommit = vi.fn();
    const onClose = vi.fn();
    render(<SheetGapyDriverEditor initial={EMPTY} onCommit={onCommit} onClose={onClose} />);

    await userEvent.click(screen.getAllByPlaceholderText('Passport issue date')[0]);
    const dropdown = document.querySelector('.ant-picker-dropdown');
    expect(dropdown).not.toBeNull();

    fireEvent.mouseDown(dropdown as Element);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('sheet-gapy-driver-editor')).toBeInTheDocument();
  });
});
