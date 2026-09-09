# Sheet: сквозной прогон жизненного цикла (Playwright), 2026-09-08/09

> Русская версия. Оригинал: [SHEET_LIFECYCLE_E2E_2026-09-08.md](SHEET_LIFECYCLE_E2E_2026-09-08.md)

Прогон на боевой БД `YIGIT_PLATFROM_NEW` @ `10.10.11.233\YIGIT` через `localhost:3000`.
Объём согласован с пользователем: полный проход из 12 шагов, на каждом шаге — реальная
учётная запись соответствующей роли.

**Объект:** отгрузка **714 / `0809002/26`**, экспортный код `08|SP|999|A|26|02` — дошла до
`tamamlandy` (шаг 12). Черновик поставки **713 / `0809001/26`** физически удалён операцией
Join. Помечена порядковым номером `999`, чтобы её легко было найти.

**Изменение справочных данных, сделанное и откатанное:** `Customer "Begjan".sales_rep`
был выставлен на пользователя 4 на время шагов 5–11, затем восстановлен в `NULL`. Проверено.

---

## 1. Результат по каждому этапу

| Этап | Поле(я) | Использованная роль | Результат |
|------|---------|---------------------|-----------|
| Этап 0, поставка | export_code, block_sources, вес к погрузке, harvest_status, harvest_date | `t_loading_dept_head` | ✅ все 5 сохранены |
| Этап 0, назначение | country, customer, import_firm | `t_export_manager` | ✅ шлюз 1 |
| Join | поставка → назначение | `t_export_manager` | ✅ объединено, 713 удалена — **но 3 поля потеряны, см. F25** |
| Шлюз 2 | firm_splits = YIGIT HJ | `t_document_team` | ✅ |
| Шлюз 3 | truck_plate, driver_name, driver_phone | `transport` | ✅ |
| Шлюз 4 | documents_status = ready | `t_document_team` | ✅ **автопереход draft → gumruk_girish** |
| 1 → 2 | customs_exit_at | `t_document_team` | ✅ gumruk_chykysh |
| 2 → 3 | loading_started_at | `t_loading_dept_head` | ✅ yuklenme |
| 3 | loading_ended_at, weight_net, variety | `t_loading_dept_head` | ✅ сохранено |
| 3 → 4 | departed_at | `transport` | ✅ yola_chykdy |
| 4 → 5 | border_crossed_at | `transport` | ✅ serhet_gechdi |
| 5 → 6 | dest_entry_at | `sales_rep` | ✅ dest_entry |
| 6 → 7 | customs_entry_at | `sales_rep` | ✅ barysh_gumrugi |
| 7 → 8 | has_peregruz + peregruz_date | `sales_rep` | ⚠️ ячейка сохраняется, но перехода не запускает — **F29** |
| 7 → 9 | arrived_at | `sales_rep` | ✅ barysh_gumrugi → transshipment → bardy (каскад, одно сохранение) |
| 9 → 10 | city, sale_started_at | `sales_rep` | ✅ satylyar |
| 10 → 11 | sale_ended_at | `sales_rep` | ✅ satyldy |
| 11 → 12 | sales_report_date | `sales_rep` | ⚠️ ячейка сохраняется, но перехода не запускает — **F30** |
| 11 → 12 | прикреплён отчёт о продажах | `sales_rep` (не finansist — **F31**) | ✅ tamamlandy |

**Все переходы цепочки сработали** — в `ShipmentStatusLog` отгрузки 714 записаны все
двенадцать, `is_auto=True`, `draft → … → tamamlandy` без пропусков.

Не сработало другое, и это уже: **две ячейки, которые спецификация называет триггерами,
ни на что не влияют.** `peregruz_date` (F29) и `sales_report_date` (F30) сохраняются, но их
не потребляет ни одна задача, поэтому статус они не двигают. Цепочка прошла эти места
другим путём — через `arrived_at` и через прикреплённый отчёт о продажах.

---

## 2. Находки

