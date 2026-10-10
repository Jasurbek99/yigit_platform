// The open sheets, newest last. Body scroll is locked while any is open, and only the top
// one answers Escape and Tab — so closing two at once, or one over another, stays sane.

let stack: readonly object[] = [];
let savedOverflow = '';

/** Register an opened sheet (`token` is any object unique to it); locks the page on the first. */
export function pushSheet(token: object): void {
  if (stack.length === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  stack = [...stack, token];
}

/** Forget a closed sheet (any position); gives the page its scroll back after the last one. */
export function removeSheet(token: object): void {
  if (!stack.includes(token)) return;
  stack = stack.filter((t) => t !== token);
  if (stack.length === 0) document.body.style.overflow = savedOverflow;
}

/** True for the sheet opened last that is still open. */
export function isTopSheet(token: object): boolean {
  return stack[stack.length - 1] === token;
}
