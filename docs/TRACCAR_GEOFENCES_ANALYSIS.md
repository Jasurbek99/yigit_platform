# Traccar Geofences — Analysis

Date: 2026-09-18. Written as a read-only analysis; option A was built the same day (see §8).

Sources (all Bearer-token GETs against `http://10.10.11.79:8082/api`):
`/geofences`, `/positions`, `/devices`, `/notifications`,
`/reports/events?type=geofenceEnter&type=geofenceExit` for all 122 devices, 2026-09-11 → 2026-09-18.

Related: [fleet-map.md](obsidian/processes/fleet-map.md) (says "no geofence-driven timestamps"),
[2026-07-30 fleet-map spec](superpowers/specs/2026-07-30-traccar-fleet-map-design.md) (geofence
auto-timestamps reserved for a later slice).

---

## 1. What `/api/geofences` returns

- **31 geofences**, all `POLYGON` WKT (5–12 points each).
- Coordinates are **lat-first** — `POLYGON ((38.078 62.755, ...))`. Traccar convention, the reverse of
  standard WKT (lon lat). Any parser must swap.
- Fields: `id`, `name`, `area`, `description` (all null), `calendarId` (all 0), `attributes` (all `{}`).
  **No type/category metadata** — the platform has to classify them itself.
- ids run 3–43 with gaps (some deleted in Traccar).
- id 3 is `Garaž` (UTF-8 `ž`), the YGT depot.

## 2. Classification

| Group | Geofences | Notes |
|---|---|---|
| Home base | **Garaž** (3), **Gumruk** (21) | Ashgabat. Garaž 0.7×0.9 km; Gumruk (customs terminal) is ~0.9 km north. 56 of 92 trucks sit in Garaž right now. |
| Greenhouses | **Kaka parnik** (4), **Dushak Parnik** (42) | Only two loading sites are geofenced. |
| TM highway east | Tejen, Mary, Turkmengala, 3-ajy, Turkmenabat | Drive-through (median dwell ≤ 0.3 h). |
| TM highway west | Gokdepe, Archman, Bereket, Gyzylarbat, Balkanabat, Turkmenbashy (port), Garabogaz | Turkmenbashy/Garabogaz are long waits (~20 h). |
| Border crossings | **Farap gumruk** (TM) + **Olot gumruk** (UZ), ~2 km apart; **Turkmen-Gazak gumruk** (TM↔KZ); **Yallama** (UZ↔KZ); **Ozinki** (KZ↔RU) | Tight polygons, 1–4 km (Ozinki ~13×25 km). Best anchors in the set. |
| Foreign transit | Buhara, Samarkand, Jizzak, Tashkent, Mayskiy, Shymkent, Beyneu, Atyrau | City-sized (17–61 km across). |
| Destinations | **Food city** (Moscow, 1.1×1.5 km), Almaty (44×70 km), Tashkent, Shymkent | Only Food city is tight enough to mean "arrived at the market". |

Routes the polygons trace:

- **East (UZ/KZ):** Ashgabat → Tejen → Mary → Turkmengala → 3-ajy → Turkmenabat → Farap → Olot →
  Buhara → Samarkand → Jizzak → Tashkent → Yallama → Shymkent → Almaty
- **West (KZ/RU):** Ashgabat → Gokdepe → Archman → Bereket → Gyzylarbat → Balkanabat → Turkmenbashy →
  Garabogaz → Turkmen-Gazak → Beyneu → Atyrau → Ozinki → Moscow (Food city)

## 3. Is it live? Yes

- Traccar already computes membership: **63 of 92** current positions carry `geofenceIds`.
- **572 enter/exit events in 7 days**, from 37 of 122 devices. Traccar stores them whether or not a
  notification rule exists.
- `/api/notifications` has **one rule only** (`deviceOverspeed`, web). No geofence notification and no
  webhook → nothing is pushed. Polling is the only path that doesn't need a Traccar config change.
- Device status now: 25 online, 80 offline, 17 unknown.

## 4. Dwell times (7-day sample, small n)

| Geofence | Visits | Median h | Max h |
|---|---:|---:|---:|
| Garabogaz | 3 | 21.0 | 21.3 |
| Turkmen-Gazak gumruk | 2 | 20.4 | 20.4 |
| Turkmenbashy | 3 | 20.0 | 20.0 |
| Beyneu | 1 | 19.5 | 19.5 |
| Olot gumruk (UZ side) | 1 | 14.7 | 14.7 |
| Yallama | 1 | 9.2 | 9.2 |
| Farap gumruk (TM side) | 1 | 4.6 | 4.6 |
| Dushak Parnik | 5 | 4.5 | 8.9 |
| Garaž | 60 | 3.2 | 63.1 |
| Kaka parnik | 6 | 1.0 | 2.4 |
| Turkmenabat | 23 | 0.1 | 27.9 |
| Gumruk (Ashgabat) | 28 | 0.0 | 11.5 |
| Tejen / Mary / Turkmengala / 3-ajy / Gokdepe / Archman | 11–21 each | 0.0–0.3 | ≤ 1.8 |

Two classes fall out:

- **Drive-through waypoints** (median ≤ 0.3 h): useful for progress/ETA, useless as event anchors.
- **Dwell anchors** (hours to days): borders, Caspian port, greenhouses, depot. Only these are
  timestamp candidates.

