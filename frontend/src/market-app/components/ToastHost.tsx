import { useEffect, useSyncExternalStore, type ReactElement } from 'react';
import { Toast } from './Toast';
import { getToast, hideToast, subscribeToast, toastMs } from './toastStore';

/** Renders the current toast and hides it after its time. Mount once (in Shell). */
export function ToastHost(): ReactElement | null {
  const toast = useSyncExternalStore(subscribeToast, getToast);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => hideToast(toast.id), toastMs(toast));
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  const { id, onAction } = toast;
  const runAction = onAction
    ? (): void => {
      hideToast(id);
      onAction();
    }
    : undefined;
  return <Toast text={toast.text} actionLabel={toast.actionLabel} onAction={runAction} />;
}
