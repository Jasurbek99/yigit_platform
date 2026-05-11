# DECISIONS.md — Architecture Decision Records

> Сюда записываем ВСЕ значимые решения по архитектуре.
> Формат каждой записи фиксированный — чтобы через 3 месяца понять "почему так".
> Claude Code тоже будет это читать как контекст.

---

## Шаблон

```
## ADR-NNNN: Краткое название решения

**Дата:** YYYY-MM-DD
**Статус:** proposed | accepted | superseded by ADR-XXXX | deprecated
**Автор:** имя

### Контекст
Что было до решения. Какая проблема возникла.
Один-два абзаца.

### Решение
Что решили делать. Конкретно, без воды.

### Альтернативы (что отвергли и почему)
- Вариант А — отвергли потому что...
- Вариант Б — отвергли потому что...

### Последствия
- Положительные: ...
- Отрицательные / trade-offs: ...
- Что станет сложнее в будущем
```

---

## ADR-0001: extra_users — исключение из замка, а не дополнение

**Дата:** 2026-04-30
**Статус:** accepted
**Автор:** [имя]

### Контекст
В админке Sheet Control есть `is_locked` (замок строки) и `extra_users`
(множественные пользователи с правом редактирования). Возникает вопрос
семантики: что побеждает при конфликте?

### Решение
`extra_users` — это **исключение из замка**. Если строка locked, и юзер
добавлен в extra_users с can_edit=True — он МОЖЕТ редактировать.

### Альтернативы
- "Замок перебивает всё, extra_users игнорируется при locked" — отвергли,
  т.к. бессмысленно добавлять юзера в locked-строку.

### Последствия
- В UI рядом с замком — явная подсказка "extra_users могут редактировать"
- В тестах — обязательный кейс "lock + extra_user → разрешено"
- Триггер-роли работают так же (исключение из замка)

---

## ADR-0002: Soft-delete везде, никогда hard-delete

**Дата:** 2026-04-30
**Статус:** accepted

### Контекст
При удалении пользователя его права на строки исчезали (CASCADE), история
терялась. То же риск с удалением строк настроек.

### Решение
Везде поля `deleted_at` + `deleted_by`. SET_NULL вместо CASCADE для FK на User.
Кастомный manager `objects.active()` фильтрует по умолчанию.
Hard-delete не разрешён ни через UI ни через API.

### Альтернативы
- Audit log как единственный источник истории — отвергли, т.к. восстановить
  состояние "кто имел доступ на дату X" по логу — медленно и хрупко.

### Последствия
- Объём БД растёт быстрее (приемлемо при текущих масштабах)
- Все queryset'ы должны идти через `.active()` — легко забыть → тесты
- Soft-delete защищает от ошибки админа (есть `restore` endpoint)

---

## ADR-0003: Per-user row order — гибрид DB + IndexedDB

**Дата:** 2026-04-30
**Статус:** accepted

### Контекст
Пользователи привыкли к Google Sheets и хотят свой порядок строк. Один
админский порядок не покрывает все use case'ы.

### Решение
Хранить row_order в БД (`UserSheetPreferences.row_order`) + дублировать в
IndexedDB для мгновенного применения. Sync на сервер debounced 500ms.

### Альтернативы
- Только локально в IndexedDB — отвергли, не переживёт смены устройства
  и очистки кэша.
- Только в БД без локального кэша — отвергли, drag-and-drop задерживается
  на сетевой round-trip.

### Последствия
- Админский display_order остаётся дефолтом для новых юзеров
- Multi-tab sync через BroadcastChannel API
- Маленькая нагрузка на БД (1 UPDATE раз в сессию для большинства юзеров)

---

## ADR-0004: Three-tier configuration

**Дата:** 2026-04-30
**Статус:** accepted

### Контекст
Сколько свободы давать админу через UI? Полная гибкость = риск
непредсказуемых багов. Полное запирание = разработчик нужен на каждое
изменение.

