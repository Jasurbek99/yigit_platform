import { describe, it, expect } from 'vitest';
import { loginPathFor, safeNextPath } from './loginRedirect';

describe('loginPathFor', () => {
  it('carries a deep link as ?next=', () => {
    expect(loginPathFor('/scan/719')).toBe('/login?next=%2Fscan%2F719');
  });

  it('keeps the deep link query string', () => {
    expect(loginPathFor('/shipments?status=draft')).toBe(
      '/login?next=%2Fshipments%3Fstatus%3Ddraft',
    );
  });

  it('adds no next for the home page', () => {
    expect(loginPathFor('/')).toBe('/login');
  });

  it('leaves a login URL as it is, so an existing next survives', () => {
    expect(loginPathFor('/login?next=%2Fscan%2F719')).toBe('/login?next=%2Fscan%2F719');
    expect(loginPathFor('/login')).toBe('/login');
  });
});

describe('safeNextPath', () => {
  it('accepts an in-app path', () => {
    expect(safeNextPath('/scan/719')).toBe('/scan/719');
    expect(safeNextPath('/shipments?status=draft')).toBe('/shipments?status=draft');
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['protocol-relative', '//evil.com'],
    ['backslash host', '/\\evil.com'],
    ['absolute URL', 'https://evil.com'],
    ['relative path', 'scan/719'],
    ['login loop', '/login?next=%2Fscan'],
  ])('rejects %s', (_label, value) => {
    expect(safeNextPath(value)).toBeNull();
  });
});
