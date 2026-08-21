# Инвентарь незакрытой работы — 2026-08-21

Один упорядоченный список вместо разрозненных находок. Две стопки — они разного рода:
**A** — код, который я могу довести; **B** — сборки, которые закрыть можешь только ты (ручной тест).

> Этот файл **заменяет** секцию «Приоритет: свежие сборки без теста» в `docs/TEST_CHECKLIST.html`
> (тот чеклист от 15 авг и не знает про сборки 20 авг). Список «что тестировать» — только здесь.
> Сам HTML-чеклист остаётся для пошаговой проверки экранов в браузере.

---

## Стопка A — незакоммиченный код в рабочем дереве

**Обновлено 21 авг 16:20 — стопка A закрыта полностью.** Пять коммитов:
`96ae04f` (мусор), `c755815` (A4 документы), `59e409f` (A1 boss+план),
`d132e98` (A3 Pomidor Dükany) и хвостовой с логами. Рабочее дерево чистое.

Смешанные файлы (три `i18n` + `weekly-harvest-planning.md`) разрезаны по ханкам:
ключи `pomidor.*` и перекрёстная ссылка временно снимались, чтобы уехать со
своей фичей, а не с чужой.

**Две поправки к прежнему разбиению:** `backend/apps/core/permission_registry.py`
относится к A3 (код страницы Pomidor Dükany), а не к A1; и `backend/apps/export/views.py`
в списке A1 отсутствовал — там 7 строк, расширение `generate-weekly-plan` до boss.

Ниже — что вошло в какой коммит.

### ~~A1. Boss: недельный план — права + одно значение в ячейке~~ — ГОТОВО, `59e409f`
- `backend/apps/core/permission_registry.py`, `roles.py`
- `backend/apps/greenhouse/views.py`, `services/harvest_day_service.py`
- `backend/apps/greenhouse/tests/test_boss_weekly_plan_access.py` *(новый)*
- `backend/apps/export/tests_ad15_boss_boundary.py` *(новый)* — страхует границу AD-15, которую двигает именно эта правка
- `frontend/src/components/HarvestCell.tsx` + `HarvestCell.planOnly.test.tsx` *(новый)*
- `frontend/src/pages/export/WeeklyPlanGrid.tsx`, `hooks/usePlanning.ts` + `usePlanning.invalidation.test.tsx` *(новый)*
- Документы: `docs/obsidian/processes/permissions-system.md`, `weekly-harvest-planning.md`, `roles/boss.md`

### ~~A2. Реестр водителей (импорт → админка → выбор в листе)~~ — ГОТОВО, `fffa7d2..89a29be`
- `backend/apps/transport/`: `services/tir_client.py`, `services/tir_import.py`, `management/commands/import_tir_fleet.py`, `serializers.py`, `views.py`, `urls.py`, `permissions.py`, `tests/test_fleet_api.py`, `tests/test_tir_import.py`
- `frontend/src/hooks/useFleet.ts`, `useFleetAdmin.ts` + тест
- `frontend/src/pages/admin/FleetAdminPage.tsx` + тест, `FleetDriversTab.tsx` + тест *(новые)*
- `frontend/src/components/sheet/SheetDriverSelectEditor.tsx` + тест *(новые)*, `SheetCellEditor.tsx` + тест
- `frontend/src/components/shipment/TaskCardEditor.helpers.ts`
- Документы: `docs/obsidian/screens/fleet-admin.md`, `processes/fleet-map.md`, `screens/shipment-sheet.md`, `reference/api-endpoint-map.md`, `reference/data-model-map.md` *(обе правки — только водители, проверено по ханкам)*
- i18n: блоки `fleet.*`, `sheet.add_driver`

### ~~A3. Pomidor Dükany — план vs факт по блокам~~ — ГОТОВО, `d132e98`
- `backend/apps/export/services/pomidor_dukany.py`, `views_pomidor_dukany.py`, `tests_pomidor_dukany.py` *(новые)*, `urls.py`
- `frontend/src/pages/export/PomidorDukany.tsx` + `.helpers.ts` + тест *(новые)*, `hooks/useProductionAnalysis.ts` *(новый)*
- `frontend/src/App.tsx`, `components/AppLayout.tsx` + `AppLayout.menuGroups.test.tsx` (маршрут + пункт меню)
- Документы: `docs/obsidian/processes/pomidor-dukany.md` *(новый)*, `docs/obsidian/00-index.md` *(одна строка — только pomidor)*
- i18n: блок `pomidor.*`, `nav.pomidor_dukany`

