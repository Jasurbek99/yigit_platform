# apps.core + apps.contracts — разбор 10 красных тестов

Замер 2026-09-12, ветка `main`, `manage.py test apps.core apps.contracts` → 618 тестов, 3 падения + 7 ошибок.
Все pre-existing: к правкам в `core` (place_region / `name_ru` / F35) отношения не имеют.

## Вывод в одну строку

8 из 10 — артефакт запуска **без** `DJANGO_TESTING=true`. 2 — устаревшие ожидания в тестах.
Ни одна из десяти не означает поломку на проде.

**Статус:** группа B (2 падения) исправлена 2026-09-12. Группа A (8) остаётся — это вопрос
команды запуска, а не кода.

Контрольный прогон:

```
DJANGO_TESTING=true python manage.py test apps.core.tests_season_services apps.core.tests_boss_access
→ Ran 60 tests — OK
```

---

## Группа A — 7 ошибок + 1 падение: тесты запущены без `DJANGO_TESTING=true`

Дата-миграции `core` пропускают себя только по env-переменной:

```python
if os.environ.get('DJANGO_TESTING') == 'true':
    return
```

`config/settings.py` определяет тестовый режим по `'test' in sys.argv` ИЛИ по этой переменной,
а `manage.py test` переменную не выставляет. Итог: настройки считают, что идут тесты,
а миграции — что это обычный деплой, и засевают данные в тестовую БД.

### A1 — 7 ошибок в `apps/core/tests_season_services.py`

```
IntegrityError: Violation of UNIQUE KEY 'UQ__core_shi__357D4CF9'.
Cannot insert duplicate key in 'dbo.core_shipment_status_types'. Key value is (draft).
```

Хелпер на строке 20 делает `ShipmentStatusType.objects.create(code='draft', ...)`,
а строку `draft` уже засеяли миграции `0006_seed_shipment_draft_status`,
`0010_state_machine_v2`, `0011_add_cancelled_status`.

Задеты: `ClosePreviewTests` (4), `ClosePreviewDraftQuotaUsageTests` (2), `CloseSeasonTests` (1).

Два способа починить:
1. Запускать с `DJANGO_TESTING=true` — так это и было задумано.
2. Заменить `create()` на `get_or_create()` в `_status()` — тест перестанет зависеть от env.

### A2 — `tests_boss_access.test_boss_sees_every_registered_page_except_the_dead_ones`

```
Items in the second set but not the first: 'export.harvest_board'
```

Здесь схлопнулись две миграции с **разными** способами пропуска тестовой базы:

| Миграция | Что делает с boss-строкой harvest_board | Как пропускает тесты |
|---|---|---|
| `0012_grant_harvest_board_page` | пишет `is_visible=False` («hidden for seller/boss») | по `DJANGO_TESTING` — без флага **выполняется** |
| `0033_boss_process_visibility_perms` | `update_or_create` → `is_visible=True` для всех страниц кроме четырёх мёртвых | по префиксу имени БД `test_` — в тестах **всегда** пропускается |

Без флага 0012 успевает записать `False`, а исправляющая её 0033 в тестовую БД не заходит
принципиально. `seed_permissions` потом делает `get_or_create` и существующую строку не трогает.

На проде порядок нормальный: 0033 идёт после 0012, читает живой `PAGE_REGISTRY` и
переписывает строку в `True`. Проверить на живой базе, если захочется:

```python
RolePagePermission.objects.filter(role='boss', is_visible=True).count()
# должно быть == len(PAGE_REGISTRY) - 4
```

---

## Группа B — 2 падения: устаревшие ожидания в тестах — ИСПРАВЛЕНО 2026-09-12

Обе воспроизводились и с `DJANGO_TESTING=true`, то есть это был настоящий рассинхрон тест ↔ код.
В обоих случаях прав оказался код, а не тест, поэтому поправлены ожидания.

### B1 — `tests_seasons.ClosedSeasonResourceTests.test_seed_grants_management_roles`

```
Items in the first set but not the second: 'document_team'
```

Тест ждёт ровно `{admin, director, boss, export_manager, finansist}`.
С сентября 2026 роль `document_team` приравнена к `export_manager`
(константа `EXPORT_MANAGER_LIKE` в `apps/core/roles.py`), поэтому получает и
`closed_season.can_view`. Поведение верное — просрочено ожидание в тесте.

**Исправление:** `document_team` добавлен в ожидаемое множество с комментарием на
`EXPORT_MANAGER_LIKE`.

