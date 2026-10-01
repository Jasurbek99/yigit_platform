# Детали отгрузки: всё из Sheet + три части — design

**Date:** 2026-09-30
**Status:** design approved in chat 2026-09-30, awaiting spec review
**Builds on:** `docs/SHIPMENT_THREE_PARTS_RU.md`, `2026-09-29-packaging-join-board-design.md`,
`2026-09-29-transport-trips-design.md`, `2026-07-20-shipment-detail-redesign-design.md` (current layout)

## Problem

`/shipments/:id` (`pages/export/ShipmentDetail.tsx`) отстал от Sheet и от модели трёх частей:

1. ~15 строк Sheet не показаны на детали, хотя detail API их уже отдаёт (заметки, часть таймстемпов,
   peregruz, `harvest_date`, `sales_report_date`, `vehicle_live_status`, `transport_docs_given_at`).
   Ещё 6 полей detail API не отдаёт вовсе.
2. Строка «дата урожая» на детали рендерит `shipment.date`, а не `harvest_date` (`ShipmentGoodsBody.tsx:131`).
3. **Транспортная часть:** есть только баннер рейса. Выбрать или отвязать рейс Planning нельзя.
   Для обычной отгрузки без рейса показан TIR-селектор тягача/прицепа — это противоречит D9/D10
   спека рейсов (обычная машина приходит только из Planning).
4. **Упаковочная часть:** есть только Join (пока у строки нет блоков). Отсоединить (unjoin) и
   обменять (swap) нельзя.
5. **Экспортная часть:** нет панели брутто/нетто (шаблон упаковки → CMR) и нет контрактов по фирмам.
   Колонка «инвойс» читает устаревший `ShipmentFirmSplit.invoice_number`.
6. **Брутто/коробки/паллеты на детали вводят в заблуждение.** CMR берёт значения шаблона упаковки
   первыми (`contracts/services/document_context.py:497-505`), а поля шипмента — только как запасной
   вариант. После применения шаблона правка на детали молча игнорируется документами.
7. `completeness.missing_fields` (из `TaskRule.target_fields`) содержит ключи, которых на детали нет
   (`packing_template`, `shelf_life_days`, `loading_ended_at`, `departed_at`, …), поэтому
   `jumpToField` прыгать некуда.

## Decisions taken

| Вопрос | Ответ |
|---|---|
| Объём | Всё сразу: поля Sheet, панели, выбор частей, бэкенд |
| Выбор транспорта/упаковки | **Прямо на детали**, модалками (как уже работает Join supply) |
| Старые поля брутто / packaging_kg / коробки / паллеты | **Убрать с детали всегда.** Единственный источник — панель упаковки. Поля остаются в БД и API (CMR-фолбэк для старых отгрузок) |
| TIR-селектор | Только для gapy. Для обычной отгрузки — выбор рейса Planning |
| Sheet | Не меняется (конфликт TIR-попапа на Sheet — отдельная задача) |
| Права | Те же гейты, что на досках и в Sheet; бэкенд уже их проверяет |

## Design

Карточки остаются те же (`ShipmentDetailStageCards`). Меняется их содержимое.

### 1. Транспортная часть — карточка Transit (`ShipmentTransportBody`)

**Выбор рейса (не gapy):**
- Нет рейса → кнопка «Выбрать рейс» открывает новую `TripPickerModal`:
  - список свободных рейсов `useExternalTrips({ free: true })`;
  - рейсы, у которых страна не совпадает со страной отгрузки, помечены и недоступны
    (та же логика, что `TruckMatchPanel`);
  - рейс без страны → подтверждение и `confirm_unknown_country: true`;
  - «Привязать» → `useAssignTrip({ tripId, shipmentId })`.
- Рейс есть → в `ShipmentTripBanner` кнопка «Отвязать» → `Modal.confirm` → `useUnassignTrip({ tripId })`.
- Кнопки видны, только если `canDo(user, 'shipment_assign', 'edit')` **и** есть страница
  `export.truck_board` (без неё `GET /transport/external-trips/` отдаёт 403). Иначе — только баннер.
