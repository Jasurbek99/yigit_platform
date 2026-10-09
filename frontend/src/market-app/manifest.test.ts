import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(__dirname, '../../public');
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'm/manifest.webmanifest'), 'utf-8'));

describe('market app PWA manifest', () => {
  it('is a standalone Russian app scoped to /m/', () => {
    expect(manifest.start_url).toBe('/m/');
    expect(manifest.scope).toBe('/m/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('ru');
  });

  it('declares 192 and 512 PNG icons and one maskable icon', () => {
    const icons: { sizes: string; type: string; purpose?: string }[] = manifest.icons;
    expect(icons.some((i) => i.sizes === '192x192' && i.type === 'image/png')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.type === 'image/png')).toBe(true);
    expect(icons.filter((i) => i.purpose === 'maskable')).toHaveLength(1);
  });

  it('every icon file exists under public/', () => {
    for (const icon of manifest.icons as { src: string }[]) {
      expect(existsSync(resolve(publicDir, icon.src.replace(/^\//, ''))), icon.src).toBe(true);
    }
  });
});
