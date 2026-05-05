/**
 * Spreadsheet-style keyboard navigation for Ant Design Table cells.
 *
 * Arrow keys move between editable cells (skipping non-input cells).
 * Enter blurs the current cell then moves down.
 * Escape blurs.
 *
 * Usage: add `onKeyDown={handleCellKeyDown}` to any `<InputNumber>` inside a table cell.
 */

export function findNextInput(
  cell: Element,
  dir: 'up' | 'down' | 'left' | 'right',
): HTMLInputElement | null {
  const row = cell.closest('tr');
  if (!row) return null;
  const cellIndex = Array.from(row.children).indexOf(cell);

  if (dir === 'up' || dir === 'down') {
    const sibling = dir === 'down' ? row.nextElementSibling : row.previousElementSibling;
    if (!sibling) return null;
    const target = sibling.children[cellIndex] as HTMLElement | undefined;
    return target?.querySelector<HTMLInputElement>('input') ?? null;
  }

  // Left/Right: skip cells without inputs
  const step = dir === 'right' ? 1 : -1;
  let idx = cellIndex + step;
  while (idx >= 0 && idx < row.children.length) {
    const target = row.children[idx] as HTMLElement;
    const input = target.querySelector<HTMLInputElement>('input');
    if (input) return input;
    idx += step;
  }
  return null;
}

export function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
  const key = e.key;
  const el = e.target as HTMLInputElement;
  const cell = el.closest('td');
  if (!cell) return;

  // Enter always saves (blur fires onBlur → save), regardless of whether a next cell exists.
  if (key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    el.blur();
    const next = findNextInput(cell, 'down');
    if (next) setTimeout(() => { next.focus(); next.select(); }, 50);
    return;
  }

  if (key === 'Escape') {
    el.blur();
    return;
  }

  let input: HTMLInputElement | null = null;
  if (key === 'ArrowDown') input = findNextInput(cell, 'down');
  else if (key === 'ArrowUp') input = findNextInput(cell, 'up');
  else if (key === 'ArrowRight') input = findNextInput(cell, 'right');
  else if (key === 'ArrowLeft') input = findNextInput(cell, 'left');
  else return;  // let all other keys (Tab, digits, etc.) behave normally

  if (!input) return;
  e.preventDefault();
  e.stopPropagation();
  input.focus();
  input.select();
}