- «Выбрать рейс» неактивна, пока у отгрузки нет страны (`country_code` уже есть в detail API).
- Баннер + кнопка обёрнуты в `id="detail-field-trip_id"` (цель задачи `choose_truck`).
- TIR-селектор тягача/прицепа/водителя для обычной отгрузки убирается. Для gapy всё как сейчас.
  Если у обычной отгрузки без рейса уже стоят старые `truck_plate` / `driver_name` (до рейсов
  Planning), они показываются только для чтения — карточка не пустеет.

**Новые строки (`DetailFieldRow`, автосейв PATCH):**
- `vehicle_live_status`, `transport_docs_given_at`, `shelf_life_days`;
- второй тягач/водитель: `truck_plate_2`, `driver_2_name`, `driver_2_phone` (только чтение, если рейс
  привязан — как остальные поля рейса);
- таймстемпы: `departed_at`, `greenhouse_arrived_at`, `dest_entry_at`;
- peregruz: `has_peregruz`, `peregruz_date`, `peregruz_city`;
- `border_crossed_at`, `arrived_at` из только-чтения становятся редактируемыми (AD-1 для них снят,
  они в `_ALL_PATCHABLE_FIELDS`).

### 2. Упаковочная часть — карточка Loading (`ShipmentGoodsBody`)

- **Отсоединить**: кнопка, если у строки есть блоки, заданы `country` и `customer` (иначе это план
  поставки — `unjoin_packing` вернёт 400), статус pre-loading (`isPreLoading`) и `canUserJoin(user)`. `Modal.confirm` → `useUnjoinPackaging(id)` → тост с кодом нового плана поставки.
- **Обменять с…**: те же условия. Новая `SwapPackingModal`: кандидаты из `useJoinBoard()`, фильтр
  `hasPacking && id !== current`, проверка `explainSwapBlockers([current, other])`, подтверждение →
  `useSwapPackaging({ aId, otherId })`.
- Join supply остаётся в Hero, как сейчас.
- **Дата урожая.** `shipment.date` — дата отгрузки, это другое поле. Строка показывает то же, что
  Sheet R39: `block_sources[].harvest_date` (по блокам), иначе `Shipment.harvest_date`.
  Редактирование — PATCH `harvest_date` только когда у блоков нет своих дат; иначе только чтение
  (двухшаговую запись PATCH+POST как в Sheet сюда не переносим).
- **Удалить строки:** `weight_gross`, `packaging_kg`, `pallet_count`, `box_count` — **только в
  `ShipmentGoodsBody`** (список исключений). Общий `EDIT_FIELD_GROUPS` не трогаем: его читает
  `ShipmentEditDrawer`. Эти поля по-прежнему пишут drawer и паллетный манифест (`usePallets`),
  так что у отгрузки без фирм или без подходящего шаблона путь к брутто остаётся.
  Остаются `weight_net`, `weight_to_load_kg`.
- `loading_started_at` (переезжает сюда из Documents) и `loading_ended_at` — редактируемые строки «Начало/Конец погрузки».

### 3. Экспортная часть — карточки Destination + Documents

- **Панель упаковки** `ShipmentPackingPanel` (из `components/sheet/`, принимает только `shipmentId`)
  в карточке Documents. Обёртка с `id="detail-field-packing_template"` для `jumpToField`.
  Фиксированную ширину 380px сделать гибкой через проп или обёртку, не ломая Sheet.
- **Панель контрактов** `ShipmentFirmContractsPanel` (принимает `shipmentId`) под выбором фирм в
  Destination. Даёт номер контракта, привязку, создание разового и .docx.
- Новые строки: `document_note`, «аванс выдан» = `has_current_advance` (только чтение). `sales_report_date` — в карточке Sale рядом с отчётом.
- `customs_exit_at`, `customs_entry_at`, `sale_started_at`, `sale_ended_at` становятся редактируемыми.

### 3a. Документы для печати — новая карточка (добавлено 2026-09-30 по запросу)