### F24 — подписи строк Sheet игнорируют переключатель языка *(косметика, но видно всем)*
При переключателе в шапке на **EN** и `document.documentElement.lang === "en"` все подписи
в 3-й колонке отрисовываются **по-туркменски**. Sheet берёт `current_user_lang` из профиля
пользователя (`tk`), а не активный язык i18n:
`SheetLabelColumn.tsx:95` — `const dbLabel = setting?.labels?.[currentUserLang];`
Интерфейс, *варианты* выпадающих списков и всё остальное следуют за переключателем, поэтому
таблица получается наполовину английской, наполовину туркменской. Воспроизведено на
4 учётных записях. Возможно, так задумано; в любом случае дефект — рассогласование
с остальным интерфейсом.

### F25 — Join молча теряет три поля поставки *(потеря данных, подтверждено в коде)*
`_execute_join` (`backend/apps/export/views.py`) формирует
`update_fields = {variety_id, export_code, weight_net, updated_by_id}` — и только их. Затем
исходная строка удаляется физически. В итоге `harvest_date`, `harvest_status` и
`rejected_weight_kg` — три из пяти ячеек, которые Этап 0 требует заполнить Солтанмырату
в колонке поставки, — теряются без всякого предупреждения. Проверено на 714: все три
по-прежнему `NULL` в статусе `tamamlandy`.

### F26 — два варианта `documents_status` отображаются как «OK»; неверный останавливает машину
| код | EN | TK | как отображается |
|-----|----|----|------------------|
| `ok` | OK | **Taýýar** | `OK OK` (в колонке `icon` буквально лежит текст «OK») |
| `ready` | OK | **OK** | `OK` |

Шлюз — это `TaskRule(step=draft, completion_rule=field_equals, target_value='ready')`.
То есть вариант, который по-туркменски читается как **«Taýýar» (= Готово)**, шлюз
**не** проходит. Оператор, выбравший его, оставляет отгрузку в `draft` без какой-либо
обратной связи. Это ловушка FIELD_EQUALS. Живые цифры: `ready` 82 · `NULL` 74 · `in_progress` 9 ·
**`ok` 3**.

**Поправка (проверено 2026-09-09):** в первой редакции этого отчёта утверждалось, что эти
три отгрузки застряли *из-за* этого. Это не так. У 639 (`1206001/26`, сезон 2025-2026) нет
ни клиента, ни импортной фирмы — открыт и шлюз 1; у 702 (`2808009/26`) шлюз 1 закрыт, но
пусты водитель / телефон / номер машины, то есть открыт шлюз 3. Обе остались бы в `draft`
при любом значении `documents_status`. А 684 (`2008880/26`) стоит на `ok` и при этом уже
дошла до `gumruk_girish` — значит, продвинулась другим путём.

То есть дефект **латентный, а не блокирующий прямо сейчас**: как только остальные шлюзы
будут заполнены, тот, кто выбрал туркменское «Taýýar», молча не поедет дальше. В коде на
эти значения ссылок нет — `'ok'` и `'ready'` не встречаются в `backend/apps` нигде, кроме
строки `TaskRule`, поэтому неоднозначность правится чисто данными.

### F27 — пустые подписи в `SheetRowSetting`
`firm_contracts` (R47) — пусто **и** в EN, **и** в TK. `packing` (R48) — пусто всё:
владелец, EN и TK. `rejected_weight_kg` (R36) — пусто в EN (в TK «Ýüküň agramy», а не
«Ýüklemeli tonna», как ожидает спецификация).

### F28 — `sales_rep` видит 0 отгрузок в Sheet *(пробел в данных, блокирует 7 из 12 шагов)*
`views.py:1401`: `if role == 'sales_rep': qs = qs.filter(customer__sales_rep=request.user)`.
В боевых данных **у 7 из 8 клиентов `sales_rep = NULL`**; назначен только клиент «Arap», и то
на пользователя `begjan`. Поэтому практически для любой реальной отгрузки Sheet у любого
торгового представителя пуст, и шаги 5–11 не может выполнить роль, которой они принадлежат.
`/shipments/` возвращает тому же пользователю 16 строк — пуст только `/shipments/sheet/`.
Само ограничение сделано намеренно; отсутствующие назначения — нет.

