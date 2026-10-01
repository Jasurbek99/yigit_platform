import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { jumpToSection } from './ShipmentDetailHelpers.helpers';

/**
 * Scroll to the element named by the URL hash once the page has rendered it.
 * The browser's own hash jump runs before an async page has loaded, so it
 * finds nothing — e.g. «Upload certificates» on the quality task card links to
 * /shipments/:id#detail-field-quality.azyk_maglumatnama.
 */
export function useJumpToHash(isLoaded: boolean): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (isLoaded && hash) jumpToSection(decodeURIComponent(hash.slice(1)));
  }, [isLoaded, hash]);
}