### ~~A4. Документы: красные значения + настройка полей страницы~~ — ГОТОВО, `c755815`
- `backend/apps/contracts/`: `migrations/0012_documentlayoutsetting.py`, `models/document_layout.py`, `models/__init__.py`, `services/document_highlight.py`, `services/document_render.py`, `document_templates/registry.py`, `serializers.py`, `views.py`, `urls.py`, `tests/test_document_generation.py`
- `frontend/src/components/DocumentLayoutPopover.tsx`, `DocumentOptionsModal.tsx` + тест, `hooks/useDocumentDownload.ts`, `useDocumentLayouts.ts` *(новые)*
- `frontend/src/components/CmrDocumentsButton.tsx`, `ContractAgreementButton.tsx`, `InvoiceDocumentsButton.tsx`, `PacketZipButton.tsx`
- Документы: `docs/obsidian/processes/document-generation.md`
- i18n: блок `document_layout.*`, `documents.highlight*`
- Миграция 0012 **уже применена локально**.

### ~~A5. Общие документы (последним коммитом)~~ — ГОТОВО, хвостовой коммит
`CHANGELOG.md`, `BUILD_TEST_LOG.md` — единственные два файла, где ханки лежат вперемешку
(после коммита A2 остались A1 + A3 + A4: boss, pomidor, layout).
Либо режем `git add -p`, либо оба едут одним хвостовым коммитом (тогда фичевые коммиты идут без записей в лог/чейнджлог).
Остальные obsidian-файлы проверены по ханкам и разошлись по фичам — резать не надо.
`docs/WORK_INVENTORY.md` (этот файл) тоже пока не в git.

### ~~A6. Мусор~~ — ГОТОВО, `96ae04f`
- 8 PNG в корне репозитория: `boss-2selected-bulkbar.png`, `boss-ambiguous.png`, `boss-drafts-editmode.png`, `boss-editmode-checkboxes.png`, `boss-editmode-rerender.png`, `boss-joindrafts-modal.png`, `boss-shipments-recheck.png` — отладочные скриншоты → удалить. `light.png` — **не удалён.** Посмотрел перед удалением: это отрендеренный отчёт «The June Cliff» (обвал записи процесса в июле 2026: 428 → 22 → 12 обновлений статусов), а исходника `june-cliff.html` нигде не осталось — то есть PNG единственная копия. Перенесён в `docs/analysis/2026-08-20-june-cliff.png`
- `node_modules/.vite/vitest/.../results.json` **отслеживается git** — в `.gitignore` есть только `frontend/node_modules/`, корневой `node_modules/` не закрыт → `git rm --cached` + строка в `.gitignore`
- `.codex/`, `AGENTS.md`, `.agents/` — в `.gitignore`, не удалены. Это конфиг Codex, зеркало `.claude/`. Если он нужен всей команде — скажи, закоммичу вместо игнора
- `docs/TEST_CHECKLIST.html` — чеклист от 15 авг, **не покрывает сборки от 20 авг**

**Замечание:** три i18n-файла (`en/ru/tk.json`) правились тремя фичами сразу — при разбиении их надо резать по блокам ключей (блоки не пересекаются, режется чисто).

---

## Стопка B — 83 записи «NEEDS TEST» = 15 реальных проверок

Лог раздут цепочками фикс-раундов и подзадач. Схлопнуто по фичам:

