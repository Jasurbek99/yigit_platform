export type SaveState = 'idle' | 'pending' | 'saved' | 'error';

interface IDeriveSaveStateArgs {
  isPending: boolean;
  isError: boolean;
  hasSavedOnce: boolean;
}

/**
 * Collapse the mutation flags into the one state the row renders.
 *
 * Precedence is pending > error > saved > idle: an in-flight retry must not
 * keep showing the previous failure, and a success must not be erased by a
 * later unrelated render.
 */
export function deriveSaveState({
  isPending,
  isError,
  hasSavedOnce,
}: IDeriveSaveStateArgs): SaveState {
  if (isPending) return 'pending';
  if (isError) return 'error';
  if (hasSavedOnce) return 'saved';
  return 'idle';
}
