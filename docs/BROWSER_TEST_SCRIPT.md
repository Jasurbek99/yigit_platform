# Browser Test Script — Full Lifecycle, Role by Role

Step-by-step manual test. Every step says **who logs in**, **what to click**, and **what must
happen**. Tick the box when it matches; write the actual result next to it when it doesn't.

- App: **http://localhost:3000** (dev) or **http://10.10.11.25:8080** (beta)
- Accounts: [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md) §A — that file also holds the shared password
  for every `t_*` account. It is gitignored; the password is not repeated here.
- UI is in Turkmen — button labels below are given in Turkmen with the English meaning.

> ⚠️ **This writes real data.** A shipment walked through the lifecycle leaves audit rows,
> quota records, tasks and weekly-plan roll-ups behind. Deleting it afterwards does **not**
> undo those. Run it on beta if you can. Clean-up while the row is still a draft: log in as
> `admin` → open the shipment → hard delete. Once it leaves draft, only cancel is available.

> ⚠️ **Log out fully between roles.** Same browser + stale cookie = wrong role, wrong result.
> Use a private window per role if you are switching quickly.

---

## Known-broken — expected failures, not your mistake

Read this **before** you start, so you don't waste time re-testing them.

| Step | What you will see | Finding |
|------|-------------------|---------|
| `t_document_team`, `sales_rep`, `transport`, `t_finansist`, `warehouse_chief` press **Ýagdaýy üýtget** | Error toast — the transition is refused | **F12** |
| `t_greenhouse_manager` opens **Ýükler** (Shipments) | Page loads empty / errors — every call behind it 403s | **F6** |
| `warehouse_chief` presses **Üpjünçilik garalamasy** (new supply draft) | Refused — `can_create` is 0 in the live DB | **F13** |
| `t_boss` — no checkboxes on the shipment list | Must flip the header toggle to **Üýtgetmek** first; may also need to navigate away and back | Known |
| `t_export_manager` / `t_document_team` open **Boss Analytics** | 403 / empty | **F7** |
| `t_boss` opens **Sales-Rep Coverage** | 403 / empty | **F8** |

**Because of F12, one person cannot hand the shipment along.** To get through Part A, use
`t_export_manager` to fire each transition (it has the privilege bypass), and use the owning
role only to check that its screen and data are correct. Part C tests the refusals on purpose.

---

## Part A — one shipment, start to finish

### A1. `warehouse_chief` / `wc123` — create the supply half

1. [ ] Log in. Landing page loads, no error.
2. [ ] Menu shows about 10 items — **Dashboard**, **Ýükler**, **Garalamalar** (Drafts),
       **Pallet manifest**, **Hasyl tagtasy** (Harvest board). **No** admin section.
3. [ ] Open **Garalamalar** → press **Üpjünçilik garalamasy** (supply draft).
       ⚠️ **F13: expect this to be refused.** If it opens, F13 is already fixed — note that.
4. [ ] If refused, log in as `t_export_manager` and create it there instead:
       Jemi agram `20000`, pick 1–2 **Bloklar**, pick a **Sort**, save.
5. [ ] The draft appears in the list with status **Garalama**.

### A2. `t_export_manager` — add the destination half and join

6. [ ] Log in. Menu shows about 36 items including the **Admin** section.
7. [ ] Create the destination draft: **➕ Täze ýük** → set country, customer, date.
8. [ ] Select **both** drafts (tick two rows) → press **Birleşdir** (Join).
9. [ ] Modal shows which row is kept and which is deleted (**Galýar** / **Öçüriler**).
       Confirm.
10. [ ] Toast: *Garalamalar üstünlikli birleşdirildi*. One row remains, carrying both the
        blocks and the country/customer.
11. [ ] **Write the shipment code down** — every step below refers to it.

> If you try to advance a draft that has only one half, you must get an error naming what is
> missing (`country`, `customer` or `block_sources`) — **not** a permission error. Worth
> testing once: [ ] .

### A3. `t_document_team` — customs in and out

