import type { ReactElement } from 'react';

interface IToastProps {
  readonly text: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

/** The dark bar at the bottom: a message and an optional action («Отменить»). */
export function Toast({ text, actionLabel, onAction }: IToastProps): ReactElement {
  return (
    <div className="mk-toast" role="status">
      <span>{text}</span>
      {actionLabel && onAction && (
        <button type="button" className="mk-toast-btn" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}
