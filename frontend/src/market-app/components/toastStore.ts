// One toast at a time, outside React so any screen or hook can raise it (artifact `toast()`).

export interface IToastInput {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Default 3.5 s, 7 s with an action. */
  ms?: number;
}

export interface IToast extends IToastInput {
  id: number;
}

let current: IToast | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Show `toast`, replacing the one on screen. */
export function showToast(toast: IToastInput): void {
  seq += 1;
  current = { ...toast, id: seq };
  emit();
}

/** Hide the toast — only toast `id` when given, so a late timer never hides a newer one. */
export function hideToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToast(): IToast | null {
  return current;
}

/** How long `toast` stays on screen. */
export function toastMs(toast: IToastInput): number {
  return toast.ms ?? (toast.actionLabel ? 7000 : 3500);
}
