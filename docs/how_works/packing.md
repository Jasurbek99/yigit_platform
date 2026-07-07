# Packing (Gross-Net) — How It Works (Plain Language)

> Part of the `how_works/` series — explanations of platform components in human language, no code.

## Why this exists at all

Every truck that leaves for export carries paperwork: an **Invoice** (the bill for the buyer) and a **CMR** (the international road waybill). Both must state the cargo's weights and counts — how many **kilograms**, how many **boxes**, how many **pallets**, gross and net.

Here's the catch: **the documents are prepared *before* the truck is loaded.** The truck isn't on the weighbridge yet, so the *real* numbers don't exist. For years the document team solved this with an Excel tab called **"gross net"** — a list of *standard* packing numbers they'd pick the closest one from and copy by hand into each document, against a 13:00 daily deadline. This feature turns that Excel tab into part of the platform so the numbers are picked once and flow into the documents automatically.

## The core idea: one truck, two different sets of numbers

A single physical truck produces **two kinds** of document, and they need **different** numbers:

- The **CMR** describes the **whole truck** — the full 18,000 kg, all 33 pallets. One CMR per truck.
- The **Invoice** describes **one firm's share** of that truck. Because one truck is usually split across **2–3 export firms** (to keep each invoice under the **$10,000** cash/bank threshold), there are 2–3 invoices per truck, each showing only that firm's slice.

So for a truck split `10,000 + 8,000`:
- The **CMR** shows **18,000** (the whole truck).
- Firm A's **Invoice** shows **10,000**; firm B's **Invoice** shows **8,000**.

The old Excel row held both sides at once: the whole-truck numbers on the right, the per-firm slice on the left.

## How it works now: pick one, the rest is calculated

Instead of picking numbers separately for the truck and for each firm (which let people make mistakes — see below), the platform works from **one choice**:

1. **You pick one whole-truck "config"** for the truck — e.g. *"Tomato · truck, 2-firm split (18,000)"* — from a small catalog of standard configs. This is the **template**: 18,000 net, 20,400 gross, 3,040 boxes, 33 pallets. It fills the **CMR** directly.

2. **Each firm's share is worked out automatically** by that firm's weight. Firm A is 10,000 of the 18,000 total, so it gets `10,000 ÷ 18,000` of everything: ~11,333 kg gross, ~1,689 boxes, ~18 pallets. Firm B gets the rest. These fill each firm's **Invoice**.

3. **The numbers always add up.** Because each firm is just a *slice* of the one truck config, the firms' shares always sum back to the whole truck. You never type the per-firm numbers, so they can't disagree with the truck.

## Where the firm weights come from — split templates

Step 2 above splits the truck by "that firm's weight" — but where does `10,000 / 8,000` itself come from? From a second small catalog: **Split Templates**. Just like the old Excel had section labels (`10000/8000`, `14000/3000`, `11300/6700`, `4100/9700/4200`), the platform has a reusable list of those divisions.

In the truck's packing panel there's a **"Split into firms"** picker. It only shows splits that match how many firms are on the truck (a 2-firm truck sees `9000/9000`, `10000/8000`, …; a 3-firm truck sees the three-way ones). Pick one and it sets each firm's weight in one click. If you need a firm to have the *other* share (give YGT the 8,000 instead of the 10,000), each firm has a small weight dropdown to **swap** — the total stays the same, so it can't go wrong.

You **manage** these splits on the **Admin → Split Templates** page: a name (e.g. `10000 / 8000`) and the weights typed as `10000,8000`. Add a new one whenever a division you use isn't there yet. (An even split like `9000/9000` also happens automatically just by choosing the firms — the split template is for the *uneven* ones.)

So there are **two catalogs**, and together they make one truck's paperwork:
- **Packing Presets** = the whole-truck numbers (gross, boxes, pallets).
- **Split Templates** = how the truck's weight divides among the firms.

## Poka-yoke — why it's built to prevent mistakes

*Poka-yoke* means "mistake-proofing." The earlier version of this let someone pick the whole truck as 18,000 **and separately** pick each firm's numbers — so a tired operator could pick `10,000 + 10,000` for an 18,000 truck (that's 20,000 — impossible). This version removes that trap:

- **Net can't drift.** Each firm's net *is* its weight from the split. It's never a separate choice, so the firms always total the truck.
- **The catalog only holds whole-truck configs.** There are no "half-truck" templates to accidentally pick as a whole truck.
- **A live check watches the total.** If the firm weights don't add up to the config you picked (say the firms sum to 20,000 but the config is 18,000), a **red warning** appears immediately: *"Firms add up to 20,000 kg — truck config is 18,000 kg."* Green tick when they match.

## Manual override — for when a real truck is different

The automatic split is proportional, which is right almost always. But a real truck sometimes packs slightly differently (a firm's boxes aren't exactly proportional to its weight). So each derived number is **editable**: type over it and that firm's Invoice uses your value instead of the calculated one. An overridden field is highlighted, and a **reset** button (↺) drops it back to the automatic value. The default is always the safe calculated number; the override is the exception.

## Where you actually do it

- In the **Sheet**, each truck has a **"Packing (gross-net)"** row. Click its cell → a small panel opens: the whole-truck picker on top, each firm's share (with its editable numbers) below, and the live total-check.
- The **catalog** of standard configs is managed on the **Admin → Packing Presets** page (add/edit the templates the team picks from).

## The vocabulary (from the old Excel)

- **BRUT** = gross weight, *including the pallets* (what the weighbridge would read). On the CMR, "without pallet" is just gross minus the pallet weight.
- **NET** = the **official** weight written on paperwork — the regulated figure, **not** the real weight. Real trucks carry more (~20,000+ kg); the documents use the capped official number. (This is why the platform never copies the truck's *real* net onto an invoice — see also the AD-1/ADR-023 note about official vs. real weights.)
- **YASIK** = box count. **PALET** = pallet count (a half-truck share is `16.5` pallets). **PALET AGRAMY** = the pallets' own weight.
- **"Bulgar"** is **not** Bulgaria — it's the Turkmen word for **bell pepper**. Those rows are simply the *pepper* product, handled the same way as tomato.

## The short version

The team used to hand-copy packing numbers from an Excel "gross net" sheet into export documents before loading. Now they **pick one whole-truck template**, the platform **splits it across the firms automatically** (so the numbers always add up), lets them **override** a value when a real truck differs, and **warns them the moment anything doesn't total correctly** — filling the CMR (whole truck) and each firm's Invoice (its share) from that single choice.
