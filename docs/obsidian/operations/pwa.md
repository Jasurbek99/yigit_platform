---
title: PWA (Progressive Web App)
tags: [operations, frontend, infrastructure]
---

# PWA (Progressive Web App)

> The frontend ships as an installable PWA — not Electron, not a native app. One codebase serves Windows office PCs, Android phones in the warehouse, and tablets in the greenhouses.

## Why PWA, not Electron

- Same React build runs everywhere a Chromium-based browser exists
- `display: standalone` removes the browser toolbar — looks like a native app once installed
- Zero installer, zero MSI, zero update server — Chrome's "Install" button creates a desktop shortcut + taskbar icon
- Auto-updates silently on next visit while online (`registerType: 'autoUpdate'`)
- Electron alternative would be a 150 MB installer + manual updates on 20+ machines across three countries

## How users install

| Platform | Trigger |
|----------|---------|
| Windows / Chromium | "Install app" icon in the Chrome address bar → desktop shortcut |
| Android Chrome | "Add to Home Screen" prompt appears automatically |
| iOS Safari | Share sheet → "Add to Home Screen" |

## Implementation

Single Vite plugin: [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/). Configured in `frontend/vite.config.ts`. No manual `navigator.serviceWorker.register` call — `injectRegister: 'auto'` adds it for us.

### Manifest

Generated as `dist/manifest.webmanifest` from the plugin config:

| Field | Value |
|-------|-------|
| name | YGT Export Platform |
| short_name | YGT |
| start_url | `/` |
| display | `standalone` |
| theme_color | `#1677ff` (matches sidebar logo + Antd primary) |
| background_color | `#001529` (matches sidebar dark) |
| icons | `/icon.svg` (any), `/icon-maskable.svg` (maskable) |

Icons live in `frontend/public/`. SVG-only — no binary PNGs to maintain. The icon is a `Y` glyph on the `#1677ff` blue tile, matching the sidebar logo.

> **iOS caveat**: Apple has spotty support for SVG `apple-touch-icon`. If iOS install becomes a real use case, add a 180×180 PNG. Not a v1 blocker — primary install target is desktop Chrome on office PCs.

### Caching strategy (Workbox runtime caching)

| Resource | Strategy | Why |
|----------|---------|-----|
| App shell (js/css/html/svg/woff2) | Precache | Loads instantly from cache; revalidated on each new build |
| `/api/*` GET (excluding `/api/v1/auth/*`) | NetworkFirst, 5 s timeout, 100 entries / 5 min | Stale data is acceptable for read endpoints, but the network is always tried first |
| `/api/v1/auth/*` | **Never cached** | httpOnly JWT cookie + multi-role permissions; serving a stale `/auth/me/` to a different user would leak roles. Mutations and auth must always hit the network. |
| Google Fonts stylesheets | StaleWhileRevalidate | |
| Google Fonts webfonts (`fonts.gstatic.com`) | CacheFirst, 1 year | |

> **Mutations are never cached.** Only `request.method === 'GET'` is matched. POST/PATCH/DELETE always go to the network — no offline write queue (yet).

### Service worker registration

`vite-plugin-pwa` injects `<script src="/registerSW.js">` into `index.html` at build time. With `registerType: 'autoUpdate'` the SW silently activates the new version on next page load — no "reload to update" prompt.

`devOptions.enabled: false` — the SW is **not** active under `npm run dev`. To test PWA behavior locally, build and serve the production output:

```bash
cd frontend
npm run build
npm run preview     # serves dist/ on http://localhost:4173
```

Then open Chrome DevTools → Application → Service Workers / Manifest to inspect.

## Connection status indicator

Header (`AppLayout.tsx`) renders a `<ConnectionStatus />` dot next to the language switcher.

- Green dot = `navigator.onLine === true`
- Red dot + "Offline — changes may not save" tooltip when offline

Powered by `useOnlineStatus()` (`frontend/src/hooks/useOnlineStatus.ts`) — wraps `navigator.onLine` with `online`/`offline` window event listeners.

i18n keys: `connection.online`, `connection.offline` (tk/ru/en).

## What is NOT included

- **No offline write queue.** Edits made while offline will fail. The dot is a warning, not a promise that work will sync later.
- **No IndexedDB persistence of TanStack Query cache.** API responses cached only by the SW (5 min) and TanStack's in-memory cache.
- **No background sync API.** Adding this would mean: IndexedDB queue → replay on reconnect → conflict resolution against the server's current state.

If/when offline mutations are required, scope it as its own feature with explicit conflict-resolution rules per endpoint.

## Files

| File | Role |
|------|------|
| `frontend/vite.config.ts` | `VitePWA(...)` plugin config — manifest + Workbox runtime caching |
| `frontend/public/icon.svg` | Primary app icon (`any` purpose) |
| `frontend/public/icon-maskable.svg` | Maskable variant for Android adaptive icons |
| `frontend/index.html` | `<link rel=apple-touch-icon>`, `<meta name=theme-color>` |
| `frontend/src/hooks/useOnlineStatus.ts` | `navigator.onLine` + event listeners |
| `frontend/src/components/ConnectionStatus.tsx` | Header indicator dot + tooltip |
| `frontend/src/components/AppLayout.tsx` | Mounts `<ConnectionStatus />` in the header |
| `frontend/src/i18n/{tk,ru,en}.json` | `connection.online`, `connection.offline` |

## Build artifacts (generated)

After `npm run build`:

- `dist/manifest.webmanifest` — generated manifest
- `dist/sw.js` + `dist/workbox-*.js` — service worker
- `dist/registerSW.js` — auto-registration shim
- `dist/icon.svg`, `dist/icon-maskable.svg`

## Verification checklist

When changing PWA config, verify in Chrome DevTools after `npm run preview`:

- [ ] Application → Manifest: name, theme color, icons render
- [ ] Application → Service Workers: SW registered + activated
- [ ] Application → Storage → Cache Storage: shell entries present, `api-cache` populates after navigation
- [ ] Address bar shows "Install app" icon → click installs to desktop
- [ ] DevTools → Network → Offline: header dot turns red, app shell still loads
- [ ] Toggle online again: dot turns green, API calls resume
