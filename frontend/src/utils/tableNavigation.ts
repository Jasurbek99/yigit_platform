/**
 * Spreadsheet-style keyboard navigation for Ant Design Table cells.
 *
 * Arrow keys move between editable cells (skipping non-input cells).
 * Enter blurs the current cell then moves down.
 * Tab / Shift+Tab move right / left.
 * Escape blurs.
 *
 * A cell is "editable" if it currently renders an <input>, OR if it contains
 * a wrapper marked with `data-edit-cell="true"`. Wrappers in display mode are
 * activated by dispatching a click on them; the React onClick swaps the cell
 * into edit mode and we then focus the freshly mounted input.
 *
 * Usage: add `onKeyDown={handleCellKeyDown}` to any `<InputNumber>` inside a table cell.
 */

type Direction = 'up' | 'down' | 'left' | 'right';

interface INextTarget {
  /** Cell to focus into. */
  cell: HTMLElement;
  /** Existing input if any; if null, we'll click the editable wrapper. */
  input: HTMLInputElement | null;
  /** Click target when there's no input yet (display-mode cell). */
  editWrapper: HTMLElement | null;
}

function findNextTarget(cell: Element, dir: Direction): INextTarget | null {
  const row = cell.closest('tr');
  if (!row) return null;
  const cellIndex = Array.from(row.children).indexOf(cell);

  function inspect(td: Element | null | undefined): INextTarget | null {
    if (!td) return null;
    const input = td.querySelector<HTMLInputElement>('input');
    const wrapper = td.querySelector<HTMLElement>('[data-edit-cell="true"]');
    if (!input && !wrapper) return null;
    return { cell: td as HTMLElement, input, editWrapper: wrapper };
  }

  if (dir === 'up' || dir === 'down') {
    const sibling = dir === 'down' ? row.nextElementSibling : row.previousElementSibling;
    if (!sibling) return null;
    return inspect(sibling.children[cellIndex]);
  }

  // Left/Right: scan siblings in current row, skipping non-editable cells
  const step = dir === 'right' ? 1 : -1;
  let idx = cellIndex + step;
  while (idx >= 0 && idx < row.children.length) {
    const target = inspect(row.children[idx]);
    if (target) return target;
    idx += step;
  }
  return null;
}

/** Focus + select text inside an input element. */
function focusAndSelect(input: HTMLInputElement): void {
  input.focus();
  input.select();
}

/** Click an editable wrapper to enter edit mode, then focus the freshly mounted input. */
function activateAndFocus(target: INextTarget): void {
  if (target.input) {
    focusAndSelect(target.input);
    return;
  }
  if (!target.editWrapper) return;
  target.editWrapper.click();
  // Wait for React to render the InputNumber, then focus it.
  // Two RAF ticks is enough on Chrome/Edge; setTimeout fallback covers slower paths.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const input = target.cell.querySelector<HTMLInputElement>('input');
      if (input) focusAndSelect(input);
    });
  });
  setTimeout(() => {
    const input = target.cell.querySelector<HTMLInputElement>('input');
    if (input && document.activeElement !== input) focusAndSelect(input);
  }, 80);
}

export function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
  const key = e.key;
  const el = e.target as HTMLInputElement;
  const cell = el.closest('td');
  if (!cell) return;

  if (key === 'Escape') {
    el.blur();
    return;
  }

  let dir: Direction | null = null;
  if (key === 'Enter') dir = 'down';
  else if (key === 'Tab') dir = e.shiftKey ? 'left' : 'right';
  else if (key === 'ArrowDown') dir = 'down';
  else if (key === 'ArrowUp') dir = 'up';
  else if (key === 'ArrowRight') dir = 'right';
  else if (key === 'ArrowLeft') dir = 'left';

  if (!dir) return; // let digits and other keys behave normally

  e.preventDefault();
  e.stopPropagation();
  el.blur(); // commits the value via the cell's onBlur handler

  const target = findNextTarget(cell, dir);
  if (!target) return;

  // Defer until after the current cell's blur+save has flushed React state.
  setTimeout(() => activateAndFocus(target), 60);
}
