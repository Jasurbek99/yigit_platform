# Дневные задачи по плану машин — design

**Date:** 2026-10-01
**Status:** approved in chat 2026-10-01, not built
**Builds on:** `docs/superpowers/specs/2026-09-29-planning-tasks-design.md` (задачи 4 `daily_loading`
и 5a `daily_export`), `docs/superpowers/specs/2026-09-29-packaging-join-board-design.md` (доска
`/export/assign`, присоединение упаковки).

## Problem

Владелец: «весь процесс должен идти через задачи». Сегодня обе дневные задачи закрываются
**первой же** машиной (`backend/apps/export/services/daily_plan_tasks.py`, `SPECS[...].done_q`):

- `daily_export` (export_manager) — первой живой отгрузкой на сегодня со страной и клиентом.
  План распределения машин (truck allocation) задача не видит: 1 машина из 6 — и она «выполнена».
- `daily_loading` (loading_dept_head + deputy) — первой упаковкой на сегодня. Ни план, ни
  открытые экспорт-менеджером экспортные части не учитываются.

Остальные машины дня остаются без задачи. Куда и сколько машин сегодня, задача не показывает.

## Decisions taken (owner, 2026-10-01)

| Вопрос | Ответ |
|---|---|
| Когда закрывается задача экспорт-менеджера | Когда по каждой строке плана на сегодня факт ≥ плана **и** у каждой экспортной части на сегодня есть упаковка (вариант «б») |
| Кто присоединяет упаковку | **Экспорт-менеджер.** Loading только открывает упаковки |
| Цель loading | Больше из двух: план на сегодня всего или открытые экспортные части на сегодня |
| Порядок | Любой: упаковка может быть открыта раньше экспортной части и наоборот. Отдельной задачи «присоединить» нет — это часть задачи экспорт-менеджера |
| Одна задача или задача на машину | Одна задача в день на роль, со счётчиком |
| Gapy Satys | Строка плана «Gapy Satys» ↔ отгрузки с `is_gapy_satys=True` (любая страна). Строки стран ↔ только обычные отгрузки этой страны. Gapy входит в обе задачи |
| KPI | **Не меняется.** Пропущенная задача по-прежнему отменяется в 06:05 как `missed` и в KPI не идёт; видна в истории задач («Missed») |
| Почему задача не будет висеть вечно | Распределение на сегодня правит сам экспорт-менеджер (запрета на текущий/прошлый день нет ни в `set-splits`, ни в `TruckAllocationTable`). Меньше машин — правит план, задача закрывается |

## Terms

- **Живая отгрузка** — `is_archived=False`, `deleted_at IS NULL`, статус не `cancelled` (как сейчас в `_is_done`).
- **Экспортная часть на день D** — живая отгрузка с `date = D`, `country` и `customer` заполнены.
- **Упаковка на день D** — живая отгрузка с `date = D` и хотя бы одним `block_sources`, свободная
  (без страны/клиента) или уже присоединённая. **1 строка = 1 машина.**
- **Экспортная часть с упаковкой** — экспортная часть, у которой есть `block_sources`.
- **План на день D** — `TruckDestinationSplit` с `truck_count > 0` у `WeeklyTruckAllocation`
  с `(year, week_number, day_of_week)` = ISO-календарь D (без фильтра по сезону — как
  `allocation_counts`). Строки плана:
  - направления со страной группируются **по стране** (две строки `TruckDestination` одной
    страны складываются), подпись — имена направлений через « + »;
  - направления без страны (`country IS NULL`, сейчас это только «Gapy Satys») — одна строка
    **gapy**.
- **Факт строки:** строка страны C — экспортные части с `country = C` и `is_gapy_satys=False`;
  строка gapy — экспортные части с `is_gapy_satys=True`.
- Экспортная часть страны, которой нет в плане, даёт строку с `plan = 0` (подпись —
  `Country.name_en`, как `country_name` на Fleet Map). Она не мешает закрытию, но ей нужна упаковка.

## Part 1 — Backend

### 1.1 Сервис `services/daily_progress.py` (новый)

Одна функция считает всё; её используют закрытие задач, `/me/tasks/` и эндпоинт.

