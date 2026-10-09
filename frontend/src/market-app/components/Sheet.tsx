import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';

interface ISheetProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), '
  + 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

/** Keep Tab inside `root`: wrap at both ends, and pull focus back if it left (a click on the title). */
function trapTab(root: HTMLElement | null, e: KeyboardEvent): void {
  const items = focusables(root);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = root?.contains(document.activeElement) ?? false;
  if (e.shiftKey && (!inside || document.activeElement === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Modal sheet: pinned to the top on phones (the keyboard never covers it), centred from 700 px.
 * Mounting it opens it: focus moves to the first field, Tab stays inside, the page behind
 * does not scroll; unmounting gives focus back to what opened it.
 */
export function Sheet({ title, onClose, children }: ISheetProps): ReactElement {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  // The parent passes a new onClose on every render; the mount-only effect reads the latest.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    focusables(sheetRef.current)[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current();
      else if (e.key === 'Tab') trapTab(sheetRef.current, e);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  return (
    <div className="mk-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={sheetRef}
        className="mk-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 className="mk-sheet-title" id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
