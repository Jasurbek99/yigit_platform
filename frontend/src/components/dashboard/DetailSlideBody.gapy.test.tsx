import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DetailSlideBody } from './DetailSlideBody';
import type { IShipmentDetail } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

/**
 * The gapy lifecycle is positioned by status code, not status_step: the DB's
 * step_order numbers (yuklenme=1, gumruk_girish=2, …) do not follow the gapy
 * route (customs → loading → done).
 */
function makeDetail(status_code: string, status_step: number): IShipmentDetail {
  return {
    shipment_code: 'GAPY-1/26',
    status_code,
    status_step,
    is_gapy_satys: true,
    firm_splits: [],
    block_sources: [],
    status_log: [],
  } as unknown as IShipmentDetail;
}

function activeStepName(container: HTMLElement): string | null {
  return container.querySelector('.lifecycle-name--active')?.textContent ?? null;
}

describe('DetailSlideBody — gapy lifecycle', () => {
  // Live DB numbering and the seed/test numbering (yuklenme=3, tamamlandy=12)
  // must both land on the same slot.
  it.each([
    ['gumruk_girish', 2, 'Gümrük↑'],
    ['gumruk_chykysh', 3, 'Gümrük↓'],
    ['yuklenme', 1, 'Yüklenme'],
    ['tamamlandy', 13, 'Tamam'],
    ['gumruk_girish', 1, 'Gümrük↑'],
    ['gumruk_chykysh', 2, 'Gümrük↓'],
    ['yuklenme', 3, 'Yüklenme'],
    ['tamamlandy', 12, 'Tamam'],
  ])('highlights the right step at %s (step_order %i)', (code, step, name) => {
    const { container } = render(<DetailSlideBody detail={makeDetail(code, step)} activeColor="#000" />);
    expect(activeStepName(container)).toBe(name);
  });

  it('lists the steps in route order: customs, loading, done', () => {
    const { container } = render(<DetailSlideBody detail={makeDetail('draft', 0)} activeColor="#000" />);
    const names = [...container.querySelectorAll('.lifecycle-name')].map((n) => n.textContent);
    expect(names).toEqual(['Gümrük↑', 'Gümrük↓', 'Yüklenme', 'Tamam']);
  });

  it('highlights nothing on a draft', () => {
    const { container } = render(<DetailSlideBody detail={makeDetail('draft', 0)} activeColor="#000" />);
    expect(activeStepName(container)).toBeNull();
  });
});
