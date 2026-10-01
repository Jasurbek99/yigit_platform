import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useJumpToHash } from './useJumpToHash';

function Page({ isLoaded }: { isLoaded: boolean }) {
  useJumpToHash(isLoaded);
  return isLoaded ? <div id="detail-field-quality.azyk_maglumatnama">certificates</div> : null;
}

function renderAt(url: string, isLoaded: boolean) {
  const scroll = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = scroll;
  render(
    <MemoryRouter initialEntries={[url]}>
      <Page isLoaded={isLoaded} />
    </MemoryRouter>,
  );
  return scroll;
}

// «Upload certificates» on the quality task card links to
// /shipments/:id#detail-field-quality.azyk_maglumatnama — the Detail page
// loads asynchronously, so the browser's own hash jump finds nothing.
describe('useJumpToHash', () => {
  it('scrolls to the hash target once the page has loaded', () => {
    const scroll = renderAt('/shipments/7#detail-field-quality.azyk_maglumatnama', true);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('waits while the page is still loading', () => {
    const scroll = renderAt('/shipments/7#detail-field-quality.azyk_maglumatnama', false);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('does nothing without a hash', () => {
    const scroll = renderAt('/shipments/7', true);
    expect(scroll).not.toHaveBeenCalled();
  });
});