### Решение
Три уровня:
- L1 (Runtime, через UI): порядок, замок, видимость, labels, style, права
- L2 (Schema, миграция): новый field_key, input_type, options_source
- L3 (Code, разработка): новые типы виджетов, валидации, источники

В UI явная плашка: "новое поле — задача разработчику; всё остальное здесь".

### Альтернативы
- Полная data-driven схема (как Airtable) — отвергли, отдельный большой
  проект на месяцы; не оправдан при текущем масштабе.
- Всё в коде — отвергли, админ не может даже название переименовать.

### Последствия
- 95% реальных потребностей закрыты L1
- Новое поле раз в полгода = нормальный релиз с миграцией
- Чёткая граница между ролями (админ vs разработчик)

---

## ADR-0005: Operational / Archive разделение отгрузок

**Дата:** 2026-04-30
**Статус:** accepted

### Контекст
Пользователи привыкли видеть весь сезон в Google Sheets. Тащить всё в
один интерфейс — производительность падает.

### Решение
Два интерфейса:
- Operational: `is_archived=False`, активные ~3 недели + незакрытые
- Archive: `is_archived=True`, read-only, доступ ограничен ролями

Cron раз в сутки переносит: статус terminal + age > 21 day → archive.
Незакрытые остаются в operational сколько бы ни висели (отдельная проблема —
stuck dashboard).

### Альтернативы
- Один интерфейс с пагинацией — отвергли, тормозит при загрузке списка.
- Жёсткая дата (например, 1-е число месяца) — отвергли, теряем контекст
  для незакрытых.

### Последствия
- Stuck shipments dashboard — отдельная фича для отслеживания зависших
- SLA-эскалация (4/7/14 дней)
- Excel export из Archive закрывает потребность "весь сезон"

---

## ADR-0006: Optimistic locking через version field

**Дата:** 2026-04-30
**Статус:** accepted

### Контекст
Двое админов могут одновременно редактировать настройки одной строки.
Без защиты — побеждает последний, первое изменение тихо теряется.

### Решение
Поле `version: PositiveIntegerField` на `SheetRowSetting`. Каждый PATCH
передаёт ожидаемую версию. Не совпадает → 409 Conflict.

### Альтернативы
- Pessimistic locking (блокировка строки на время редактирования) —
  отвергли, сложно реализовать корректно с веб-интерфейсом.
- Просто audit log — отвергли, не предотвращает потерю.