| # | Что проверять | Записей в логе | Статус кода |
|---|---|---|---|
| 1 | Boss: `/export/plan` — ввод и назначение плана, одно значение в ячейке | 3 | в git `59e409f` |
| 2 | Водители: импорт 152 из Z_TIRWEB, вкладка «Водители» в `/admin/fleet`, выбор водителя в ячейке R27 | 3 | в git `fffa7d2..89a29be` |
| 3 | `/export/pomidor-dukany` — план vs факт по блокам | 1 | в git `d132e98` |
| 4 | Документы: красные заполненные значения + настройка полей страницы | 1 | в git `c755815` |
| 5 | Join драфтов: кнопка в bulk-баре списка, «Join supply» на детали, права boss | 4 | в git |
| 6 | Sales report — 9 исправлений (маржа, валидация) | 1 | в git |
| 7 | Boss Dashboard — три таблицы по блокам сведены в одну | 1 | в git |
| 8a | **Сезоны в браузере:** закрыть сезон, открыть следующий, смотреть закрытый только на чтение, переключатель в шапке | ~15 | в git |
| ~~8b~~ | ~~Сезоны под капотом: резолвер, 20 переведённых запросов, backfill FK, два слоя write-freeze~~ — **ЗАКРЫТО 21 авг**, см. ниже | 24 | ✅ автотестами |
| 9 | Автопарк: тягачи/прицепы, endpoints, inline «+ Add», оверлей выбора в листе | 6 | в git |
| 10 | GPS: связка рейс↔тягач, карточка позиции на детали | 2 | в git |
| 11 | Карта автопарка + живой опрос Celery (120 с) | 2 | в git |
| 12 | Документы: страница `/documents`, ZIP-пакет, многострочный инвойс | 3 | в git |
| 13 | Брендинг: favicon + логотип на логине | 1 | в git |
| 14 | Безопасность: блокировка перебора, throttle, лимит PDF, nginx rate-limit | 4 | в git |
| 15 | ShipmentDetail редизайн + комментарии, Team KPI leaderboard | 6 | в git |

**Главное число: 45 из 83 записей — это одна фича «Сезоны».**

**8b закрыта 21 августа прогоном, а не кликами.** Отмечено **24** записи (не «~30», как я прикинул сначала —
пересчитал по факту). Каждая помечена в `BUILD_TEST_LOG.md` единой формулировкой
`закрыто автотестами 2026-08-21 (292/292 …); UI не проверялся` — grep по этой фразе всегда покажет,
что проверено машиной, а не глазами. Лог: **83 → 59 непроверенных**.

Что НЕ отмечено, хотя тоже про сезоны, и почему:

- запись про `GET /export/harvest-forecast/remaining/` — ни один тест-файл её не покрывает;
- две записи D11 — у них есть видимый ledger и отображение квот;
- Task 5/17 — в самом тексте записи сказано «первый видимый пользователю шаг»;
- всё про Task 13–16, переключатель сезонов, баннер и админскую страницу сезонов — это UI по определению.

Порядок дальше: 1–4 (свежее, ещё никем не виденное) → 8a → 5–7 → 9–15.

---

## Почему «каждый раз находишь кучу»

1. **Коммитов нет — работа копится в дереве.** 6 фич в одной куче; каждая новая правка садится поверх невыясненного.
2. **Мусор не отсекается на входе** — скриншоты в корне, `node_modules` частично отслеживается.
3. **Галочки в логе не ставятся** — 17 из 100. Лог пишется, но не закрывается, поэтому выглядит как бесконечный долг.
4. **Фикс-раунды пишутся отдельными записями** — одна фича = 45 строк «NEEDS TEST».

---

## Покрытие внутренней механики (21 авг, пункты 1–2)

Браузером проверяется поведение экрана; здесь — то, что кликами не проверишь.

### Пункт 1 — план для boss: +17 тестов

| Файл | Что закрывает |
|---|---|
| `backend/apps/export/tests_ad15_boss_boundary.py` *(новый, 9 тестов)* | Граница AD-15 на HTTP-уровне: boss получает 403 на `PATCH /admin/users/{id}/` (смена роли, в т.ч. самому себе), на `PUT /admin/users/{id}/permissions/` и на `PUT /admin/managed-page-permissions/`. Контрольные тесты admin (200) доказывают, что 403 — это гейт, а не сломанный эндпоинт. `seed_permissions` прогоняется первым: boss имеет `*` по матрице, и гейт всё равно держит |
| `backend/apps/greenhouse/tests/test_boss_weekly_plan_access.py` *(+8 тестов)* | `bulk-grant-late-edit` / `bulk-revoke-late-edit` — два из четырёх мест, переведённых на `is_admin_like`, были без тестов вообще; суперюзер с чужой ролью на HTTP-уровне; граница override-ветки |

Итого по пункту 1: **33/33 зелёных** (`apps.export.tests_ad15_boss_boundary` + `apps.greenhouse.tests.test_boss_weekly_plan_access`).

