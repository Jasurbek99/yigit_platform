export function registerMarketSw(): void {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/m/sw.js', { scope: '/m/' }).catch(() => {});
    });
  }
}