```python
@dataclass(frozen=True)
class ProgressRow:
    key: str            # 'country:<id>' | 'gapy'
    label: str
    country_id: int | None
    is_gapy: bool
    plan: int
    fact: int

@dataclass(frozen=True)
class DayProgress:
    date: date
    rows: list[ProgressRow]
    plan_total: int          # сумма plan по строкам
    export_parts: int
    export_parts_packed: int # экспортные части с упаковкой
    packed: int              # упаковки на день (свободные + присоединённые)
    loading_target: int      # max(plan_total, export_parts)

def day_progress(day: date, season) -> DayProgress: ...
def week_progress(day: date, season) -> list[DayProgress]:  # Пн–Сб ISO-недели дня
```

И отгрузки, и распределения фильтруются по `season`. Задачи передают активный сезон
(`get_active_season()`), эндпоинт — `resolve_season(request)`.

Запросы — агрегаты в БД (план: один запрос по splits; факт: один `values('country_id',
'is_gapy_satys').annotate(Count)` по экспортным частям; упаковки: `Count('id', distinct=True)`
с `block_sources__isnull=False`). Неделя — те же запросы с диапазоном дат, без цикла по дням
в БД. `.order_by()` перед агрегатами (Meta.ordering, `mssql-compat.md`).

### 1.2 Правила закрытия (`daily_plan_tasks.py`)

`SPECS[kind].done_q` заменяется функцией готовности по `DayProgress`:

- **`daily_export`:** `export_parts ≥ 1` **и** для каждой строки `fact ≥ plan` **и**
  `export_parts_packed == export_parts`.
- **`daily_loading`:** `packed ≥ 1` **и** `packed ≥ loading_target`.

Нет плана на день → строк с `plan > 0` нет, цель loading = `export_parts`; остальное то же.
Закрытая задача обратно **не открывается** (резолвер только закрывает, как сейчас).

`resolve_daily_plan_tasks()` глобальный и идёт на **каждый** опрос `/me/tasks/` любым
пользователем. Поэтому `day_progress` считается **один раз на дату за запрос**: резолвер
собирает `{scope_date: DayProgress}` для открытых дневных задач и возвращает его, `MeTaskListView`
передаёт этот словарь в контекст сериализатора (1.4). Обе задачи дня делят одно вычисление
(~3 агрегатных запроса на дату).
Создание, срок, отмена `missed` в 06:05 — без изменений.

Ссылка `daily_export`: `/export/drafts` → **`/export/assign`** (`/export/drafts` — DraftPool,
сторона упаковки). Уже созданные задачи сохраняют старую ссылку до следующего дня.
`daily_loading` — `/export/gaplama`, без изменений.

### 1.3 Эндпоинт `GET /api/v1/export/truck-allocations/daily-progress/?date=YYYY-MM-DD`

Action на `WeeklyTruckAllocationViewSet`, рядом с `review` и `transport-plan`. Гейт —
`truck_allocation.can_view` (есть у export_manager, loading_dept_head(+deputy), transport,
document_team, admin, boss, director). Все числа — JSON int.

- `date` не передан → **серверный** сегодняшний день (`timezone.localdate()`), не браузерный:
  пользователи в KZ/RU. Неверный формат → `400 {"error": "date must be YYYY-MM-DD."}`.
- **Season-scoped**, в отличие от соседних actions: те читают только распределения, а этот —
  отгрузки по дате, то есть это ровно та дыра, что закрыта в `harvest-forecast/remaining`.
  `?season=` необязателен (по умолчанию активный), `404` неизвестный, `403` закрытый без
  `closed_season.can_view`; в разрыве между сезонами — `days: []` (D7, fail closed).
  Отгрузки и распределения считаются только внутри разрешённого сезона.

```json
{
  "date": "2026-10-01",
  "days": [
    {
      "date": "2026-09-28", "day_of_week": 1,
      "rows": [
        { "key": "country:3", "label": "Russia", "country_id": 3, "is_gapy": false, "plan": 4, "fact": 3 },
        { "key": "gapy", "label": "Gapy Satys", "country_id": null, "is_gapy": true, "plan": 1, "fact": 1 }
      ],
      "plan_total": 5, "export_parts": 4, "export_parts_packed": 3,
      "packed": 3, "loading_target": 5
    }
  ]
}
```