Все документы отгрузки видны и печатаются прямо на детали, без перехода на `/contracts/documents`.
- Новая карточка `ShipmentDocumentsPrintCard` между стадийными карточками и Sale.
- Внутри — тот же `DocumentPacketPanel`, что в строке страницы Documents: баннер «что ещё
  заполнить», ZIP пакета, CMR, TIR-карнет, по каждой фирме — инвойс/письма (или «привязать контракт»).
- Данные: существующий `useShipmentDocumentPacket(shipmentId)` (`GET /contracts/document-packets/?shipment=`).
  Новых эндпоинтов нет.
- Эндпоинт закрыт ресурсом `sale` → карточка видна только при `canDo(user, 'sale', 'view')`.
- Нет ни одной экспортной фирмы → пакета нет → «Документы появятся после выбора экспортной фирмы».

### 4. Заметки — карточка Notes

- `export_manager_note`, `warehouse_note`, `additional_notes_arap` — редактируемые текстовые строки.
- Кастомные строки админа: список `custom_fields` из detail API. Запись через существующий
  `PATCH /export/shipments/{id}/custom-fields/` (`{ field_key, value }`).

### 5. Конфиг полей и completeness

- Новые строки описываются в новом `DETAIL_EXTRA_FIELDS` в `constants/shipmentEditConfig.ts`, а не в
  `EDIT_FIELD_GROUPS` — drawer не меняется.
- `EDITABLE_FIELD_KEYS` (`ShipmentCompletenessBar.helpers.ts`) = `EDIT_FIELD_GROUPS` ∪ `DETAIL_EXTRA_FIELDS`,
  чтобы новые ключи стали кликабельными чипами.
- `SECTION_ANCHOR_BY_KEY` дополняется ключами без своей строки (см. таблицу ниже).

Каждый ключ `target_fields` из `seed_task_rules.py` → куда ведёт чип на детали:

| Ключ задачи | Элемент на детали | Сейчас |
|---|---|---|
| `country`, `customer`, `import_firm`, `city` | `#detail-field-<key>` (Destination) | есть |
| `firm_splits`, `sales_report`, `sales_report.approved_at` | `#section-sale` | `sales_report.approved_at` — добавить в anchors |
| `block_sources` | `#section-block-sources` | есть |
| `trip_id` | `#detail-field-trip_id` (обёртка баннера/кнопки) | **нет** |
| `driver_name`, `driver_phone`, `truck_plate` | `#detail-field-<key>` | есть (gapy); для обычной — строки только-чтения из п.1 |
| `border_point`, `documents_status`, `variety`, `weight_net` | `#detail-field-<key>` | есть |
| `packing_template` | `#detail-field-packing_template` (обёртка панели) | **нет** |
| `has_current_advance` | `#detail-field-has_current_advance` (строка «аванс выдан») | **нет** |
| `transit_days`, `transport_temp_c` | `#detail-field-<key>` | есть |
| `shelf_life_days` | `#detail-field-shelf_life_days` | **нет** |
| `loading_started_at`, `customs_exit_at`, `border_crossed_at`, `customs_entry_at`, `arrived_at`, `sale_started_at`, `sale_ended_at` | `#detail-field-<key>` | были только-чтение → строки |
| `loading_ended_at`, `departed_at`, `dest_entry_at`, `has_peregruz`, `peregruz_date` | `#detail-field-<key>` | **нет** |
| `shipment_code` | Hero, заполняется системой | без якоря — допустимо |

### 6. Бэкенд — `ShipmentDetailSerializer`

Добавить в detail (не в list — Sheet и список не трогаем):

| Поле | Источник |
|---|---|
| `greenhouse_arrived_at`, `pallet_weight_kg`, `shelf_life_days` | поля модели |
| `packing_template`, `packing_template_name` | как в `ShipmentSheetSerializer` (`serializers.py:689`) |
| `truck_head_2_id`, `driver_2_id` | поля модели |
| `has_current_advance` | свойство модели (`models/shipment.py:425`) — цель задачи `give_advance`; учитывает откат после смены машины. `views.py` не трогаем |
| `custom_fields` | список `{ field_key, label, value }`: все `SheetRowSetting(is_custom=True, deleted_at IS NULL, is_visible=True)` + `ShipmentCustomFieldValue.value_text` этой отгрузки (`null`, если значения нет) |

