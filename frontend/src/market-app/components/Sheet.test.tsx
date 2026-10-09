import { describe, it, expect } from 'vitest';
import { useState, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from './Sheet';

function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  // Controlled, so every keystroke re-renders the parent with a new onClose.
  const [text, setText] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open</button>
      {open && (
        <Sheet title="Title" onClose={() => setOpen(false)}>
          <input aria-label="first" />
          <button type="button" disabled>off</button>
          <input aria-label="last" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" onClick={() => setOpen(false)}>close</button>
        </Sheet>
      )}
    </>
  );
}

describe('Sheet', () => {
  it('focuses the first field, traps Tab inside, locks the page and gives focus back on close', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'open' });
    await user.click(opener);

    expect(screen.getByLabelText('first')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    await user.tab();
    expect(screen.getByLabelText('last')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('first')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'close' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'close' }));
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('keeps focus in the field the user is typing in when the parent re-renders', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.type(screen.getByLabelText('last'), 'abc');
    expect(screen.getByLabelText('last')).toHaveFocus();
  });

  it('brings Tab back into the sheet after a click on its title', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(screen.getByRole('heading', { name: 'Title' }));
    await user.tab();
    expect(screen.getByLabelText('first')).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus();
  });
});
