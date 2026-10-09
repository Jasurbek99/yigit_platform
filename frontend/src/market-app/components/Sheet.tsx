import { useEffect, useId, type ReactNode } from 'react';

interface ISheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Modal sheet: pinned to the top on phones (the keyboard never covers it), centred from 700 px. */
export default function Sheet({ title, onClose, children }: ISheetProps) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