### B2 — `contracts.tests.test_attachment_api.ContractAttachmentPermissionTest.test_readonly_role_cannot_upload`

```
AssertionError: 201 != 403
```

В тесте комментарий `# view-only on contract` про роль boss. Это неправда с 2026-08-05:
`seed_permissions` даёт boss'у `**{r: _VCRUD for r in _ALL_RESOURCES}` с четырьмя исключениями
(`closed_season`, `truck_split_default`, `sale`, `fleet`) — `contract` в них не входит.
Загрузка вложения идёт через `DynamicResourcePermission` → `contract.can_create` → 201.

Это не дыра в правах: read-only для boss'а перенесли во фронтовый тумблер view/edit,
матрица прав его больше не ограничивает.

**Исправление:** роли, которая видит `contract`, но не может создавать, в дефолтах вообще нет —
ресурс выдан пяти ролям и всем пятерым полным CRUD. Поэтому тест взял `transport`, у которой
строки `contract` нет совсем (`get_resource_perm` → `None` → 403), и переименован в
`test_role_without_contract_access_cannot_upload`.

*Мелочь рядом:* комментарий в `seed_permissions.py` над блоком boss говорит «Three carve-outs»,
а исключений четыре — `fleet` дописали позже, комментарий не поправили.


---

## Как чинится группа A (не применено — ждёт решения)

### Причина

22 дата-миграции сторожатся переменной окружения `DJANGO_TESTING`, а `config/settings.py`
определяет тестовый режим ещё и по `'test' in sys.argv`. `manage.py test` переменную не ставит,
поэтому две проверки расходятся: настройки уже в тестовом режиме, миграции — ещё нет.

Три миграции (`0033`, `0039`, `0040`) сторожатся по-другому — по префиксу `test_` в имени базы.
В докстроке 0033 объяснено, почему так лучше: переменную можно случайно оставить в шелле, и тогда
миграция навсегда запишется как применённая, ничего не сделав («уже промахнулась на `export.0058`»).

Отдельно: 0033 утверждает, что все документированные команды запуска тестов выставляют флаг.
Это не так — в markdown-файлах репозитория `DJANGO_TESTING` не встречается ни разу, а
`.claude/rules/git-conventions.md` показывает команду без него.

### Вариант A — одна строка в `config/settings.py`

Внутри `if RUNNING_TESTS:` выставить `os.environ['DJANGO_TESTING'] = 'true'`.
Все 22 миграции начинают пропускаться при любом способе запуска, ни одна из них не правится.
На живую базу не влияет: `manage.py migrate` не проходит `RUNNING_TESTS`.

Оговорка: `TEST_DB_NAME` нигде не проверяется на префикс, поэтому два вида сторожей согласованы
ровно до тех пор, пока тестовая база называется с `test_`.

### Замер на `apps.export` — регрессий нет

Два прогона одного и того же дерева, 2026-09-12. Флаг воспроизводит то, что сделает вариант A.

| Прогон | Тестов | Красных |
|---|---|---|
| без флага | 1536 | 41 |
| `DJANGO_TESTING=true` | 1568 | 17 |

Сравнивались имена, а не числа: 17 красных с флагом — строгое подмножество 41. **Новых не появилось
ни одного**, флаг чинит 24. Разница в количестве тестов та же причина: ошибка в `setUpClass`
схлопывает целый класс в одну строку отчёта.

Что чинит флаг: 7 классов, падавших целиком в `setUpClass`
(`tests_completeness`, `tests_completeness_api`, `tests_field_history`, `tests_supply_draft` ×4),
и 17 тестов `tests_official_code_validator`.

Что остаётся красным и является настоящим долгом:

| Модуль | Красных |
|---|---|
| `tests_sheet_authority` | 7 |
| `tests_boss_analytics` | 6 |
| `tests_season_scoping` | 2 |
| `tests_task_engine` | 1 |
| `tests_shipment_swap` | 1 |

### Вариант B — уборка на потом

Перевести все 22 миграции на проверку по имени базы, как в 0033. По существу правильнее, убирает
зависимость от переменной окружения совсем, но это 22 исторических файла.

### Что вариантом A не чинится

`_status()` в `tests_season_services.py` стоит перевести на `get_or_create` независимо от A — тогда
тест перестанет зависеть от способа запуска вообще.

Тест про boss так починить нельзя: для этого `seed_permissions` должен был бы писать
`update_or_create` вместо `get_or_create`, а это затрёт ручные переключатели админа в матрице прав
при следующем прогоне сида. Вариант A чинит его сам, без правки кода прав.