### F29 — ячейка «Перегруз» ни на что не влияет после входа в шаг *(понижена в приоритете)*
Оба правила задач существуют и корректны — `tasks.trigger_transshipment`
(`has_peregruz == 'True'` → `peregruz_date`) и `tasks.trigger_arrival_direct`
(`has_peregruz == 'False'` → `arrived_at`). Условие вычисляется **в момент входа в шаг**,
поэтому при входе в `barysh_gumrugi` с ещё выключенным `has_peregruz` создалась только
`trigger_arrival_direct`. Переключение Peregruz = Yes и заполнение Peregruz wagty после
этого ничего не двигают: задача, которая потребляла бы `peregruz_date`, просто не была
создана. Ручного обхода у `sales_rep` тоже нет — `/export/shipments/<id>` для этой роли
редиректит на `/`.

**Поправка (проверено 2026-09-09):** в первой редакции отчёта утверждалось, что заполнение
«Прибытие» «перебрасывает сразу в `bardy`, полностью минуя `transshipment`». Это неверно.
`ShipmentStatusLog` для 714 содержит `barysh_gumrugi → transshipment → bardy` (записи 598,
599, 600), все с `is_auto=True`. `_resolve_next_status` предикат учитывает и выбрал
`transshipment` правильно; дальше каскад прошёл через него в том же сохранении, потому что
его собственный триггер (`arrived_at`) был удовлетворён этой же записью. Ничего не
пропущено, журнал аудита полный.

То есть реальный дефект узкий: **условная задача не пересоздаётся, когда её условие
меняется уже после входа в шаг**, из-за чего `peregruz_date` — поле, которое система
никогда ни у кого не запрашивает. Отгрузка при этом корректно проходит весь цикл.
Приоритет соответственно с HIGH понижен до LOW. Починка — перегенерировать задачи текущего
шага при изменении значения `condition_field` (`has_peregruz`, `is_gapy_satys` — остальные
условные правила используют тот же механизм и подвержены тому же).

### F30 — шаг 11 в том виде, как описан, не выполняет переход
TaskRule для `satyldy` смотрит на `sales_report` (прикреплённый отчёт), а **не** на
`sales_report_date`. Заполнение «Дата отчёта» (R43) сохраняется, но перехода не запускает.
Шаги 11 и 12 фактически являются одним шагом: прикрепить отчёт.

### F31 — `t_finansist` не может завершить жизненный цикл, которым владеет
И спецификация, и `ROLE_PROCESS_TEST_PLAN` отдают `satyldy → tamamlandy` роли `finansist`.
У `t_finansist` нет пункта меню «Sales Reports», а `/export/sales-reports/…` и
`/export/shipments/<id>` оба редиректят на `/`. Финальный шаг пришлось выполнять от
`sales_rep`.

### F32 — расхождения по владельцу между тремя источниками
`departed_at` (R21): спецификация — transport (Mergen) · TaskRule — `document_team` ·
`SheetRowSetting.who` — «Soltanmyrad». `firm_contracts` (R47): спецификация — Gadam,
настройка строки — «Shohrat». `vehicle_condition` (R3): значение по умолчанию в i18n —
«Logist», настройка строки — «Transport». Опечатка «Soltanmyra**d**» вместо
«Soltanmyra**t**» в R21 и R36.

### F33 — ячейки Sheet под «примороженной» шапкой не кликаются
Строки в `sheet-scrollable-bottom` уезжают *под* липкую зафиксированную секцию и остаются
доступными для hit-теста в DOM, пока поверх них находится замороженная строка. Клик
активирует строку, лежащую сверху. До таких ячеек весь прогон пришлось добираться
клавиатурой.

### F34 — мелочи
- 21 из 25 экспортных фирм отключены («⚠ no quota») для сезона 2026-2027 — ожидаемо по правилам квот, но выбрать можно только 4 фирмы.
- Ячейки даты/времени: если ввести значение вручную и подтвердить, штампуется *текущее* время, а введённое отбрасывается.
- Заголовки колонок в режиме Join имеют `aria-disabled="true"` (доступность).
- Sheet под ролью `loading_dept_head` дёргает `/admin/seasons/` и `/admin/firms/` → 403 по 2 раза на каждый, дважды за загрузку.
- `status_step` не отражает реальный порядок (`yuklenme` отдаёт шаг 1) — уже описано в `ROLE_PROCESS_TEST_PLAN` §1.

