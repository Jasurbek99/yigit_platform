# Gaplama tab: how it works

Plain-language version of the Gaplama design, with no code. The technical version is
`2026-09-18-tir-takip-gaplama-design.md`.

---

## 1. What the tab is for

Every day the loading department head opens trucks (drafts) for packaging. The kg for
those trucks comes from the Weekly Plan of the blocks.

The Gaplama tab shows how much of each block's plan is **still left to pack** on each
day. It goes down every time a truck is opened.

## 2. Who uses it

- **Loading department head and deputy:** open trucks.
- **Everyone who can see the Weekly Plan:** can look at the tab.
- **Everyone else:** sees "no access".

## 3. Where the numbers come from

- **Plan:** from the Weekly Plan, the same numbers as the Önümçilik tab. The Gaplama
  tab never changes the plan.
- **On trucks:** the kg of each block that is already on opened trucks for that day.
- **Left:** plan minus on trucks.

"Left" is calculated each time the tab is shown, not saved separately. So:
- when a truck is opened, "left" goes down right away;
- when someone edits the Weekly Plan, "left" follows the new plan.

## 4. What the screen shows

```
 Gaplama        ◀ previous week   this week   next week ▶      block filter
 ───────────────────────────────────────────────────────────────────────────
 Block    Mon      Tue      Wed      Thu      Fri      Sat      Sun    Week
 A        8 000    20 000   20 000   ...                                 ...
          plan 20 000
 B       −1 500    5 000    ...
          plan 5 000                          (red = over plan)
 ───────────────────────────────────────────────────────────────────────────
 Total plan        25 000   25 000   ...
 Trucks (÷18 500)  1.35     1.35     ...
 Opened trucks     [1809012/26 · 18 500 kg]
 Left total        6 500    25 000   ...

 [ + Open truck ]

 Weekly summary      Block | Plan | On trucks | Left
 Opened trucks list  Code | Blocks (kg each) | Kg | Status | Date
```

- **Big number in a cell:** what is left for that block on that day.
- **Small grey "plan" under it:** shown only after a truck took something from that
  cell, so you can see what it started from.
- **Red:** more was put on trucks than was planned.
- **Nobody types in the grid.** It only shows numbers.

## 5. Opening a truck: step by step

1. Press **+ Open truck**.
2. Pick the **day**: today if today is in the week you are looking at, otherwise Monday.
3. Add **rows of block + kg**. One truck can take from several blocks. Each row shows
   how much that block still has left that day.
4. Optionally type the **export code**. The truck's own code is given automatically.
5. The form shows the **total kg**. If it is less than one full truck (18 500 kg), the
   truck is marked **partial**.
6. Press **Open truck**. The truck appears in the list, and the grid numbers go down at
   once.

**Example:** Block A has a 20 000 kg plan on Monday and block B has 5 000 kg. A truck
takes 12 000 from A and 6 500 from B.
- A: 20 000 − 12 000 = **8 000 left**.
- B: 5 000 − 6 500 = **−1 500**, shown red because it is over plan.
- The truck is 18 500 kg, so it is full, not partial.

## 6. The rules we agreed

1. The grid shows the Weekly Plan, and **nobody edits it here**.
2. "Left" is **always calculated** from the current plan. There is no frozen copy.
3. **Going over the plan is allowed** and shown in red. Nothing stops it.
4. **Partial trucks are allowed**; they get a "partial" tag.
5. The **export code is optional**, and there is no automatic export-code generator.
6. Weeks run **Monday to Sunday**, the same as the Önümçilik tab.
7. **Trucks cannot be deleted from this tab.** Today only admin can delete a draft.

## 7. What this tab does NOT do

- It does not let anyone correct the plan kg for a day.
- It does not delete or cancel trucks.
- It does not merge trucks with destinations. The Tırlar tab (Sheet) already does that
  with Join.
- It does not stop a truck heavier than 18 500 kg.

## 8. Things to know

- **The same trucks show up on the Drafts page.** A truck opened here counts there too
  for that day, because it is the same truck.
- **Plan changes move the numbers.** If the plan is lowered after trucks were opened,
  a cell can turn red later.
- **A typo is not caught.** Typing 180 000 instead of 18 000 is accepted; only the red
  cell warns you.
- **Old bug, not fixed here:** a truck that was moved to trash (soft-deleted) still
  counts as "on trucks". This also affects the Drafts page and will be fixed separately.
- **Admin permission screen:** saving it from the main version of the app can hide all
  Tır Takip tabs, including this one, until the permissions are re-seeded. This is a
  known problem from before.

## 9. What gets built

- **Screen:** the Gaplama tab described above, in the Tır Takip design.
- **Server:** one new read-only list: "trucks opened in these days, with kg per block".
  Nothing else on the server changes.
- **Not changed:** the Weekly Plan, the Drafts page, the Sheet and the permissions.
