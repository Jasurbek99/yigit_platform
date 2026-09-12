# Вес в Sheet: БД → Django → API → UI

Дата: 2026-09-12. Подписи строк и позиции сверены с живой БД (`export_sheet_row_setting`),
а не с файлами переводов.

Источники: `backend/apps/export/sheet_rows.py`, `models/shipment.py`, `models/packing_template.py`,
`models/quota.py`, `apps/contracts/views.py` (ShipmentPackingView),
`frontend/src/components/sheet/{SheetCell.tsx,getCellValue.ts,SheetLabelColumn.tsx,ShipmentPackingPanel.tsx}`.

---

## 0. Две нумерации строк, не путать

| | `row_number` | `global_position` |
|---|---|---|
| Что это | исходный номер строки в Excel, заморожен | сквозной ранг строки в текущем порядке админки |
| Где хранится | `SheetRowSetting.row_number` | не хранится, считается на лету (`views.py:1676`) |
| Где видно | только в тулбаре Sheet, в списке скрытых строк, как «Название (R36)» | колонка `#` слева в Sheet (`SheetLabelColumn.tsx:199`) |
| Меняется ли | никогда | только когда админ меняет порядок в Shipment Settings |
| Перетаскивание строк пользователем | не влияет | **не влияет**, персональный порядок на этот номер не действует |

Смысл разделения: `row_number` это постоянный идентификатор строки для кода и миграций,
`global_position` это то, чем строку называют вслух, и он совпадает с порядком строк
во вкладке Sheet Rows в админке.

Текущие позиции весовых строк в живой БД:

| В колонке `#` | R-номер | field_key | Подпись RU в БД |
|---|---|---|---|
| 7 | R8 | `block_sources` | Блок сбора |
| 8 | R9 | `firm_splits` | Экспортная фирма |
| 37 | R36 | `weight_to_load_kg` | **Вес к погрузке** |
| 38 | R37 | `weight_net` | Вес нетто (отпр.) |
| 48 | R48 | `packing` | **Упаковка (брутто-нетто)** |

Внимание: подпись из БД (`SheetRowSetting.label_ru/_tk/_en`) перекрывает подпись из файлов
переводов `frontend/src/i18n/*.json`. По двум строкам они расходятся:

| field_key | В БД (что видно) | В i18n-файле |
|---|---|---|
| `packing` | Упаковка (брутто-нетто) | Упаковка (гросс-нетто) |

Подписи для `weight_to_load_kg` в файлах переводов выровнены с БД 2026-09-12
(было «Тоннаж к загрузке» / `Ýüklemeli tonna`).

---

## 1. Строки Sheet, где вес виден напрямую

### Позиция 37 (R36) — «Вес к погрузке»

| Слой | Значение |
|---|---|
| Колонка БД | `export.shipments.weight_to_load_kg` |
| Django-поле | `Shipment.weight_to_load_kg`, `DecimalField(10,2)`, nullable |
| API-поле | `weight_to_load_kg` |
| Подпись | RU «Вес к погрузке», TK `Ýüküň agramy` |
| Кто пишет | Soltanmyrat (`loading_dept_head`), ввод вручную, `input_type: number` |
| Смысл | Сколько надо загрузить, неофициальный плановый вес. |

До 2026-09-12 колонка называлась `rejected_weight_kg`, легаси от «брака», хотя брак к ней
отношения не имел и живёт в `SalesReport.weight_rejected_kg`. Переименована во всех четырёх
слоях: колонка, поле Django, имя в API, `field_key`, плюс миграция данных для
`SheetRowSetting`, `AuditLog` и `RoleFieldPermission` (export 0068 и 0069).

Значение в килограммах, рендер через `toLocaleString()` (`getCellValue.ts:68`), без единиц.

### Позиция 38 (R37) — «Вес нетто (отпр.)»

| Слой | Значение |
|---|---|
| Колонка БД | `export.shipments.weight_net_kg` |
| Django-поле | `Shipment.weight_net` (`db_column='weight_net_kg'`), переименование |
| API-поле | `weight_net` |
| Подпись | RU «Вес нетто (отпр.)», TK `Arassa agramy (h)` |
| Кто пишет | Soltanmyrat вручную **или** `close_pallet_manifest()` (сумма нетто по паллетам) |
| Смысл | Реальный физический нетто-вес помидоров в машине. Ключевая строка (`style: key`). |

Отсюда же считается автораспределение по блокам и сверка в панели упаковки.

### Позиция 48 (R48) — «Упаковка (брутто-нетто)»

Синтетическая строка: колонки в БД нет, `input_type: readonly`, клик открывает
`ShipmentPackingPanel`. Сама ячейка показывает только имя шаблона
(«Упаковка выбрана: {{name}}» или «Упаковка ещё не выбрана»).

Внутри панели два блока чисел.

**a) Вся машина, печатается в CMR.** Источник `export.packing_template`
(FK `Shipment.packing_template`):

| Поле БД/API | UI | Смысл |
|---|---|---|
| `net_kg` | Нетто | официальное нетто всей машины |
| `gross_kg` | Брутто | брутто **вместе с паллетами** |
| `box_count` | Ящики | число ящиков |
| `pallet_count` | Поддоны | `Decimal(5,1)`, допускает пол-паллеты |
| `pallet_weight_kg` | Вес под. | суммарный вес поддонов |

**b) По каждой фирме, печатается в её инвойсе.** Источник `contracts.ContractSale`
(поля `gross_kg`, `box_count`, `pallet_count`, `pallet_weight_kg` = константа
`FIRM_PACKING_FIELDS`). Нетто фирмы в ContractSale не хранится: панель показывает
`weight_kg` из `ShipmentFirmSplit` как read-only подпись «Нетто: N kg».

