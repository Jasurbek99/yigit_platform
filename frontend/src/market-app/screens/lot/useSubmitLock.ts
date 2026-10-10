import { useRef, useState } from 'react';

export interface ISubmitLock {
  /** Locked from the press; freed only when the job fails. */
  busy: boolean;
  /** Runs `job` unless one is already running. `job` answers true on success (the sheet closes). */
  run: (job: () => Promise<boolean>) => Promise<void>;
}

/**
 * One create at a time for a sheet. The Idempotency-Key is read at render, so a second press
 * before the re-render must not post again: a ref blocks it in the same tick, `busy` disables
 * the button. After a success the sheet unmounts, so the lock is never freed there.
 */
export function useSubmitLock(): ISubmitLock {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = async (job: () => Promise<boolean>): Promise<void> => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    if (!(await job())) {
      lock.current = false;
      setBusy(false);
    }
  };

  return { busy, run };
}