`days` — всегда 6 элементов (Пн–Сб ISO-недели `date`).

### 1.4 `/me/tasks/` — поле `progress`

`TaskListSerializer` += `progress`: для **открытых** (`open` / `in_progress`) задач
`daily_export` / `daily_loading` — объект дня в форме элемента `days[]` выше (по
`scope_date`); для всех остальных — `null`. Берётся из словаря в контексте сериализатора
(см. 1.2), сам сериализатор ничего не считает. Нет в словаре → `null`.

### 1.5 Создание экспортной части с плана

`POST /export/shipments/` (`is_draft: true`) уже принимает `date` и `country`. Добавляется
необязательное `is_gapy_satys` (bool, default `false`) — для «+» на строке gapy (у gapy-строки
страны нет, её заполняют в карточке).

## Part 2 — Frontend

1. **Карточка задачи** (`components/me/PlanTaskCard.tsx`): при `task.progress` — строка прогресса.
   - `daily_export`: «RU 3/4 · KZ 2/2 · Gapy 1/1 · упаковка 5/7» (`fact/plan` по строкам,
     затем `export_parts_packed/export_parts`).
   - `daily_loading`: «Упаковано 3 из 6» (`packed/loading_target`).
2. **Полоса на `/export/assign`** (`pages/export/assignment/DailyPlanStrip.tsx`, новый; хук
   `useDailyProgress(date?)` → эндпоинт 1.3; полоса **не передаёт** `date` — сегодняшний день
берётся с сервера, выделение «сегодня» — по `date` из ответа):
   - «Сегодня: RU 3/4 [+] · KZ 2/2 [+] · Gapy 1/1 [+] · упаковка 5/7»;
   - «+» — `POST /export/shipments/` `{is_draft: true, country}` **без `date`** — сервер
     ставит `localdate()` (gapy: `{is_draft: true, is_gapy_satys: true}` без страны) → переход на карточку `/shipments/{id}`
     (там все поля Sheet, клиента заполняют там). Не на Sheet: deep-link Sheet открывает
     панель комментариев, а не редактирование. «+» только при
     `canDoBackendGated(user, 'shipment', 'create')` и не в закрытом сезоне;
   - раскрывающаяся «Неделя»: таблица Пн–Сб × строки плана, ячейка `fact/plan`, сегодняшний
     столбец выделен.
3. **Полоса в Gaplama** (`pages/sera/GaplamaTab.tsx`, только дневной вид, на выбранный день;
   видна и во вкладке Tır Takip — это тот же компонент):
   - «Упаковано 3 из 6 · на складе ещё на 5 машин»;
   - данные — эндпоинт 1.3 с `date` = выбранный день доски (это дата доски, не «сегодня» браузера);
   - склад = `⌊Σ available_kg выбранного дня по всем блокам / truckCapacityKg⌋` из уже
     загруженной доски (`truckCapacityKg` — тот же `config.truck_capacity_kg`, что у столбца
     машин доски, по умолчанию 18 500) — без учёта фильтров локации/блока. `available_kg` — остаток после уже
     загруженного, поэтому сравнивается с остатком цели: `осталось = max(0, loading_target − packed)`;
   - красное «не хватает на N машин», если `осталось − склад = N > 0`.
4. i18n — tk / ru / en. Слово «черновик»/«draft» в UI не используется.
5. Числа приходят int — коэрсия не нужна. Мок-режим: хук возвращает пустую неделю.

## Known effects (проверить в плане, не менять молча)

- `backend/apps/export/tests_daily_plan_tasks.py` ждёт закрытия по одной машине — тесты
  переписываются под новые правила.
- Правка распределения на сегодня снова открывает транспорту «Tanyşdym» (`transport_plan`)
  на этот день. Это правильно.
- Присоединение переносит упаковку на строку экспортной части — упаковка получает **её**
  дату. Присоединили сегодняшнюю упаковку к завтрашней экспортной части → сегодняшний
  `packed` уменьшится. Принято.
- Колонка поставки в Sheet без лимита (может быть > 1 машины) считается одной машиной.
  Основной путь — Gaplama «+ Tır Aç», где 1 строка = 1 машина. Принято.
- Одна задача в день на роль: при резком изменении плана после закрытия задача не
  открывается заново.