### Последствия
- Фронт должен корректно обрабатывать 409 (показать "кто-то изменил,
  обновите страницу")
- 10 строк кода на бэке, простая реализация

---

## ADR-0007: Sparse display_order (шаг 1024)

**Дата:** 2026-04-30
**Статус:** accepted

### Контекст
Drag-and-drop требует частых reorder'ов. Последовательная нумерация
(1,2,3,4) при перестановке одной строки требует UPDATE всех записей.

### Решение
display_order начинается с 1024, шаг 1024. При drop одной строки между
соседями — UPDATE одной записи (значение = среднее). Когда расстояние
схлопывается до 1 — разовый rebalance всего листа.

### Альтернативы
- Последовательно (1,2,3) — отвергли, медленно при частых reorder.
- Float (1.0, 1.5, 1.75) — отвергли, проблемы с точностью при долгом
  использовании.

### Последствия
- 1 reorder = 1 UPDATE в большинстве случаев
- Rebalance — редкое событие, легко обнаружить (расстояние < 2)

---

<!-- Добавляйте новые ADR ниже, продолжая нумерацию -->

---

## ADR-0008: MSSQL без JSONField — split-column / child-table вместо JSON

**Дата:** 2026-04-30
**Статус:** accepted

### Контекст
Sheet Control v2 (master plan) предполагал хранение `labels {tk,ru,en}`,
`description`, `style`, `triggered_roles`, `UserSheetPreferences.row_order`,
`hidden_rows` в `JSONField`. Проект жёстко на MSSQL и
`.claude/rules/mssql-compat.md` запрещает `models.JSONField` —
эмуляция через NVARCHAR(MAX) теряет индексирование, валидацию и
ломается на запросах.

### Решение
Каждое JSON-поле раскрывается в плоские колонки или дочернюю таблицу:

| Plan field | Реализация на MSSQL |
|---|---|
| `labels {tk,ru,en}` | 3 колонки `label_tk/_ru/_en CharField(120)` с `db_collation='Cyrillic_General_CI_AS'` |
| `description {tk,ru,en}` | 3 колонки `description_tk/_ru/_en CharField(255, blank=True)` |
| `style {width, align, color}` | 3 колонки `style_width PositiveSmallIntegerField`, `style_align CharField(choices)`, `style_color CharField(7)` |
| `triggered_roles []` | Дочерняя таблица `SheetRowRoleTrigger(row FK, role)` с UQ(row, role); заменяет single `triggered_role` |
| `UserSheetPreferences.row_order/hidden_rows` | Дочерняя таблица `UserSheetRowPref(user FK, row FK, position int, is_hidden bool)`, UQ(user, row) |

Сериализатор собирает обратно в JSON-форму на API-уровне (пэйлоад
формата §3.6 master plan не меняется).

### Альтернативы
- `NVARCHAR(MAX)` + ручная JSON serialization — отвергли, теряем
  валидацию и индексы, риск битого JSON.
- MSSQL `JSON_VALUE`/`JSON_QUERY` через RawSQL — отвергли, ломает
  Django ORM, нечитаемо в админке.

### Последствия
- Schema больше колонок, но каждая типизирована и индексируема
- M2M-стиль для ролей и юзер-prefs => явные FK, можно cascade/SET_NULL
- Frontend payload шейп остаётся прежним — UI не видит разницы

---

## ADR-0009: Sheet Control v2 — additive миграция, не пересоздание

**Дата:** 2026-04-30
**Статус:** accepted (overrides master plan §8 "снести старые миграции")

### Контекст
Master plan v2 §8 предлагает снести `0026_sheet_row_setting` /
`0028_alter_sheetrowsetting_triggered_role` и накатить одну новую
миграцию с финальной схемой ("clean cut, реальных данных нет").
Старые миграции уже закоммичены, dev-окружения и тесты CI с ними
синхронизированы.

### Решение
Все изменения Sheet Control v2 идут как additive миграции поверх
существующих:
- `0031_sheet_row_setting_v2_fields.py` — добавляет колонки
  (`display_order`, `is_visible`, `is_locked`, `label_*`,
  `description_*`, `style_*`, `version`, `deleted_at`, `deleted_by`).
- `0032_sheet_row_role_trigger.py` — создаёт `SheetRowRoleTrigger`,
  data-step переносит `triggered_role` → строки в новой таблице,
  колонка `triggered_role` удаляется в этой же миграции.
- `0033_sheet_row_user_permission.py` — создаёт
  `SheetRowUserPermission` + partial UQ.
- `0034_user_sheet_row_pref.py` — создаёт `UserSheetRowPref`.
- `0035_shipment_archive_fields.py` — `is_archived`, `archived_at`
  (Phase 3, отложено).

Старые миграции не трогаем. `field_key` остаётся как unique
technical key; URLs переключаются с `field_key` на `id`.

### Альтернативы
- Squash через `manage.py squashmigrations` — отвергли, не решает
  проблему уже проигранных миграций в чужих окружениях.
- Удалить 0026-0028 и одна новая миграция — отвергли (master plan §8),
  ломает dev-окружения, требует ручного `migrate --fake-zero` каждому.

### Последствия
- История миграций длиннее, но детерминированная
- Data-step в `0032` обязан идти атомарно: backfill → drop колонки в
  одной операции, иначе race
- Откат по миграциям возможен (старые миграции живы)

---

## ADR-0010: Замок строки — выделенное поле `is_locked`, не хак через inactive user

**Дата:** 2026-04-30
**Статус:** accepted (supersedes текущая семантика `triggered_user.is_active=False`)

### Контекст
Сегодня "замок" эмулируется тем, что `triggered_user` указывает на
inactive юзера — `can_edit_sheet_field` возвращает False для всех.
Это документировано как костыль (см. `permissions.py:251-253` и
docstring `SheetRowSetting`). В Sheet Control v2 семантика
`triggered_user`/`extra_users` меняется на "исключение из замка"
(ADR-0001), что прямо конфликтует со старой семантикой.

### Решение
1. Вводим явное `is_locked: BooleanField(default=False)` на
   `SheetRowSetting`.
2. `can_edit_sheet_field` пересобирается под §3.4 master plan:
   - superuser/admin/director → True безусловно;
   - row.deleted_at OR not row.is_visible → False;
   - row.is_locked=True → True только для extra_users (can_edit=True
     и не soft-deleted) ИЛИ для пользователей в triggered_roles;
   - row.is_locked=False → стандартная проверка (triggered_user
     match OR triggered_roles match OR extra_users) AND field-perm.
3. Data-migration этап в `0031`: для каждого `SheetRowSetting`, где
   `triggered_user_id IS NOT NULL` AND `triggered_user.is_active=False`,
   ставим `is_locked=True, triggered_user=NULL`. Лог в console.
4. CheckConstraint `sheet_row_setting_role_xor_user` снимается —
   multi-role и `is_locked` делают XOR неактуальным.

### Альтернативы
- Сохранить старую семантику + добавить `is_locked` поверх — отвергли,
  два способа делать одно и то же запутывают и ломают тесты на грани.
- Только триггерные роли без `is_locked` — отвергли, нельзя выразить
  "никто не может редактировать, кроме списка исключений" одним полем.

### Последствия
- `tests_sheet_perms.py::TestTriggeredUserInactive` переписывается
  как `TestIsLockedRespectsExtraUsers` (новая семантика)
- Существующие данные на dev переехать через data-migration без
  ручного вмешательства
- Frontend SheetRowsTab показывает `is_locked` как Switch, не
  привязанный к жизни пользователя

---

## ADR-0011: Documents Deadline Timer — REMOVED, не возвращать

**Дата:** 2026-05-11
**Статус:** accepted

### Контекст
В DashboardHeader и SheetToolbar был компонент `DeadlineTimer`
(`frontend/src/components/DeadlineTimer.tsx`) — countdown до 13:00
(«срок резначайства») с hard-coded целевым временем, цветными
плашками и i18n-ключами `sheet.deadline_{label,passed,overdue,until}`.

Пользователь уже однажды удалил этот таймер, но он был возвращён
в кодовую базу при последующих изменениях. Чтобы это больше не
повторялось — фиксируем решение явно.

### Решение
1. Компонент `DeadlineTimer` удалён из репозитория.
2. Все использования в `DashboardHeader.tsx` и `SheetToolbar.tsx`
   удалены вместе с импортом.
3. i18n-ключи `sheet.deadline_label`, `sheet.deadline_passed`,
   `sheet.deadline_overdue`, `sheet.deadline_until` удалены из
   `tk.json`, `ru.json`, `en.json`.
4. **Не возвращать** этот таймер в Sheet, Shipments или Dashboard
   ни в каком виде без явной просьбы пользователя.
5. Алерт `dashboard.alert_doc_deadline` (отдельный текстовый
   алерт на DashboardPage) — НЕ затронут этим решением, он не
   является таймером и остаётся как часть Dashboard alerts.

### Альтернативы
- Скрыть через feature flag — отвергли, мёртвый код всё равно
  будет тащиться и кто-то снова включит.
- Оставить компонент, убрать только использования — отвергли,
  компонент всё равно вернётся в импорты при следующем рефакторе
  «общих виджетов».

### Последствия
- Любая будущая фича «дедлайн / countdown» — отдельный ADR с
  обоснованием UX-нужды.
- Если потребуется визуализация SLA — использовать существующий
  механизм stuck-shipments dashboard и SLA-эскалации (ADR-0005),
  а не возвращать UI-таймер на каждый экран.