The west route loses ~60 h across Turkmenbashy + Garabogaz + Turkmen-Gazak alone (n = 2–3, needs a
bigger sample).

## 5. Sample trip — 4240AHF TR060 (return leg, westbound)

| Geofence | In | Out | Stay |
|---|---|---|---|
| Yallama | 11 Sep 19:38 | 12 Sep 04:48 | 9.2 h |
| Samarkand | 12 Sep 09:09 | 12 Sep 13:45 | 4.6 h |
| Olot gumruk | 13 Sep 08:43 | 13 Sep 23:27 | 14.7 h |
| Farap gumruk | 14 Sep 00:29 | 14 Sep 05:04 | 4.6 h |
| Mary / Tejen | 14 Sep 11:36 → 13:39 | | minutes |
| Gumruk (Ashgabat) | 14 Sep 16:52 | 15 Sep 04:19 | 11.5 h |
| Garaž | 15 Sep 07:49 | — | parked |

Times are UTC. Yallama → Garaž took 3.5 days, ~20 h of that at the TM/UZ border (Olot + Farap).

## 6. Mapping to v2 lifecycle timestamps

In v2 these timestamps are the **auto-advance triggers** (see
[shipment-lifecycle.md](obsidian/processes/shipment-lifecycle.md)). Writing one moves the status.

| Field (Sheet row) | Advances | Geofence candidate | Verdict |
|---|---|---|---|
| `loading_started_at` (R19) | → `yuklenme` | enter Kaka / Dushak parnik | **Partial.** Only 2 loading sites geofenced. |
| `departed_at` (R21) | → `yola_chykdy` | exit greenhouse / exit Garaž | **Ambiguous.** Truck can go greenhouse → depot → customs. |
| `customs_exit_at` (R25, TM customs) | → `gumruk_chykysh` | exit Gumruk | **Weak.** Gumruk median dwell 0.0 h over 28 visits (mostly drive-through). |
| `border_crossed_at` (R30) | → `serhet_gechdi` | exit Farap gumruk / exit Turkmen-Gazak gumruk | **Good.** Tight border polygons. |
| `dest_entry_at` (R31) | → `dest_entry` | enter Olot gumruk (UZ) / enter Ozinki (RU) | **Good for UZ and RU.** For KZ, Turkmen-Gazak is one polygon covering both sides. |
| `customs_entry_at` (R32, destination customs) | → `barysh_gumrugi` | — | **Gap.** Destination customs terminals aren't geofenced. |
| `arrived_at` (R35) | → `bardy` | enter Food city / destination city | **Food city yes;** city polygons too coarse (Almaty 44×70 km). |

## 7. Caveats

1. **Events have no direction.** TR060's return leg fires the same `geofenceEnter` as a loaded
   outbound truck. Any use must be gated on the linked shipment's status + time window, not on the
   geofence alone.
2. **Auto-writing advances status.** Because timestamps are v2 triggers, a wrong GPS event would push a
   shipment forward. Suggest-then-confirm is safer than silent writes.
3. **Transshipment (peregruz) breaks the link.** After cargo moves to another truck, the linked
   device no longer follows the tomatoes.
4. **Polling can miss fast waypoints.** Diffing `geofenceIds` between 120 s polls misses 0.0 h
   pass-throughs; `/api/reports/events` does not (95 KB/week for all 122 devices in one call).
5. **Coverage unknown.** In `YIGIT_PLATFROM_NEW` only 2 shipments departed in the last 7 days. Both
   auto-matched to a device (`resolve_device_for_shipment`), and 1 of the 2 devices recorded geofence events.
   Too small to judge; re-measure in season.
6. Token is still the Traccar admin's (already a known deferred item).

## 8. Options (cheapest first)

> **Built 2026-09-18 (option A, as its own endpoint):** `GET /api/v1/transport/geofences/current/` —
> trucks grouped by current geofence. See [fleet-map.md](obsidian/processes/fleet-map.md).

| | What | Cost |
|---|---|---|
| A | **"Where is it now"**: store `geofenceIds` on `DevicePosition`, cache `/api/geofences` names → show "at Olot gumruk · 6 h" on the fleet map / Sheet. | Small. Reuses the 120 s poller + 1 extra call. |
| B | **Border-wait KPI**: daily pull of `/reports/events` → `GeofenceVisit(device, geofence, enter, exit)` table → dwell per crossing per week. | Medium. New model + Celery beat task + dashboard widget. |
| C | **Timestamp suggestions**: for GPS-linked shipments, propose `border_crossed_at` / `dest_entry_at` / `arrived_at` from events; operator accepts on the Sheet. | Medium-large. Needs B's event store + a `geofence_id → role` mapping table. |
| D | **Stuck alerts**: truck inside a border geofence > N hours → notification. | Small once B exists. |

## 9. Open questions

1. What is **3-ajy** (38.08, 62.79 — between Turkmengala and Turkmenabat)?
2. **Mayskiy** (41.51, 69.43, north of Tashkent) and **Food city** (Moscow) — customer markets?
3. Which greenhouses do trucks actually load at? Only Kaka and Dushak are geofenced.
4. Worth adding polygons for destination customs terminals (Tashkent, Almaty, Moscow) in Traccar?
5. For option C — auto-write or suggest-then-confirm?
