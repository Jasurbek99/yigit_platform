/**
 * Agents' UI is Russian (spec §9), unless the user already chose a language.
 *
 * The i18n detector writes the `ygt_lang` cookie during init, and in the built
 * bundle `@/i18n` lives in a shared chunk that runs before any market-app code —
 * so the cookie can't be read from a module. m.html has a classic inline script
 * that runs before all modules and records `data-lang-chosen` on <html>.
 */
export const userChoseLanguage = document.documentElement.dataset.langChosen !== 'no';

export function applyMarketLanguage(
  i18n: { changeLanguage: (lng: string) => unknown },
  chose: boolean,
): void {
  if (!chose) void i18n.changeLanguage('ru');
}
