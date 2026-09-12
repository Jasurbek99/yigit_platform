# apps.core + apps.contracts — разбор 10 красных тестов

Замер 2026-09-12, ветка `main`, `manage.py test apps.core apps.contracts` → 618 тестов, 3 падения + 7 ошибок.
Все pre-existing: к правкам в `core` (place_region / `name_ru` / F35) отношения не имеют.

## Вывод в одну строку

8 из 10 — артефакт запуска **без** `DJANGO_TESTING=true`. 2 — устаревшие ожидания в тестах.
Ни одна из десяти не означает поломку на проде.

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

## Группа B — 2 падения: устаревшие ожидания в тестах

Обе воспроизводятся и с `DJANGO_TESTING=true`, то есть это настоящий рассинхрон тест ↔ код.

### B1 — `tests_seasons.ClosedSeasonResourceTests.test_seed_grants_management_roles`

```
Items in the first set but not the second: 'document_team'
```

Тест ждёт ровно `{admin, director, boss, export_manager, finansist}`.
С сентября 2026 роль `document_team` приравнена к `export_manager`
(константа `EXPORT_MANAGER_LIKE` в `apps/core/roles.py`), поэтому получает и
`closed_season.can_view`. Поведение верное — просрочено ожидание в тесте.

### B2 — `contracts.tests.test_attachment_api.ContractAttachmentPermissionTest.test_readonly_role_cannot_upload`

```
AssertionError: 201 != 403
```

В тесте комментарий `# view-only on contract` про роль boss. Это неправда с 2026-08-05:
`seed_permissions` даёт boss'у `**{r: _VCRUD for r in _ALL_RESOURCES}` с четырьмя исключениями
(`closed_season`, `truck_split_default`, `sale`, `fleet`) — `contract` в них не входит.
Загрузка вложения идёт через `DynamicResourcePermission` → `contract.can_create` → 201.

Это не дыра в правах: read-only для boss'а перенесли во фронтовый тумблер view/edit,
матрица прав его больше не ограничивает. Тесту нужна другая роль без `contract.can_create`
(например `transport` или `accountant`).

*Мелочь рядом:* комментарий в `seed_permissions.py` над блоком boss говорит «Three carve-outs»,
а исключений четыре — `fleet` дописали позже, комментарий не поправили.
