---
title: Notification Bell & Pop-up Alerts
tags: [screen, component, frontend, notifications]
related: [[../processes/comments-tasks]], [[../processes/realtime-presence]], [[../reference/api-endpoint-map]]
---

# Notification Bell & Pop-up Alerts

## What Is This?

The header bell in `AppLayout` (mounted once, app-wide). It shows every `export.notifications`
row for the current user, with a red unread counter. Clicking a row marks it read and opens its
`link`.

Since 2026-10-01 a notification that **arrives while the app is open** also:

- pops a toast (sonner, top-right) with the same text as the bell row and an **«Открыть»** button
  when the row has a `link`. The button marks it read and navigates there, the same as a bell row;
- plays one short two-tone chime per batch, synthesised with Web Audio, so there is no audio file.

## How It Works

| Piece | File | Role |
|-------|------|------|
| `useNotifications` | `frontend/src/hooks/useNotifications.ts` | Polls `GET /export/notifications/` every 60 s, **also while the tab is in the background** (`refetchIntervalInBackground: true`) |
| `useNotificationAlerts` | `frontend/src/hooks/useNotificationAlerts.ts` | Diffs each fresh list against the ids already seen. New unread ones trigger the chime and toasts (at most 3 per batch) |
| `notificationText` | `frontend/src/utils/notificationText.ts` | One display line per notification, shared by the bell and the toast |
| `playNotificationSound` | `frontend/src/utils/notificationSound.ts` | One shared `AudioContext`; skips the sound before the user's first click on the page |

The **first** loaded list is the baseline. Whatever was already unread at page load stays in the
bell and does not pop up. The hook reacts to the query data, not to the poll, so anything that
refreshes `['notifications']` (poll, invalidate, a future WS push) feeds it.

## Known Limits

- **Latency up to 60 s.** This is still polling. The WebSocket push is tracked in
  [[../processes/realtime-presence]] → Future Work.
- **Every open tab alerts.** Two tabs mean two toasts and two chimes.
- **No sound before the first click.** Browsers block audio until the user has clicked or typed
  on the page. After a reload, the chime starts working on the first click.
- **No Windows system notifications.** The browser Notification API needs HTTPS (or localhost),
  and beta is served over plain `http://<ip>`.