12. [ ] Log in. Menu shows about 24 items including **Şertnamalar** (Contracts) and
        **Resminamalar** (Documents).
13. [ ] Open the shipment. The customs fields are editable for you.
14. [ ] Press **Ýagdaýy üýtget** (change status) → choose **Gümrük giriş** → **Tassykla**.
        ⚠️ **F12: expect an error toast.** Record exactly what it says.
15. [ ] Switch to `t_export_manager` and fire **Gümrük giriş**, then **Gümrük çykyş**.
16. [ ] Back as `t_document_team`: the shipment now shows **Gümrük çykyş** and its history
        lists both steps with who fired them.
17. [ ] Generate the customs packet / CT-1. File downloads and opens.
18. [ ] DB-filled values print **red**, boilerplate prints black. Tick the clean-copy
        checkbox in the download modal → same file, all black.

### A4. `warehouse_chief` — loading

19. [ ] As `t_export_manager`, fire **Ýüklenme**.
20. [ ] Log in as `warehouse_chief`. Shipment shows **Ýüklenme**.
21. [ ] Open the pallet manifest. Add pallets. Values save and the totals update.

### A5. `t_weight_master` — weights

22. [ ] Log in. Menu shows about 9 items. **No** admin, **no** plan.
23. [ ] Open the shipment's pallet manifest and enter weights. They save.
24. [ ] Confirm there is **no** working way for you to change the status.
        (If a button exists, it must fail — that is correct today.)

### A6. `t_document_team` — departure

25. [ ] As `t_export_manager`, fire **Ýola çykdy**.
        ⚠️ **P1:** this step is owned by `document_team` in the code but the DB says
        `transport`. Note which role the **UI** shows as responsible — that tells us which
        of the two the frontend reads.

### A7. `transport` / `tr123` — border

26. [ ] Log in. Menu shows about 8 items.
27. [ ] Open the shipment — it is visible and shows **Ýola çykdy**.
28. [ ] Press **Ýagdaýy üýtget** → **Serhet geçdi**. ⚠️ **F12: expect refusal.**
29. [ ] As `t_export_manager`, fire **Serhet geçdi**.
30. [ ] Back as `transport`: open **Transport → Karta** (fleet map). Trucks show as pins.

### A8. `sales_rep` / `sr123` — destination and sale

31. [ ] Log in. Menu shows about 7 items — **no Dashboard**. Confirm the dashboard really is
        absent, not just empty.
32. [ ] As `t_export_manager`, fire in order: **Barýan ýurduna girdi** → **Baryş gümrügi** →
        **Bardy** → **Satylyar** → **Satyldy**.
33. [ ] If the shipment has **Peregruz** ticked, the path must go through **Peregruz** before
        **Bardy**. Test this on a second shipment if the first has it off: [ ] .
34. [ ] As `sales_rep`, open **Meniň hasabatlarym** (my reports) and file the sales report for
        this shipment. It saves.

### A9. `t_finansist` — close

35. [ ] Log in. Menu shows about 10 items including **Awanslar** (Advances) and **Bahalar**
        (Prices) — the money screens.
36. [ ] Press **Ýagdaýy üýtget** → **Tamamlandy**. ⚠️ **F12: expect refusal.**
37. [ ] As `t_export_manager`, fire **Tamamlandy**.
38. [ ] Shipment reads **Tamamlandy**. Its history lists every step in order with the actor.

### A10. `t_director` and `t_boss` — review

39. [ ] `t_director`: menu about 32 items. Open **Boss Analytics** — revenue, debt and top
        customers all load.
40. [ ] `t_director`: open **Direktor → Duran ýükler** (stuck shipments). Loads.
41. [ ] `t_boss`: menu about 39 items. Boss Analytics loads.
42. [ ] `t_boss`: header toggle starts on **Görmek** (view). Flip to **Üýtgetmek** (edit) and
        confirm the dialog.
43. [ ] Only now do row checkboxes appear on the shipment list. If they still don't, navigate
        away and back. **Record which it took** — that tells us whether the non-reactive
        predicate still bites.

