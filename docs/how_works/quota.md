# Quota — How It Works (Plain Language)

> Part of the `how_works/` series — explanations of platform components in human language, no code.

## The core idea: quota is *earned*, not bought

In Turkmenistan, a firm can't just export tomatoes whenever it wants. The government controls how much each firm is allowed to send abroad. The way you **earn** the right to export is by **selling tomatoes on the local (domestic) market first**.

The deal is roughly: **for every 1 kg you sell locally, the government grants you about 10 kg of export quota.** Sell 1,000 kg at home → earn ~10,000 kg of permission to export. It's the government's way of making sure the domestic market is fed before the good money (export) flows out.

## The three streams

Everything in the quota system is tracking three flows of kg and comparing them:

1. **Local sales — the INPUT (what earns quota).** Each firm sells tomatoes domestically, recorded per firm per week. Multiply by 10 → the **"expected"** quota: what the firm *should* receive if the government plays fair.
2. **Quota issuance — the GOVERNMENT'S DECISION (what's actually granted).** A government act on a date, split into per-firm amounts. The ×10 is only a guideline — a clerk decides the real number. The gap between expected and granted is **"not given."**
3. **Quota usage — the CONSUMPTION (what gets spent).** Every truck loaded for export eats into a firm's quota. A shipment can be split across firms; each firm's share draws from *that firm's own* pool.

## Important quirks

- **Quota expires (~1 month).** A sale early in the month (day 1–19) earns quota valid that month only; a late sale (day 20–31) can earn that-month-plus-next — unless the government denies the extension. Dates are set by a clerk, not by formula, so they're stored as entered.
- **A firm holds many quotas at once** — a *stack* of separate grants, each with its own issue date and expiry, not one big bucket.
- **Consumption is FIFO — oldest first.** Exporting burns the oldest grant first, then the next. This matters because of expiry: spend what's about to die before it's wasted. Anything left when a grant expires is **"unused/expired"** — lost permission.

---

# Quota Issuance — the government granting permission

## What an "issuance" actually is

An **issuance** is **one government decision, made on one date**, then **split among the firms** that earned it. It has two layers:

- **The issuance event** — date, product type (tomato or pepper — separate quota worlds), and validity window.
- **The per-firm allocations inside it** — e.g. "firm YGT gets 8,000 kg, firm HJ gets 5,000 kg, firm Arap gets 3,000 kg." Each line is one firm's slice of that one decision.

One issuance contains many firm allocations. One firm appears across many issuances over time. That's why a firm never has "a quota" — it has a *stack* of grants.

## The validity window — when the grant dies

Every issuance carries a **validity** setting, because quota is perishable. Three windows:

- **This month** — expires at the end of the issue month.
- **This and next month** — expires at the end of the following month (the longer leash).
- **Next month** — valid only into next month.

There are three (instead of a clean formula) because the window depends on *when the local sale happened*: early-month sales earn short-lived quota; late-month sales (day 20+) can earn the two-month window — unless the government refuses. A clerk's judgment, so the system stores the decision rather than computing it.

From validity + issue date, the system computes an **expiry date** and a live status badge:

- **Active** — more than 7 days of life left (green).
- **Expiring** — 0 to 7 days left (gold — burn it soon).
- **Expired** — past its date (red — that permission is gone).

## Weekly matching — connecting the grant back to the sales that earned it

Government issuances arrive on **irregular dates**, but local sales are tracked **by week**. To answer "did this week's sales actually produce the quota they should have?", the system **matches each issuance to an ISO week** — by default the week of its issue date.

