import { useEffect, useId, type ReactElement, type ReactNode } from 'react';

interface ISheetProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** Modal sheet: pinned to the top on phones (the keyboard never covers it), centred from 700 px. */
export function Sheet({ title, onClose, children }: ISheetProps): ReactElement {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mk-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mk-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="mk-sheet-title" id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