---

## 2b. Расхождения с присланной вами таблицей

Строки, где реально отрисовываемая подпись отличается от спецификации (побеждает то, что
отрисовывается):

| R | В спецификации | Отрисовывается (TK) |
|--:|----------------|---------------------|
| 7 | Shipment Code / **Iberiş kody** | **Ýük kody awto** (EN «Shipment Code auto»; владелец — «System», а не Soltanmyrat) |
| 9 | Export Firm / **Eksport eden Firma** | **Eksport eden Firmalar** (мн. число) |
| 15 | — | **Maşynyň ýerleşýän ýeri** (в i18n по умолчанию было «Maşynyň şuwagtky ýagdaýy») |
| 23 | Maşyn**–**Tyr belgisi | Maşyn **/** Tyr belgisi |
| 36 | Weight to load / **Ýüklemeli tonna** | EN **пусто**, TK **Ýüküň agramy**; владелец «Soltanmyra**d**» |
| 37 | Net Weight / **Arassa agramy** | Net Weight **(shipped)** / Arassa agramy **(h)** |
| 46 | **Eksport** kody | **Export** kody |
| 47 | Contracts / **Şertnamalar** | **пусто / пусто**; владелец «Shohrat», а не Gadam |
| 21 | Mergen (transport) | владелец указан как «Soltanmyra**d**» |

Всё остальное в вашей таблице совпало. R47 действительно содержит две строки, как вы
и указали (`firm_contracts` + `is_gapy_satys`), а R16 отсутствует намеренно.

---

## 2c. Что этот прогон оставил в боевых данных

- Отгрузка **714** — полноценная реальная строка в статусе `tamamlandy`, сезон 2026-2027.
- Её **18 100 кг по блоку A** теперь попадают в факт недельного плана за неделю
  2026-09-08 как *экспортированные*.
- У неё `has_peregruz = true`, и **`transshipment` в журнале статусов записан**
  (записи 598→599→600) — то есть это обычная завершённая строка, а не невозможное состояние.
- `harvest_date`, `harvest_status`, `rejected_weight_kg` навсегда остались `NULL` (F25).
- Создан `SalesReport`: 1 строка, `quantity_kg` 18 100, `price_local` 1.20,
  `amount_local` / `total_sales_local` / `net_income_local` 21 720 KZT, расходы 0,
  `product_name` NULL. Значения проверены после сохранения — ничего не попало в колонки
  маржи или расходов.
- Записи аудита, ~16 задач (Tasks) и уведомления по всем 12 шагам.
- Черновик поставки **713** удалён (физически, операцией Join — так и задумано).

Скажите — отменю (cancel) или отправлю в архив.

---

## 3. Все строки: владелец и подпись 3-й колонки (EN / TK)

Источник истины — `SheetRowSetting` (БД), который **переопределяет** ключи i18n из
`sheet_rows.py`. `pos` — порядок отображения; `R` — тот `row_number`, которым оперирует
спецификация. Строка 16 отсутствует намеренно. R47 действительно содержит две строки
(`firm_contracts`, `is_gapy_satys`).

Подписи ниже приведены дословно как в БД — EN и TK это данные, а не перевод.

| pos | R | field_key | Владелец (кол. 2) | Подпись EN (кол. 3) | Подпись TK (кол. 3) |
|----:|--:|-----------|-------------------|---------------------|---------------------|
| 1 | 3 | `vehicle_condition` | Transport | Truck Status | Maşynyň ýagdaýy |
| 3 | 6 | `documents_status` | Sirin | Documents (13:00) | Resminamalar (13:00) |
| 4 | 5 | `export_manager_note` | Gadam J | Gadam's note | Gadam J belligi |
| 5 | 4 | `transport_docs_given_at` | Sirin | Transport dept documents | Transport bölümiň resminamalary |
| 6 | 7 | `shipment_code` | System | Shipment Code auto | Ýük kody awto |
| 7 | 8 | `block_sources` | Soltanmyrat | Harvest Block | Ýygylan bölümi |
| 8 | 9 | `firm_splits` | Sulgun | Export Firm | Eksport eden Firmalar |
| 9 | 10 | `country` | Gadam J | Destination Country | Eksport ýurdy |
| 10 | 11 | `customer` | Gadam J | Customer | Müşderi |
| 11 | 12 | `city` | Arap | Destination City | Şäheri |
| 12 | 13 | `import_firm` | Gadam J | Import Firm | Import Firma |
| 13 | 14 | `harvest_status` | Soltanmyrat | Harvest Status | Ýygym ýagdaýy |
| 14 | 15 | `vehicle_live_status` | Haltac | Vehicle Current Position / ETA | Maşynyň ýerleşýän ýeri |
| 17 | 19 | `loading_started_at` | Soltanmyrat | Loading Start | Ýükleme başlady |
| 18 | 20 | `loading_ended_at` | Soltanmyrat | Loading End | Ýükleme gutardy |
| 19 | 17 | `warehouse_note` | Soltanmyrat | Notes (Soltanmyrat) | Bellikler (Soltanmyrat) |
| 20 | 21 | `departed_at` | Soltanmyrad | Greenhouse Departure | Ýyladyşhanadan çykdy |
| 21 | 18 | `document_note` | Sirin | Notes (Şirin) | Bellikler (Şirin) |
| 22 | 22 | `vehicle_responsible` | Transport | Vehicle Responsible | Jogapkär adam |
| 23 | 23 | `truck_plate` | Transport | Truck / Trailer Plate | Maşyn / Tyr belgisi |
| 24 | 24 | `has_doc_advance` | Babageldi | Doc Advance Issued | Resminama puly berildi |
| 25 | 25 | `customs_exit_at` | Sirin | TM Export Customs Done | TM eksport gümrük gutardy |
| 26 | 26 | `transit_days_temp` | Transport | Transit Days & Temp | Ýol güni we temp. |
| 27 | 27 | `driver_name` | Transport | Driver Name | Sürüjiniň ady |
| 28 | 28 | `driver_phone` | Transport | Driver Phone | Sürüji telefony |
| 29 | 29 | `border_point` | Transport | Border Point | Serhet nokady |
| 30 | 30 | `border_crossed_at` | Haltac | TM Border Exit | TM serhedinden çykdy |
| 31 | 31 | `dest_entry_at` | Arap | Destination Entry | Barmaly ýurda girdi |
| 32 | 32 | `customs_entry_at` | Arap | Destination Customs | Baryş gümrügi |
| 33 | 33 | `has_peregruz` | Arap | Transshipment | Peregruz |
| 34 | 34 | `peregruz_date` | Arap | Transshipment Time | Peregruz wagty |
| 35 | 35 | `arrived_at` | Arap | Arrival | Baryp ýetdi |
| 36 | 45 | `customs_clearance_planned_day` | Sirin | Planned customs day | Plan boýunça gümrükleme güni |
| 37 | 36 | `rejected_weight_kg` | Soltanmyrad | **(пусто)** | Ýüküň agramy |
| 38 | 37 | `weight_net` | Soltanmyrat | Net Weight (shipped) | Arassa agramy (h) |
| 39 | 38 | `variety` | Soltanmyrat | Tomato Variety | Pomidoryň görnüşi |
| 40 | 39 | `harvest_date` | Soltanmyrat | Harvest Date | Ýygylan senesi |
| 41 | 41 | `sale_started_at` | Arap | Sale Start | Satylyp başlady |
| 42 | 47 | `is_gapy_satys` | Gadam J | Type | Görnüşi |
| 43 | 42 | `sale_ended_at` | Arap | Sale End | Satylyp gutardy |
| 44 | 46 | `export_code` | Soltanmyrat | Export Code | Export kody |
| 46 | 44 | `additional_notes_arap` | Arap | Notes (Arap) | Bellik (Arap) |
| 47 | 47 | `firm_contracts` | Shohrat | **(пусто)** | **(пусто)** |
| 48 | 48 | `packing` | **(пусто)** | **(пусто)** | **(пусто)** |
| 49 | 43 | `sales_report_date` | Aganazar | Report Date | Hasabat senesi |
