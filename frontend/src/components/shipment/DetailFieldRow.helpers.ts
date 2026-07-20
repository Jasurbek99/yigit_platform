import type { FieldInputType } from '@/constants/shipmentEditConfig';

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

const AUTO_OPEN_TYPES = new Set<FieldInputType>([
  'select',
  'option_select',
  'date',
  'datetime',
]);

/**
 * Should entering edit mode immediately open this input's popup?
 *
 * True for pickers, so one click both enters edit mode and opens the list.
 * False for free text (the user still has to type) and for booleans, which
 * are toggled directly and never enter an edit state at all.
 */
export function shouldAutoOpenEditor(inputType: FieldInputType): boolean {
  return AUTO_OPEN_TYPES.has(inputType);
}
