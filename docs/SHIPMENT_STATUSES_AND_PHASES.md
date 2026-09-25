# Статусы отправки и фазы board

Снимок на 2026-09-24. Источники: таблица `core_shipment_status_types` (живая БД) и
`backend/apps/export/services/phases.py`.

У отправки **одна** машина состояний — 17 статусов. Board, задачи и KPI показывают
не статусы, а **фазы** — группы статусов. Кроме того, в БД у каждого статуса есть своё
поле `phase` с другими значениями. Итого три слоя:

1. **Статус** (`status.code`) — реальное состояние, меняется только через `transition_to()`.
2. **Фаза в БД** (`ShipmentStatusType.phase`) — DRAFT / LOADING / CUSTOMS / … ; по ней работает фильтр списка `?phase=`.
3. **Фаза board** (`phases.py` → `PHASE_MAP`) — PLAN / PREP / DOCS / LOAD / TRANSIT / DEST / CLOSE; колонки канбана, задачи, KPI.

## 1. Все статусы (живая БД)

| Шаг | Код | Название (RU) | EN | Фаза в БД | Роль | Активен |
|---|---|---|---|---|---|---|
| 0 | `draft` | Черновик | Draft | DRAFT | warehouse_chief | да |
| 1 | `yuklenme` | Загрузка | Loading | LOADING | warehouse_chief | да |
| 2 | `gumruk_girish` | Таможня вход | Customs Entry | CUSTOMS | document_team | да |
| 3 | `gumruk_chykysh` | Таможня выход | Customs Exit | CUSTOMS | document_team | да |
| 4 | `yola_chykdy` | Выехал | Departed | TRANSIT | transport | да |
| 5 | `serhet_tm` | Граница ТМ | TM Border | BORDER | transport | **нет** |
| 6 | `serhet_gechdi` | Пересёк границу | Border Crossed | BORDER | transport | да |
| 6 | `dest_entry` | Въезд в страну назначения | Destination Entry | BORDER | sales_rep | да |
| 7 | `barysh_gumrugi` | Таможня назначения | Dest Customs | BORDER | sales_rep | да |
| 8 | `yolda` | В пути | In Transit | TRANSIT | sales_rep | **нет** |
| 8 | `transshipment` | Перегрузка | Transshipment | SALES | sales_rep | да |
| 9 | `bardy` | Прибыл | Arrived | SALES | sales_rep | да |
| 10 | `satylyar` | Продаётся | Being Sold | SALES | sales_rep | да |
| 11 | `satyldy` | Продан | Sold | SALES | sales_rep | да |
| 12 | `hasabat` | Отчёт | Report | COMPLETE | sales_rep | **нет** |
| 13 | `tamamlandy` | Завершено | Completed | COMPLETE | finansist | да |
| 99 | `cancelled` | Отменён | Cancelled | CANCELLED | — | да |

Активных — 14, выключенных — 3. Номера шагов 6 и 8 заняты дважды.

## 2. Фазы board (`phases.py`)

Порядок колонок (`PHASE_ORDER`): **PLAN → PREP → DOCS → LOAD → TRANSIT → DEST → CLOSE**.

| Фаза board | Статусы |
|---|---|
| PLAN | — (виртуальная колонка, заглушка под будущие заявки) |
| PREP | `draft` |
| DOCS | `gumruk_girish`, `gumruk_chykysh` |
| LOAD | `yuklenme` |
| TRANSIT | `yola_chykdy`, `serhet_tm`, `serhet_gechdi`, `barysh_gumrugi`, `yolda` |
| DEST | `bardy`, `satylyar`, `satyldy`, `hasabat` |
| CLOSE | `tamamlandy` |

DOCS стоит **перед** LOAD намеренно: документы готовят ещё в черновике, до загрузки.
Порядок колонок ≠ порядок статусов.

## 3. Известная проблема

`dest_entry`, `transshipment` и `cancelled` **нет** в `PHASE_MAP`. `get_phase()` для
неизвестного кода возвращает `CLOSE`, поэтому отправка на въезде в страну назначения
или на перегрузке показывается на board как **завершённая**. Не исправлено.
