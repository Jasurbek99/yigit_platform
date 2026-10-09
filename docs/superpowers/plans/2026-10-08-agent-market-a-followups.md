# Agent market — Part A follow-ups (carry into Parts B–E)

Part A (plan `2026-10-08-agent-market-a-foundation.md`) is done on `feat/agent-market`
(59b81438..5fa324dd): final whole-branch review clean after one fix wave. These items were
reviewed and deliberately deferred. Pick them up in the plan whose code they touch.

## Part B (lots, sales, QR claim) — do these first
- `/m/` has no toast component yet — needed for the 7-second «Отменить» undo toasts.
- `Sheet` (`src/market-app/components/Sheet.tsx`): no focus move / trap / return, page scrolls behind it — fix before the sell form.
- `/m/login`: errors from `/api/v1/auth/login/` are not Russian (the Russian override covers only `/api/v1/market/`) — map login errors to the market app's own Russian text.
- `/market/me/` should return `first_name`; the header currently makes an extra `GET /auth/me/`.
- Team screen: no rename / deactivate for a bazaar, no move of a seller to another bazaar (API supports both). A bazaar-name typo is permanent until then.
- `/scan/:id` in the main app must forward `agent` / `agent_seller` to `/m/scan/{id}` (spec §4 QR claim).
- Reference lists the phone needs (expense categories, cities, product types) must be served under `/api/v1/market/` — everything else is fenced.
- Tests to add with B's scoping: superuser with a non-staff role, inactive user, anonymous, sales rep with no customers; a lookalike-prefix fence assertion (`/api/v1/market-x/`).

## Later / user decisions
- PWA icons are the platform's blue «Y» while `theme_color` is tomato red — the user picks a market icon.
- Turkmen strings added in Part A need a native review.
- Root `CLAUDE.md` dependency line should read `core ← greenhouse ← export ← market ← contracts ← finance` (left to the user — instructions file).
- Password reset does not end an existing session (8 h access token); only «Отключить» is immediate. Token versioning if needed.
- `/market/agents` page reads only the first 50 logins; the customer select lists all customers for a sales rep (backend 403s foreign ones).
- Shared JS chunk for `/m/` is ~266 kB gzip, mostly the three locale files — split locales if phones feel slow.
- Forced Russian writes `ygt_lang=ru` on path `/`, so a staff user bounced from `/m/` sees the main app in Russian.
- Concurrent double-submit of a duplicate bazaar name / username can 500 (IntegrityError) instead of 400.
- `0076` uses `update_or_create` for grants — a re-run would overwrite grants tuned in the admin matrix (migrations run once).
- Role colours `lime` / `green` collide with other roles' tags.
