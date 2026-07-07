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

## How it works now: one template = one gross-net row

The platform mirrors the Excel row directly. A **Packing Template** holds **everything** for one configuration in one place:

- the **whole-truck** numbers (18,000 net · 20,400 gross · 3,040 boxes · 33 pallets) → the **CMR**, and
- a list of **firm shares**, each with its own **explicit** numbers → e.g. Share 1 = 10,000 / 11,373 gross / 1,618 boxes, Share 2 = 8,000 / 9,099 gross / 1,294 boxes → the **Invoices**.

Every number is real and typed — **nothing is calculated behind the scenes**. You build a template once and reuse it.

**On the truck (Sheet → "Packing (gross-net)" popover):**

1. Pick the **firms** on the truck.
2. Pick **one template** — the list only shows templates whose number of shares matches your number of firms.
3. That one pick **fills everything**: the whole-truck line goes to the CMR; each share is **copied onto a firm** (its gross/boxes/pallets, all **editable right there**) and sets that firm's **weight**; a green/red **Σ-check** confirms the firms add up to the truck.
4. If a firm got the wrong share, **⇄ Swap** exchanges the two firms' weight + packing (the total stays the same).

## Edit per truck — for when reality differs

The template is the standard starting point; once applied, the numbers live **on the truck** and are editable. If this real truck's HJ boxes were 1,300 not 1,294, you just type over it in the popover — that firm's Invoice uses your value. The template stays untouched as the reusable standard.

## Poka-yoke — why it's built to prevent mistakes

*Poka-yoke* means "mistake-proofing":

- **Net can't drift.** Each firm's net *is* its weight from the share, and the shares belong to one template — so the firms always total the truck by construction.
- **A live check watches the total.** If the firm weights don't add up to the template's truck net, a **red warning** appears: *"Firms add up to 20,000 kg — truck is 18,000 kg."* Green tick when they match.
- **Templates only offer matching splits.** A 2-firm truck only sees 2-share templates, so you can't apply a 3-way split to a 2-firm truck.

## Where you actually do it

- In the **Sheet**, each truck has a **"Packing (gross-net)"** row → click it → the popover (template picker + per-firm editable numbers + Σ-check + swap).
- The **templates** are managed on the **Admin → Packing Templates** page: set the whole-truck numbers, then **➕ Add share** for each firm.

## The vocabulary (from the old Excel)

- **BRUT** = gross weight, *including the pallets* (what the weighbridge would read). On the CMR, "without pallet" is just gross minus the pallet weight.
- **NET** = the **official** weight written on paperwork — the regulated figure, **not** the real weight. Real trucks carry more (~20,000+ kg); the documents use the capped official number. (This is why the platform never copies the truck's *real* net onto an invoice — see also the AD-1/ADR-023 note about official vs. real weights.)
- **YASIK** = box count. **PALET** = pallet count (a half-truck share is `16.5` pallets). **PALET AGRAMY** = the pallets' own weight.
- **"Bulgar"** is **not** Bulgaria — it's the Turkmen word for **bell pepper**. Those rows are simply the *pepper* product, handled the same way as tomato.

## The short version

The team used to hand-copy packing numbers from an Excel "gross net" sheet into export documents before loading. Now each Excel row is a **Packing Template** — whole truck **plus** each firm's explicit share. On a truck you **pick one template** and it fills the CMR (whole truck) and each firm's Invoice (its share), sets the firm weights (which drive quota), lets you **edit** any number for a real truck, and **warns** the moment the firms don't total the truck.
