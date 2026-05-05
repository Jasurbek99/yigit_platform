---
title: Feedback Module
tags: [screen, feedback, admin, system]
related: [[../00-index]], [[../api-endpoint-map]], [[../roles/roles-matrix]]
---

# Feedback Module

Centralised in-app ticketing — bugs, suggestions, and questions. Replaces the WhatsApp/Telegram/calls feedback channel. Lives under `/feedback/*` (user-facing) and `/admin/feedback` (admin inbox).

Backend: `apps.feedback` Django app. API under `/api/v1/feedback/tickets/`.

## Pages

| Path | Audience | Purpose |
|---|---|---|
| `/feedback/submit` | every authenticated user | New-ticket form (category / title / description / screenshots), instructions panel right side |
| `/feedback/my-tickets` | every authenticated user | Own tickets, status badges, thread Drawer, **Reopen** action |
| `/feedback/public` | every authenticated user | Read-only stream of tickets the admin has marked public — internal knowledge feed |
| `/admin/feedback` | `role==='admin'` only | Two-pane inbox (35% list / 65% detail). Filter by status / category / author / date / search. Reply with three modes (standard / internal / public). Status dropdown to change workflow state. |
| Floating button | every authenticated page | Bottom-right `<FloatButton>`. Pre-fills `submitted_from_path` so admin sees which screen it came from. Hidden on `/login`. |

## Admin = `role==='admin'` (NOT `is_superuser`)

The feedback admin gate deliberately bypasses the project's shared `is_superuser` shortcut.
- Backend: `IsFeedbackAdmin` checks `request.user.role == 'admin'` only.
- Frontend: `<FeedbackAdminGate>` in `App.tsx` and a one-off filter on the sidebar inbox entry both check `user.role === 'admin'` only.
- Why: a Django superuser whose actual role is `export_manager` (e.g. an ops account) MUST NOT reach the feedback inbox, because feedback is often *about* the export team's processes. Spec §1: "Director and Gadam do NOT get admin access here. This is intentional."

Director, Gadam, and the other 12 non-`admin` roles see only their own tickets + the public feed.

## Models (`apps/feedback/models/`)

| Model | Key fields | Notes |
|---|---|---|
| `FeedbackTicket` | `author / category / title / description / status / is_public / submitted_from_path / submitted_from_label / user_agent / created_at / last_activity_at / resolved_at` | category ∈ {bug, suggestion, question}; status ∈ {new, in_review, resolved, rejected}. Cyrillic collation on title/description. |
| `FeedbackReply` | `ticket / author / content / mode / is_internal / is_public / created_at` | mode ∈ {standard, internal, public}. `save()` denormalises `is_internal`/`is_public` from `mode` for fast filter. Mutual exclusion enforced at model + serializer level. |
| `FeedbackAttachment` | `ticket / reply / file / original_filename / mime_type / size_bytes / uploaded_by / uploaded_at` | XOR check-constraint: exactly one of ticket/reply parent. Files stored at `media/feedback/<YYYY>/<MM>/`. |

## Visibility precedence (server-side, fall-through)

For both list and detail endpoints the queryset and reply filtering follow this order — first match wins:

1. **Admin** (`role==='admin'`) → ticket + every reply, including internal notes.
2. **Author** → own ticket + replies where `is_internal=False`. Applies even after admin marked the ticket public — the author still sees their full standard thread.
3. **Public viewer** (ticket has `is_public=True`, viewer is neither admin nor author) → ticket body + only replies where `is_public=True`.
4. **Otherwise** → 404 from list, 404 from detail (deliberate: never reveal that a private ticket exists).

## API endpoints (under `/api/v1/feedback/tickets/`)

| Verb | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | auth | Paginated list. Admin sees all; non-admin defaults to `?scope=mine`. `?scope=public` for the public feed. Filters: `status`, `category`, `author`, `search`, `date_from`, `date_to`, `page`. |
| GET | `/{id}/` | author / admin / public-viewer | Detail with replies (filtered by precedence above). |
| POST | `/` | auth | Multipart create. Files in `attachments` (multi). |
| PATCH | `/{id}/` | admin | Only `status` writable. Setting status to resolved/rejected stamps `resolved_at`. **`is_public` is rejected** with 400 — public is set ONLY via reply mode='public'. |
| POST | `/{id}/reopen/` | author | Only when status ∈ {resolved, rejected}. Resets to `in_review`, clears `resolved_at`, bumps `last_activity_at`. |
| POST | `/{id}/reply/` | admin | Multipart. Body: `content`, `mode` (standard/internal/public), `attachments`. `mode='public'` atomically flips `ticket.is_public=true`. |
| GET | `/admin_unread_count/` | admin | `{count: <int>}` of `status='new'`. Polled every 60 s by the sidebar badge. |

