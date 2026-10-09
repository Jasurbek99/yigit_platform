import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import { TruckRig } from './TruckRig';

function fills(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.mk-pal')).map((c) => c.style.getPropertyValue('--p'));
}

describe('TruckRig', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ru');
  });

  it('draws one cell per pallet, filled by what is left from the first', () => {
    render(<TruckRig total={100} perPallet={50} used={25} />);
    expect(fills()).toEqual(['100%', '50%']);
    expect(screen.getByRole('img')).toHaveAccessibleName('Осталось 75 из 100 ящиков');
  });

  it('caps the bed at 44 cells', () => {
    render(<TruckRig total={1000} perPallet={10} used={0} />);
    expect(fills()).toHaveLength(44);
    expect(new Set(fills())).toEqual(new Set(['100%']));
  });

  it('shows an empty bed when more was used than received', () => {
    render(<TruckRig total={10} perPallet={5} used={12} />);
    expect(fills()).toEqual(['0%', '0%']);
  });
});
