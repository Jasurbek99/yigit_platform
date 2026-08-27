# Ideas — 2026-08-22

Captured during testing. Raw, unfiltered. Not defects (those go in FINDINGS_BACKLOG.md).

**Ideas 1–5 are built** (2026-08-23, not committed, not browser-tested) — see
[IDEAS_BUILD_REPORT.md](IDEAS_BUILD_REPORT.md) for what shipped, what was left open, and one decision
waiting on you (the local-sell reject loop).

---

## 1. Sheet — group the columns each role writes

Finding your row in the sheet is very hard. Group together the fields that one role
fills in, so each role has its own block of columns instead of hunting across the whole
width. Similar to how Sera Bütçe does it.


## 2. Seller panel — only the sell plan

The seller does not need to see all the quota things: show only the sell plan, and let
the seller initialize the week themselves. There is also an error when loading the data
that needs looking at. And remove the map from the seller's panel.

*Status: the sell-plan-only panel, self-initialize week and the load error were done in
`de01b15`. Remaining: remove the map from the seller's panel.*


## 3. Local sell plan stays editable after approval

Once the local sell plan is approved it is still editable by export_manager /
document_team. Needs to be locked after approve.

*Status: done 2026-08-23. Enforced on the backend — PATCH on an approved plan returns
409 `plan_approved_locked` for every role, admin included, before any field is even
compared. The grid renders those cells read-only with a tooltip. Consequence: there is
no un-approve action, so a wrongly-approved week now needs Django admin or SQL.*

## 4. Local sell — behave like the weekly plan

Make local sell work the same way as the weekly plan: after the week is submitted it
should still be possible to fill in the empty fields. Also, save on edit — no separate
send button.

*Status: done 2026-08-23. Cells save on blur (the weekly plan's HarvestCell does the
same — there is no keystroke debounce anywhere in that grid either), the "Submit All"
button is gone, and the first save carrying a value > 0 auto-submits the week. After
submit, days still at 0 stay fillable; days that already hold a value lock to the
writer and remain overridable by an approver. Note the weekly plan does not actually
implement "fill-empties" — its rule is an edit window that closes at the week's own
Sunday plus override-with-reason — so this is the stated rule, not a copy of that one.*

## 5. Quota — add a per-firm summary tab

New tab in the quota screen: list the firms and how much quota each one has. A summary
view, not the raw records.
