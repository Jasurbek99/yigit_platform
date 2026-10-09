import type { ReactElement, ReactNode } from 'react';

/** Props the labelled control receives from `Field`. */
export interface IFieldControlProps {
  id: string;
  className: string;
  'aria-invalid': boolean;
  'aria-describedby'?: string;
}

interface IFieldProps {
  readonly id: string;
  readonly label: string;
  readonly error?: string;
  readonly first?: boolean;
  readonly children: (props: IFieldControlProps) => ReactNode;
}

/** Label + control + error line; the control gets id, class and aria wiring through `children`. */
export function Field({ id, label, error, first, children }: IFieldProps): ReactElement {
  return (
    <>
      <label className={first ? 'mk-label mk-label--first' : 'mk-label'} htmlFor={id}>{label}</label>
      {children({
        id,
        className: error ? 'mk-field mk-field--bad' : 'mk-field',
        'aria-invalid': Boolean(error),
        'aria-describedby': error ? `${id}-err` : undefined,
      })}
      {error && <p className="mk-err" id={`${id}-err`}>{error}</p>}
    </>
  );
}