- One week can have several issuances matched to it.
- Matching happens automatically on save.
- A human can **manually reassign** an issuance to a different week. Once reassigned, the system stops auto-recomputing it (so it won't overwrite the correction).

This powers the **Weekly Flow** view: each week shows the sales that happened, the quota that came back, and how well they matched (coverage %).

## Who can create/edit issuances

Only **export_manager** and **director** can create, edit, or delete issuances. Editing means **replacing the whole set of firm allocations** — submit the new full list and it swaps them out. Everyone else can only look.

## The two things issuance reveals

1. **Government shortfall ("not given")** — expected was ×10, but the government granted less. Compare *expected* vs *issued* to see how much the government shorted the whole holding.
2. **Internal split fairness** — within one issuance, how the total was divided among firms. Zero-sum: if one firm got more than it earned, another got less. The per-firm view exposes favoritism inside the holding.

---

# Quota Usage — exporting trucks spending the permission

## What a "usage record" is

A **usage record** is one line: **"On this date, firm X spent Y kg of quota, for this shipment."** Every exporting truck consumes quota, and because a truck can be shared, one shipment can generate **several** usage records — one per firm on that truck.

A usage record can also exist **without a shipment** — that's how historical Excel data is represented (firm spent the kg, but no live shipment row behind it).

## Usage is automatic — there is no approval step

(There used to be one. It was removed on 2026-08-10 because it never caught anything: the numbers come from the firm splits an operator has already entered, so "approving" them was a click that added no information — and until someone clicked it, real exported kg sat outside every total.)

1. **Auto-creation.** The moment an operator sets the **firm splits** on a shipment (which firms share the truck), the system creates a usage record for each firm. Nobody types the kg by hand.
2. **Where the kg comes from.** Each firm's **actual split weight**. Only when a split carries no weight does it fall back to the admin-configurable **default truck-weight table**:
   - 1 firm → ~18,100 kg.
   - 2 firms → ~9,000 kg each.
   - 3+ firms → truck weight ÷ N.
3. **It counts straight away.** FIFO, firm balances and the dashboard "Used" KPI include the row the instant it exists.
4. **Change the splits, and the usage follows.** The records are regenerated from the current splits every time they change — the old ones are replaced, not preserved. Manually-entered records (the ones with no shipment behind them) are never touched by this.
5. **Anyone with edit rights can correct a number** directly in the grid or the list. There is no "locked once approved" state any more.

The `status` column still exists in the database and every row reads `approved`. It means **"counted"**, not "a human checked this" — `approved_by` and `approved_at` stay empty, because nobody signs anything. The column survives only so the pre-2026-08-10 history stays readable.

## "Committed" now means one thing

It used to mean two: the dashboard counted approved-only, while the firm-split warning at assignment time counted drafts too, so the same firm could show two different consumption figures on two screens. With every row counting immediately, both read the same number.

## FIFO — how a firm's usage eats its stack of grants

A firm has a **stack of separate grants**, each with its own issue date and expiry. To figure out which grants got consumed:

1. Take all of that firm's grants, sorted **oldest issue date first**.
2. Sum all the firm's usage.
3. Pour that usage into the grants **starting from the oldest** — fill grant #1, overflow into grant #2, and so on.

**Oldest-first matters because of expiry** — spend the quota about to die before it's wasted. Whatever's left in a grant when it expires becomes **"unused/expired."**

## Release-on-delete — kg flowing back

If a shipment is removed, its quota should return to the firm's balance. The system does this not by deleting the usage row, but by **no longer counting** rows attached to dead shipments:

- **Soft-delete a shipment** → its usage stops counting; **restore it** → counts again automatically (same row, no re-typing).
- **Cancel a shipment** → its rows are kept but stop counting (until un-cancelled).
- **Admin bulk-delete** → rows truly erased (permanent — the shipment is gone).

Each instantly refreshes the firm's balance so the next assignment sees accurate remaining quota.

## Quota is tracked, not enforced

The single most important operational fact: **the system never blocks an export for lack of quota.** Assign a firm with zero remaining quota and you get a soft ⚠ "no quota" warning — but the save **still goes through.** Trucks move; the books record what happened. The system is a *ledger and a watchdog*, not a gate.

---

## How the two halves meet

| | **Issuance** | **Usage** |
|---|---|---|
| Direction | Quota coming **in** | Quota going **out** |
| Triggered by | Government decision | A truck being loaded |
| Created by | Manually, by manager/director | **Auto-created** from the firm splits |
| Granularity | Per firm, per government act | Per firm, per shipment |
| Has a date window | Yes — validity/expiry | No — just consumes |
| Counts when | Always (it's the grant) | Immediately |

**Issued − Used = what's still available** (per firm, oldest grants first, minus anything that expired unspent). That single comparison, run per firm and rolled up, is the entire quota dashboard.

---

## One-sentence summary

Sell tomatoes locally → earn ~10× that as export quota from the government (minus whatever they shortchange you) → each grant expires in about a month → exporting trucks spend it oldest-first → the system tracks every kg of earned-vs-granted-vs-used so the holding can see both how much the government is shorting them and how they're dividing it internally.