### Пункт 2 — водители: 0 новых тестов, и это правильно

`test_tir_import.py` уже покрывает сохранение id из Z_TIRWEB, идемпотентность повторного импорта, намеренное исключение `phone`/`is_active` из upsert и то, что созданный после импорта водитель не сталкивается по id. `tests_fleet_api.py::DriverApiTests` покрывает active-only список, поиск, read-only `id`, ролевой гейт и `boss may write`. Тесты идут на реальном MSSQL, то есть утверждение про IDENTITY_INSERT проверяется по-настоящему. Дописывать нечего.

### Что нашлось попутно

1. **AD-15 цел — это подтверждение, а не баг.** Гейт смены роли пропускает по `_is_full_admin(user) OR can_manage_users(user)`. `_is_full_admin` — отдельный хелпер (`is_superuser or role == 'admin'`), с `is_admin_like` не объединён. `can_manage_users(boss)` = False, потому что `boss` не значится в `MANAGEABLE_BY_ROLE`. Обе лазейки закрыты, теперь под тестом.
2. **`HARVEST_DAY_OVERRIDE` — мёртвая константа.** Ноль потребителей в проде (grep по backend + frontend): правило override держит ветка `is_admin_like(user)` внутри `set_plan_value`, а константа только фиксирует намерение. Тест на неё оставлен как документационный якорь, с честной пометкой в docstring.
3. **`greenhouse_manager` перезаписывает заполненную ячейку плана без причины и без override-снимка.** Требование `reason` и запись `last_override_*` живут только в admin-like ветке. Поведение не новое — этой правкой не внесено, — но раньше его ничто не фиксировало. Теперь зафиксировано тестом. **Нужно решение:** так и задумано или это дыра в аудите?
4. **Пробел на фронте — ЗАКРЫТ 21 авг.** Пять ролевых предикатов `WeeklyPlanGrid.tsx` вынесены в чистую `planGridCapabilities({ role, isReadOnly })` (`WeeklyPlanGrid.roles.ts`) и покрыты 12 тестами: пять ролей × открытый/закрытый сезон. Поведение не менялось — вынос дословный. Зафиксированы два перекоса: `director` правит сетку урожая, но не факт; `canEditActual` схлопывается до `role === 'admin'`. Закрытый сезон гасит запись у всех, включая admin. Полный фронтовый прогон 397/397, `tsc` чист.

### Прогон по радиусу поражения

`roles.py` общий, поэтому прогнал `apps.core apps.greenhouse apps.export apps.transport`: **1707 тестов, 43 провала** (11 failures + 32 errors).

**Все 43 — предсуществующие, подтверждено двумя независимыми способами.**

*Первое — разбивка по модулям сходится с записью от 17 июля один в один:*

| Модуль | Сейчас | Записано 17 июля |
|---|---|---|
| `tests_pallet_manifest` | 15 | 15 |
| `tests_comments` | 11 | 11 |
| `tests_boss_analytics` | 6 | 6 |
| `tests_shipment_sheet` | 5 | 5 |
| `tests_shipment_swap` | 3 | 3 |
| `tests_task_engine` | 1 | 1 |
| `core.tests_permission_matrix` | 1 | 1 |
| `tests_season_freeze` | 1 | — (модуля тогда не существовало) |

Плюс хорошая новость: `tests_shipment_join` (27) и `tests_official_code_validator` (17) в июльском списке были, а сейчас проходят — 44 теста починились по ходу дела.

Единственный выход за старые корзины — `tests_season_freeze.test_patch_a_null_shipment_sale_under_a_closed_contract_returns_409`: дубликат ключа при создании `ContractSale` в фикстуре, то есть изоляция тестов, а не гейт.

*Второе — решающая проверка: в `apps.core.tests_boss_access` есть четыре НЕГАТИВНЫХ утверждения про boss* — страницы вне матрицы скрыты, закрытый сезон только на чтение, truck-split только на чтение, продажу удалять нельзя. Расширение прав, которое протекло бы, сломало бы в первую очередь их. Провалов в этом модуле — **0**.

Ни одного провала в `contracts` — то есть применённая локально миграция 0012 (незакоммиченная группа A4) схему тестовой базы не ломает.