Точные имена полей сверить со скиллом `api-contract` на этапе плана. Никаких новых эндпоинтов.

## Права

Бэкенд уже проверяет всё: `CanViewTruckBoard` + `CanAssignTrips` для рейсов, `JOIN_ROLES` +
`loading_dept_head(_deputy)` для unjoin/swap, `DynamicResourcePermission` и field-checks для PATCH.
Фронт только прячет кнопки по тем же гейтам. Новые поля идут через `DetailFieldRow`. Права на
отдельное поле он **не** проверяет: страница передаёт только общий `readOnly` (права страницы +
открытый сезон). Роль без права на поле увидит строку редактируемой и получит тост с ошибкой, когда
бэкенд откажет в PATCH. Так было и раньше, но строк, где это возможно, стало примерно вдвое больше.
Цепочку прав Sheet не трогаем.

## Testing

- **Бэкенд:** тест `ShipmentDetailSerializer` — новые поля присутствуют; `has_current_advance`
  true/false; `custom_fields` отдаёт определение без значения как `null`.
- **Фронт (vitest):**
  - Transport: без рейса и с правами — кнопка «Выбрать рейс»; без прав — нет; с рейсом — «Отвязать»;
    для gapy — TIR-селектор, для обычной — нет.
  - `TripPickerModal`: рейс с другой страной недоступен; рейс без страны → confirm-флаг.
  - Loading: «Отсоединить» и «Обменять» только pre-loading + с блоками + `canUserJoin`;
    `SwapPackingModal` исключает текущую строку и строки без упаковки; строк gross/packaging/
    pallet/box нет; `harvest_date` показывает `harvest_date`, а не `date`.
  - Documents: панель упаковки и панель контрактов рендерятся.
- **Критерий готовности (тест):** для каждого ключа из таблицы §5 рендер детали содержит
  `#detail-field-<key>` или id из `SECTION_ANCHOR_BY_KEY` (исключение — `shipment_code`).
  Рендерить две фикстуры: обычная (с `trip_id`) и gapy (паспорта, TIR). Сегодня тест красный.
- **Права:** 2–3 роли (export_manager, loading_dept_head, transport-роль) — проверить, что новые
  строки корректно только-чтение / редактируемые. Поля, которые Sheet пишет через делегаты
  (`truck_plate_2`, `driver_2_*`, `peregruz_city`), могут не иметь своего гранта — проверить отдельно.
  Прогнать `TestEveryRoleCanEditItsOwnSheetRow`, чтобы убедиться, что ничего не сдвинулось.
- Прогон: `npx tsc --noEmit --ignoreDeprecations 5.0`, vitest по `components/shipment`, backend
  `apps.export` (с приватным TEST NAME — другие сессии гоняют тесты параллельно).

## Docs

- Переписать `docs/obsidian/processes/detail-vs-sheet.md` (устарел: URL, MyTaskCard, «пять секций»).
- CHANGELOG + `BUILD_TEST_LOG.md`.

## Parallel sessions

`useDrafts.ts`, `types/index.ts`, `pages/export/assignment/*`, `i18n/*.json` сейчас
изменены другой сессией и не закоммичены.
- `useDrafts.ts`, `useExternalTrips.ts`, `joinHelpers.ts` — только импорт, не править.
- `types/index.ts` (`IShipmentDetail`) и `i18n/*.json` — править только своими хунками, коммитить
  через приватный `GIT_INDEX_FILE` (см. память «Shared Worktree Sessions»).

## Out of scope

- Sheet: TIR-попап для обычных отгрузок, дубль `row_number` 47.
- Возврат `MyTaskCard` / `OtherTasksRow` на деталь.
- Колонка «инвойс» в `ShipmentSaleSection` (читает устаревший `ShipmentFirmSplit.invoice_number`;
  настоящий номер теперь видно в панели контрактов) — остаётся как есть.
- Редактирование `block_sources` и `export_code` на детали (меняются через Join/Swap и Sheet).
- Удаление полей `weight_gross` / `packaging_kg` / `box_count` / `pallet_count` из модели.
