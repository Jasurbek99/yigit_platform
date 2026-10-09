import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('market app language', () => {
  beforeEach(() => {
    vi.resetModules();
    delete document.documentElement.dataset.langChosen;
  });

  it('m.html records the page-load cookie in a classic script before any module runs', () => {
    const html = readFileSync(resolve(__dirname, '../../m.html'), 'utf-8');
    const inline = html.indexOf('dataset.langChosen');
    expect(inline).toBeGreaterThan(-1);
    expect(inline).toBeLessThan(html.indexOf('type="module"'));
  });

  it('treats the user as not having chosen even after i18n init wrote ygt_lang', async () => {
    document.documentElement.dataset.langChosen = 'no';
    document.cookie = 'ygt_lang=en; path=/'; // what i18n init does before market code runs
    const { userChoseLanguage } = await import('./lang');
    expect(userChoseLanguage).toBe(false);
  });

  it('defaults to Russian when the user never picked a language', async () => {
    document.documentElement.dataset.langChosen = 'no';
    const { applyMarketLanguage, userChoseLanguage } = await import('./lang');
    const i18n = (await import('@/i18n')).default;
    await i18n.changeLanguage('en');
    applyMarketLanguage(i18n, userChoseLanguage);
    await vi.waitFor(() => expect(i18n.language).toBe('ru'));
  });

  it('keeps the language the user chose', async () => {
    document.documentElement.dataset.langChosen = 'yes';
    const { applyMarketLanguage, userChoseLanguage } = await import('./lang');
    const i18n = (await import('@/i18n')).default;
    await i18n.changeLanguage('tk');
    applyMarketLanguage(i18n, userChoseLanguage);
    expect(userChoseLanguage).toBe(true);
    expect(i18n.language).toBe('tk');
  });
});