- `/me/tasks/` опрашивается всеми, и резолвер глобальный: при открытых дневных задачах
  каждый опрос добавляет ~3 агрегатных запроса (одна дата, общая для резолвера и
  сериализатора, см. 1.2). Сейчас резолвер уже делает по одному `exists()` на задачу.
- Старое правило «закрывается первой машиной» описано ещё в: i18n `task_rules.kind_daily_loading_completes`
  / `kind_daily_export_completes` (tk/ru/en, страница Task Rules), `docs/obsidian/reference/task.md`
  (строки `daily_loading` / `daily_export`), таблица задач 4/5a в
  `docs/superpowers/specs/2026-09-29-planning-tasks-design.md` (пометить «заменено спекой 2026-10-01»).
- Доступ проверен 2026-10-01 на общей БД: у `loading_dept_head(+deputy)` и `export_manager`
  открыты `tir_takip.gaplama`, `export.plan`, `export.assign`, `export.shipments` и
  `truck_allocation.can_view`.

- Beta работает на той же БД со старым кодом: пока его не обновили, его опросы `/me/tasks/` закрывают
  дневные задачи первой машиной, а beat в 06:05 создаёт `daily_export` со ссылкой `/export/drafts`.
  Деплоить вместе и пересобрать `celery-worker` + `celery-beat`.

## Testing

Backend (`apps.export`, приватное имя тестовой БД — см. память «Test DB Name Collision»):
- `day_progress`: группировка двух направлений одной страны; gapy ↔ `is_gapy_satys` (gapy-машина
  в KZ не идёт в строку KZ); страна вне плана → строка `plan=0`; мёртвые отгрузки
  (удалённые / архив / cancelled) не считаются; свободная и присоединённая упаковка обе в
  `packed`; нет плана → строк с `plan > 0` нет.
- Закрытие `daily_export`: факт < плана → открыта; факт ≥ плана, но экспортная часть без
  упаковки → открыта; всё выполнено → `done`; 0 экспортных частей → открыта.
- Закрытие `daily_loading`: упаковки раньше экспортных частей (цель = план); экспортных частей
  больше плана (цель = их число); нет плана; 0 упаковок → открыта.
- Эндпоинт: 6 дней; без `date` — серверный сегодняшний день; 400 на кривую дату; 403 без
  `truck_allocation.can_view`; закрытый сезон без права → 403; разрыв сезонов → `days: []`;
  отгрузка другого сезона не считается.
- Один расчёт на дату: резолвер + сериализатор при двух открытых дневных задачах — число
  запросов фиксировано (`assertNumQueries`).
- `/me/tasks/`: `progress` есть у открытой дневной задачи, `null` у закрытой и у прочих видов.
- Создание с `is_gapy_satys: true`.

Frontend (vitest): строка прогресса на карточке для обоих видов; `DailyPlanStrip` — рендер
строк, «+» шлёт `country` / `is_gapy_satys` и переходит на карточку, «+» скрыт без права;
полоса Gaplama — подсчёт склада и «не хватает». `npx tsc --noEmit --ignoreDeprecations 5.0`.

## Commits (по одному на шаг)

1. `feat(p3)`: сервис `daily_progress` + новые правила закрытия + ссылка `/export/assign` + тесты.
2. `feat(p3)`: эндпоинт `daily-progress`, поле `progress` в `/me/tasks/`, `is_gapy_satys` на создании + тесты.
3. `feat(frontend)`: строка прогресса на карточке задачи.
4. `feat(frontend)`: полоса плана на `/export/assign` (сегодня, «+», неделя).
5. `feat(frontend)`: полоса в Gaplama.
6. `docs`: Obsidian (`truck-allocation.md`, `comments-tasks.md`, `reference/task.md`,
   `screens/gaplama.md`, `processes/assignment-board.md`), `api-contract` skill, пометка в спеке
   2026-09-29, CHANGELOG, BUILD_TEST_LOG. i18n `kind_daily_*_completes` — в коммите 3.

## Out of scope

- Изменение KPI для пропущенных задач.
- Задача на каждую машину; отдельная задача «присоединить».
- Повторное открытие закрытой задачи при изменении плана.
- Gaplama: недельный вид полосы.