## Email notifications

`services/email.py` — fires once per new ticket.
- **Recipients:** every active user with `role='admin'` and a non-empty `User.email`, plus the `FEEDBACK_ADMIN_EMAIL` env var if set (lets ops route to a shared mailbox).
- **Fail-silent:** the entire body is wrapped in `try/except Exception`. SMTP down, no recipients, malformed config — none of these break the ticket POST. Errors are logged.
- **Atomicity:** dispatched via `transaction.on_commit(...)` so a DB rollback never sends a stale email.
- **Dev:** `EMAIL_BACKEND` defaults to `console` — emails print to runserver output.
- **Prod:** set `EMAIL_HOST/PORT/USER/PASSWORD/USE_TLS`, `DEFAULT_FROM_EMAIL`, `FEEDBACK_ADMIN_EMAIL`, `PLATFORM_URL` in env.

## File upload validation

Server-side (defensive — client also pre-checks):
- Magic-byte check on the first 12 bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF…WEBP`, GIF `GIF8…`). Defends against extension spoofing.
- 5 MB per file, 5 files per ticket OR per reply.
- Allowed MIME / extension whitelist: PNG, JPEG, WebP, GIF.
- `original_filename` neutralised via `os.path.basename` to prevent path traversal.

## Frontend components

| Component | Location | Purpose |
|---|---|---|
| `FeedbackFAB` | `components/feedback/FeedbackFAB.tsx` | Floating button. Opens a Modal/Drawer with `FeedbackForm` pre-filled with `submitted_from_path` and `user_agent`. Hidden on pre-auth routes. |
| `FeedbackForm` | `components/feedback/FeedbackForm.tsx` | Shared form used by both `SubmitFeedbackPage` and the FAB Modal. |
| `ScreenshotInput` | `components/feedback/ScreenshotInput.tsx` | Four input methods: Ant `Upload.Dragger` (file + drag-drop), `paste` listener (Ctrl+V — accumulates all clipboard images per event), html2canvas-based "Capture this screen" (dynamic import, kept out of the main bundle). Diff-based `useEffect` revokes orphaned `URL.createObjectURL` blobs on every files-array change. |
| `ReplyComposer` | `components/feedback/ReplyComposer.tsx` | Admin reply box. Three-way `<Radio.Group>` for mode. Tooltips on internal/public. Embeds `ScreenshotInput`. |
| `TicketStatusTag` | `components/feedback/TicketStatusTag.tsx` | Status pill: blue=new, gold=in_review, green=resolved, default=rejected. |
| `FeedbackAdminGate` | `App.tsx` | `role==='admin'` only — no `is_superuser` bypass. Used for `/admin/feedback`. |
| `pathLabels.ts` | `components/feedback/pathLabels.ts` | Display-time path → i18n nav-key resolver. Lets a Russian admin see Russian labels for tickets submitted by Turkmen users. |

## Sidebar badge

`useFeedbackAdminUnreadCount()` polls `/admin_unread_count/` every 60 s.
- `enabled: user?.role === 'admin'` — non-admins never fire the query.
- Renders as red `<Badge count={n} />` on the "Feedback Inbox" sidebar entry.
- Counts only `status='new'`; reopened tickets (now `in_review`) are visible inside the inbox but don't increment the badge — they're not new submissions.

## Out of scope (deferred to v1.1)

Per spec §8, deliberately not built:
- Voting / likes on suggestions
- SLA timers and priority levels
- Auto-close after N days of silence
- Telegram / SMS notifications
- "Complaint" category (only bug, suggestion, question)
- Director-level admin visibility
- Structured shipment linking
- User-side notifications (no toast/bell on reply — user must visit My Tickets)
- AuditLog entries (the reply thread is the de-facto audit trail; adding AuditLog would force `apps.export → apps.feedback` reverse dependency or a refactor of AuditLog into `core/`)

## Testing

`apps.feedback.tests` — 20 cases on MSSQL, all passing:
- Visibility precedence (admin / author / peer / public)
- Peer cannot retrieve a private ticket by guessing the URL (404)
- Reply with `mode='public'` flips `ticket.is_public`
- PATCH with `is_public=true` rejected with 400
- Reopen by author moves resolved → in_review
- Reopen by non-author returns 404 (consistent with 404-not-403 philosophy)
- Bad upload (oversize / wrong magic bytes) rejected
- Email function returns silently with no recipients

## Migration

- `0001_initial.py` — three tables, two `FeedbackTicket` indexes (`author/-created_at`, `status/-created_at`), XOR `attachment_has_exactly_one_parent` constraint.
- Apply with `python manage.py migrate feedback`.
