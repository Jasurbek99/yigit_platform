# Technical Analysis: Two Programs Compared

**Prepared at management's request — 23 July 2026**
**Method:** Direct inspection of the running application at `10.10.49.54:3001` (access provided by
management), including its user interface, network traffic, and data-storage behaviour, compared
against the YGT Platform codebase.

---

## Executive summary

Both programs serve the same business — greenhouse tomato export — so at first glance their
screens look similar. But they are **two different classes of software**:

- **"Sera Bütçe Yönetimi"** is a **single-user planning & budgeting tool**. Each person keeps their
  own private copy of the data. It is polished, fast, and good at what it does.
- **YGT Platform** is a **multi-user operational system of record**. The whole company works off
  one shared database, with roles, security, audit, and a real API.

The important conclusion for management: the difference in build time is **not** a difference in
speed of work — it is a difference in what was built. One is a front-end tool; the other is the
full operational backend that a front-end tool cannot replace.

---

## 1. The decisive technical fact: how data is stored

This is the single most important finding, and it is not a matter of opinion — it is how the app
is built, visible directly in its network traffic:

- The **entire application state** is saved as **one JSON document per user account**:
  `GET / PUT /api/storage/sera_butce_state_v1?shared=false`
- The application states this itself, in its own footer on every screen:
  > *"Veriler bu cihazda/hesapta saklanır ve diğer kullanıcılarla paylaşılmaz."*
  > **"Data is stored on this device/account and is NOT shared with other users."**

### What this means in practice

| Question | Sera Bütçe Yönetimi | YGT Platform |
|---|---|---|
| Where does data live? | One JSON blob per account | Relational MSSQL database, 40+ tables |
| Is it shared across staff? | **No** — each user has a private copy | **Yes** — one shared source of truth |
| Can loading, transport, customs, and sales all work the same truck? | No — they'd keep separate copies that drift apart | Yes — each role updates the same record in turn |
| Data integrity (can it enforce "a truck must belong to a real firm")? | No — a blob has no constraints | Yes — foreign keys + referential integrity |
| Audit ("who changed this number, and when?") | No | Yes — full audit log on every change |
| Security | Single login, no roles | Per-role permissions, JWT, brute-force lockout, CSRF |

**Plain-language version:** the colleague's app is like a very well-made personal Excel workbook
that lives in the browser. My platform is the shared company database that many people write to at
once, safely. That difference is the entire reason one takes weeks and the other takes months.

---

## 2. Feature-by-feature comparison

The feature *names* overlap heavily — expected, since both target the same business. What differs
is what sits underneath each feature.

| Capability | Sera Bütçe | YGT Platform | Note |
|---|---|---|---|
| Dashboard: plan vs actual % | ✅ | ✅ | Both good |
| Weekly production plan (plan kg / actual kg per block) | ✅ | ✅ | Same concept (blue plan / green actual) |
| Truck suggestions from plan | ✅ (kg ÷ 20 000) | ✅ (forecast-first drafts) | Same idea |
| Packaging tracking | ✅ | ✅ | |
| Export report with lifecycle statuses (loading → border → transfer → completed → report) | ✅ | ✅ | Both track the same stages |
| Quota tracking (issued vs used, per firm, balance) | ✅ **(well done)** | ✅ | His quota screen is genuinely good |
| Customs documents / expenses | ✅ | ✅ | |
| Contracts | ✅ | ✅ | |
| Finance reports | ✅ | ✅ | |
| **Shared multi-user data** | ❌ | ✅ | The core gap |
| **Roles & permissions (12 roles)** | ❌ | ✅ | |
| **Validated status lifecycle (`transition_to` only)** | ❌ | ✅ | Prevents illegal state jumps |
| **Comments / @mentions / tasks on records** | ❌ | ✅ | |
| **Secure auth (JWT httpOnly, lockout, CSRF)** | ❌ | ✅ | |
| **REST API for future mobile app** | ❌ | ✅ | |
| **Languages** | 2 (TR / TM) | 3 (TK / RU / EN) | |
| **Automated test suite** | none observed | ✅ ~24 000 lines | Protects against regressions |

---

## 3. What the colleague's program does genuinely well (fair credit)

A fair analysis must state this plainly:

- **Clean, modern UI.** It looks good and demos well.
- **Coherent single-manager workflow** — plan → trucks → report → quota, all in one place.
- **The quota module is well thought out** — issued vs used per firm, monthly filter, live balance,
  auto-derived truck counts. This is real, useful work.
- **Fast to use** for one person doing planning and budgeting.

If the need is "one manager wants a polished private tool for budgeting and planning," it does that
job well. This should not be dismissed.

---

## 4. Where its design cannot go (the ceiling)

These are not criticisms of effort — they are hard limits of the "private JSON per user" design:

1. **It cannot be the company's shared system.** Because data isn't shared, different departments
   can't collaborate on the same shipment. Everyone ends up with separate copies — which is exactly
   the Excel problem we set out to eliminate.
2. **No data integrity or audit.** A blob can't guarantee the numbers are consistent, or record who
   changed money/customs figures. For financial and customs data, that is a real business risk.
3. **No security model.** One shared login, no per-role access control.
4. **No path to mobile or system integrations** without rebuilding the data layer from scratch.

---

## 5. Conclusion — directly addressing "development speed"

The two programs are not the same kind of software, so comparing their build times directly is
misleading:

- A **front-end planning tool with private per-user storage** is genuinely faster to build. It
  skips the hardest 80% of an operational system: database design, multi-user concurrency,
  permissions, audit, lifecycle rules, security, tests, and a public API.
- An **operational system of record** — shared database, roles, audit, security, tested API — is
  what the company actually runs on. That is the part that takes months, and it is precisely the
  part a demo never shows.

**Same-looking screens, fundamentally different foundations.** The honest one-line summary:
*his is an excellent personal dashboard; mine is the shared system the company operates on.*

---

## 6. Recommendation — turn rivalry into one product

The most valuable outcome for the company is not "his or mine." It is:

> **Put his strong UI/UX ideas on top of the shared, secure YGT Platform backend.**

That combines his polish with a single source of truth, security, and audit — one product instead
of two half-products, and one team instead of a rivalry. This is the recommendation I'd put to
management.