**Проверка сходимости** (`consistent` в ответе `GET /shipments/packing/?shipment=`):
`sum(firm_splits.weight_kg) == packing_template.net_kg`. Не сходится, будет красный алерт
«Сумма по фирмам: {{total}} кг, конфигурация машины {{net}} кг».

---

## 2. Строки Sheet, где вес есть в БД, но в ячейке не показан

### Позиция 8 (R9) `firm_splits`, «Экспортная фирма»

- Таблица `export.shipment_firm_splits`, поле `weight_kg` `Decimal(10,2)`, NOT NULL.
- В ячейке рисуются **только теги с кодом фирмы** (`SheetCell.tsx:509`). Килограммов не видно.
- Смысл: **официальный** вес фирмы, тот, что идёт в документы и списывает госквоту
  (`quota_sync.py:136` → `QuotaUsageRecord.kg_used`).
- Мультиселект шлёт только id фирм, вес подставляет бэкенд. С 2026-09-12 главный источник
  это шаблон упаковки: если у рейса выбран `packing_template` и число долей совпадает с числом
  фирм, каждая фирма получает нетто своей доли по порядку. Иначе работает запасной путь,
  `TruckSplitDefault` (админка `/admin/shipment-settings`): 1 фирма → 18 100, 2 → 9 000,
  3 → 6 000 кг. Явный `weight_kg` от клиента перебивает оба.
- Docstring `TruckSplitDefault`: это потолок для документов, реальная машина везёт
  20 000–21 000 кг.

### Позиция 7 (R8) `block_sources`, «Блок сбора»

- Таблица `export.shipment_block_sources`, поле `weight_kg` `Decimal(10,2)`, nullable.
- В ячейке только теги с кодом блока (`SheetCell.tsx:535`).
- Смысл: сколько кг дал каждый блок теплицы. Но это **не измерение, а разнесение**:
  бэкенд делит `shipment.weight_net` (или 18 100, если пусто) поровну на N блоков,
  остаток округления уходит последнему. Питает `actual_value` недельного плана.

---

## 3. Поля веса у Shipment, которых в Sheet нет вообще

| Django-поле | Колонка БД | Кто пишет | Смысл |
|---|---|---|---|
| `weight_gross` | `weight_gross_kg` | только `close_pallet_manifest()` | брутто машины = сумма `gross_weight_kg` по паллетам |
| `packaging_kg` | `packaging_kg` | только API или Edit drawer | вес упаковки |
| `pallet_count` | `pallet_count` | `close_pallet_manifest()` | число паллет |
| `pallet_weight_kg` | `pallet_weight_kg` | `close_pallet_manifest()` | сумма весов поддонов |
| `box_count` | `box_count` | API или Edit drawer | число ящиков |

Строк в Sheet у них нет, но права на запись привязаны к строке `packing`,
см. `docs/obsidian/screens/shipment-sheet.md:706`. Важно: брутто, которое оператор
видит в панели упаковки, это `PackingTemplate.gross_kg` или `ContractSale.gross_kg`, а **не**
`Shipment.weight_gross`. Это разные числа в разных таблицах.

---

## 4. Первоисточник цифр, манифест паллет (отдельный экран)

`export.PalletManifestEntry`: `gross_weight_kg`, `pallet_weight_kg`, `additions_kg`,
`crate_count` + `crate_type.weight_kg`.

```
net_weight_kg = gross_weight_kg - (crate_type.weight_kg * crate_count) - pallet_weight_kg - additions_kg
```

`close_pallet_manifest()` сворачивает паллеты в `weight_gross`, `weight_net`,
`pallet_count`, `pallet_weight_kg` и проставляет сорта. Пишет `AuditLog`, статус не меняет.

---

## 5. Веса отчёта о продаже (не Sheet, но легко спутать)

| Django-поле | Колонка БД | Смысл |
|---|---|---|
| `SalesReport.weight_sold_kg` | `sold_weight_kg` | фактически продано |
| `SalesReport.weight_rejected_kg` | `weight_rejected_kg` | брак у покупателя |
| `SalesReport.weight_loaded_kg` | `weight_loaded_kg` | фактически загружено в машину |

---

## 6. Сводка переименований

| Колонка БД | Django | API |
|---|---|---|
| `weight_net_kg` | `weight_net` | `weight_net` |
| `weight_gross_kg` | `weight_gross` | `weight_gross` |
| `sold_weight_kg` | `weight_sold_kg` | `weight_sold_kg` |

---

## 7. Что чаще всего путают

1. **Официальный вес не равен реальному.** `firm_splits.weight_kg` и `PackingTemplate.net_kg`
   это документные числа с потолком 18 100 кг. `weight_net` из манифеста паллет это физика,
   20 000–21 000 кг.
2. **Ничто не сверяет `weight_net` с суммой по фирмам.** Флаг `consistent` сравнивает
   сумму фирм только с `PackingTemplate.net_kg`. Расхождение «нетто машины против суммы
   по фирмам» никем не ловится.
3. **`weight_to_load_kg` это план загрузки, а не брак.**
4. **Подписи строк берутся из БД, а не из файлов переводов**, см. раздел 0.
5. **Вес по фирмам и по блокам в Sheet не виден**, только теги. Фирменный вес смотрят
   через панель упаковки, блочный только через API или детальную карточку.
6. **Вес блока это разнесение, а не взвешивание.**
