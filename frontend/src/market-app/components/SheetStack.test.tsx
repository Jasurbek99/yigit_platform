import { describe, it, expect } from 'vitest';
import { useState, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from './Sheet';

/** Two sheets that open in one commit (A under, B on top) and close in one commit. */
function TwoSheets(): ReactElement {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const openBoth = (): void => {
    setA(true);
    setB(true);
  };
  const closeBoth = (): void => {
    setA(false);
    setB(false);
  };
  return (
    <>
      <button type="button" onClick={openBoth}>open both</button>
      {a && (
        <Sheet title="A" onClose={() => setA(false)}>
          <input aria-label="a1" />
          <button type="button" onClick={closeBoth}>close all</button>
        </Sheet>
      )}
      {b && (
        <Sheet title="B" onClose={() => setB(false)}>
          <input aria-label="b1" />
          <button type="button" onClick={closeBoth}>b close all</button>
        </Sheet>
      )}
    </>
  );
}

describe('Sheet stack', () => {
  it('gives the page its scroll back when two sheets close in one render', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<TwoSheets />);
    await user.click(screen.getByRole('button', { name: 'open both' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button', { name: 'b close all' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('Escape closes only the top sheet; the page stays locked under the one left', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<TwoSheets />);
    await user.click(screen.getByRole('button', { name: 'open both' }));
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'A' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('Tab stays inside the top sheet', async () => {
    const user = userEvent.setup();
    render(<TwoSheets />);
    await user.click(screen.getByRole('button', { name: 'open both' }));
    expect(screen.getByLabelText('b1')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'b close all' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('b1')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'b close all' })).toHaveFocus();
  });
});
