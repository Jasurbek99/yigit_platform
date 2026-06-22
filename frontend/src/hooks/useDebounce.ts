import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of ``value`` that only updates after ``delay`` ms
 * have elapsed without a change. Useful for search inputs that drive queries.
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}
