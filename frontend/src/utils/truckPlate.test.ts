import { describe, it, expect } from 'vitest';
import { composeTruckPlate } from './truckPlate';

describe('composeTruckPlate', () => {
  it('joins head and trailer with a slash', () => {
    expect(composeTruckPlate('01ABC123', '02XYZ456')).toBe('01ABC123/02XYZ456');
  });
  it('returns just the head when trailer is empty/nullish', () => {
    expect(composeTruckPlate('01ABC123', '')).toBe('01ABC123');
    expect(composeTruckPlate('01ABC123', null)).toBe('01ABC123');
    expect(composeTruckPlate('01ABC123', undefined)).toBe('01ABC123');
  });
  it('returns just the trailer when head is empty/nullish', () => {
    expect(composeTruckPlate('', '02XYZ456')).toBe('02XYZ456');
    expect(composeTruckPlate(null, '02XYZ456')).toBe('02XYZ456');
  });
  it('returns empty string when both are empty', () => {
    expect(composeTruckPlate('', '')).toBe('');
    expect(composeTruckPlate(null, null)).toBe('');
  });
});