---

## Part B — menu check, every role

Log in as each and compare against the expected page count. You are looking for a **link that
opens something broken** or a **screen that should not be there at all**.

| Account | Pages | Must be able to open | Must NOT see |
|---------|------:|----------------------|--------------|
| `admin` / `admin123` | 43 | everything incl. **Rugsatlar** (Permissions) | — |
| `t_boss` | 39 | Boss Analytics, all admin reference screens | Permissions, Users, Staff access |
| `t_export_manager` | 36 | Admin reference data, contracts | Advances, Prices, Overdue |
| `t_director` | 32 | Analytics, Advances, Prices, Overdue | any `admin.*` reference screen |
| `t_document_team` | 24 | Contracts, Documents, Firms | Weekly plan, Pallet manifest |
| `t_loading_dept_head` | 21 | Staff access, Users, Blocks | — |
| `t_loading_dept_head_deputy` | 19 | same **minus** Staff access + Users | Staff access, Users |
| `t_finansist` | 10 | Advances, Prices | — |
| `warehouse_chief` / `wc123` | 10 | Shipments, Drafts, Pallet manifest | any admin screen |
| `t_weight_master` | 9 | Harvest board, Pallet manifest | any admin screen |
| `t_greenhouse_manager` | 9 | Weekly plan, Domestic sales | Kanban board |
| `t_accountant` | 8 | Dashboard, Shipments | any money screen |
| `transport` / `tr123` | 8 | Shipments, Board | any admin screen |
| `sales_rep` / `sr123` | 7 | Sales reports, Shipments | **Dashboard** |
| `t_seller` | 5 | Ýerli satuw meýilnamasy only | everything else |

44. [ ] The **head / deputy** pair differ by exactly two screens: **Staff access** and
        **Users**. Check both accounts side by side.
45. [ ] `t_seller` really is limited to one working screen plus feedback and My board.
46. [ ] `t_greenhouse_manager`: **Ýükler** appears in the menu but is broken — **F6**.

---

## Part C — refusals that must hold

Each of these must be **denied**. A success here is a security bug, so record it loudly.

47. [ ] `t_weight_master` tries to change a shipment status → refused.
48. [ ] `t_accountant` tries to change a shipment status → refused.
49. [ ] `t_seller` tries to change a shipment status → refused.
50. [ ] `t_greenhouse_manager` tries to change a shipment status → refused.
51. [ ] `t_document_team` tries to **cancel** a shipment (**Ýatyr**) → refused.
52. [ ] `t_boss` tries to cancel → refused. (Boss can do almost everything else; not this.)
53. [ ] `t_director` opens `/admin/permissions` directly in the URL bar → refused, not just
        hidden from the menu.
54. [ ] `t_boss` opens `/admin/permissions` directly → refused.
55. [ ] Only `admin` can permanently delete a draft. `t_boss`, `t_director` and
        `t_export_manager` must all be refused.
56. [ ] Nobody can permanently delete a shipment that has left **Garalama**, `admin` included.

### Soft delete is open to everyone — confirm on purpose

57. [ ] `t_weight_master` soft-deletes a scratch draft → **succeeds**. This is intended
        (`_OPEN_ACTIONS`), but confirm it is what you want, because `t_seller` can too.
58. [ ] `admin` restores it with **?show_deleted=true** → row comes back.

---

## Part D — the two account traps

59. [ ] Log in as `document_team` / `dt123` → **fails**. The password is wrong (**T2**).
60. [ ] Log in as `export_manager` / `em123` → **fails** (**T2**).
61. [ ] If you get into the old `document_team` account some other way, check its role in
        the admin: it is **`export_manager`**, not `document_team` (**T1**). Do not use it
        to test document-team permissions — use `t_document_team`.

---

## Reporting

For each unticked box write: step number, account used, what you clicked, what happened,
and a screenshot if the screen looks wrong. Add them under a new heading in
[FINDINGS_BACKLOG.md](FINDINGS_BACKLOG.md) so everything stays in one place.
