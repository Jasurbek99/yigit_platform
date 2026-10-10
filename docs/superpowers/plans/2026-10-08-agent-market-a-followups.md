# Agent market — Part A follow-ups (carry into Parts B–E)

Part A (plan `2026-10-08-agent-market-a-foundation.md`) is done on `feat/agent-market`
(59b81438..5fa324dd): final whole-branch review clean after one fix wave. These items were
reviewed and deliberately deferred. Pick them up in the plan whose code they touch.

## Part B (lots, sales, QR claim) — done 2026-10-10 on `feat/agent-market-b` unless marked open
- ~~`/m/` has no toast component yet — needed for the 7-second «Отменить» undo toasts.~~ Done (Part B, `ToastHost`).
- ~~`Sheet` (`src/market-app/components/Sheet.tsx`): no focus move / trap / return, page scrolls behind it — fix before the sell form.~~ Done (focus in / trap / return, one shared scroll lock, only the top sheet takes Escape).
- ~~`/m/login`: errors from `/api/v1/auth/login/` are not Russian (the Russian override covers only `/api/v1/market/`) — map login errors to the market app's own Russian text.~~ Done (400 / 401 «Неверный логин или пароль», no answer «Нет связи…»).
- ~~`/market/me/` should return `first_name`; the header currently makes an extra `GET /auth/me/`.~~ Done in the Part A review.
- ~~Team screen: no rename / deactivate for a bazaar, no move of a seller to another bazaar (API supports both). A bazaar-name typo is permanent until then.~~ Done (`BazaarEditSheet`, `SellerMoveSheet`).
- ~~`/scan/:id` in the main app must forward `agent` / `agent_seller` to `/m/scan/{id}` (spec §4 QR claim).~~ Done (`ScanPage`; `LoginPage` keeps `?next=/scan/…`).
- ~~Reference lists the phone needs (expense categories, cities, product types) must be served under `/api/v1/market/` — everything else is fenced.~~ Done for what Part B needs: `/market/expense-categories/`, `/buyers/`, `/shipments/`. Cities and product types are not served (the phone does not pick them yet).
- Tests to add with B's scoping: superuser with a non-staff role, inactive user, anonymous, sales rep with no customers; a lookalike-prefix fence assertion (`/api/v1/market-x/`). **Not added in Part B — still open.**

## Still open after Part B
From the Part B review ledger; the ones that matter:
- **Core `@idempotent` stores a raised exception as a replayed 500.** The market views dodge it with `answers_errors`; other `@idempotent` views still have it. A 404 recorded under a key is also replayed on a retry with the same key. Fix in `apps/core/idempotency.py`.
- **A sell form stays stuck after a 500 until reload:** the sale's Idempotency-Key is kept after a server error, so every later save replays the stored 500. Resetting the key risks a double sale; needs the core fix above first.
- **The lots list reads page 1 only (`page_size=200`).** An agent with more than 200 lots in one state loses the oldest from the phone list.
- **`frontend/src/pages/scan/ScanPage.tsx` is over 150 lines** (189); split it.
- **Turkmen strings (Parts A and B) need a native review.**
- **`ConfirmDeleteSheet` focuses «Удалить» first** (Enter on a keyboard deletes); put «Отмена» first or add an initial-focus prop.
- **`.mk-loading` has `min-height: 60vh`**, so the in-transit loading line under the open lots is a tall block; add a compact variant.
- Smaller: `lots_for` does not exclude soft-deleted shipments (`open_lot` does); `ON_THE_ROAD_CODES` (entries) duplicates `VISIBLE_STATUS_CODES` (lots); a debt sale always POSTs `/market/buyers/` first; net × price can overflow `Decimal(12,2)` (500); the `/scan/…` forward accepts any `/scan/…` path, tighten to `/^\/scan\/\d+$/`.

## Later / user decisions
- ~~PWA icons are the platform's blue «Y» while `theme_color` is tomato red — the user picks a market icon.~~ Done 2026-10-09: Yigit logo, green theme; main site has the iPhone icon too.
- ~~Turkmen strings added in Part A need a native review.~~ Listed once under «Still open after Part B».
- Root `CLAUDE.md` dependency line should read `core ← greenhouse ← export ← market ← contracts ← finance` (left to the user — instructions file).
- Password reset does not end an existing session (8 h access token); only «Отключить» is immediate. Token versioning if needed.
- `/market/agents` page reads only the first 50 logins; the customer select lists all customers for a sales rep (backend 403s foreign ones).
- Shared JS chunk for `/m/` is ~266 kB gzip, mostly the three locale files — split locales if phones feel slow.
- Forced Russian writes `ygt_lang=ru` on path `/`, so a staff user bounced from `/m/` sees the main app in Russian.
- Concurrent double-submit of a duplicate bazaar name / username can 500 (IntegrityError) instead of 400.
- `0076` uses `update_or_create` for grants — a re-run would overwrite grants tuned in the admin matrix (migrations run once).
- Role colours `lime` / `green` collide with other roles' tags.
