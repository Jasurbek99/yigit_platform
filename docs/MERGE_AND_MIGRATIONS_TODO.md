# Мерж и миграции: что осталось (состояние на 2026-09-25)

Один список, чтобы ничего не терялось между сообщениями. Отмечай `[x]`, когда сделано.

---

## 1. Сделано (для справки)

- [x] PR #18 Gapy-Satyş terminal смержен (`e1240daa`), миграций в нём нет
- [x] PR #19 пересчёт задач смержен (`05b01dc8`)
- [x] Миграции применены к общей базе: `export/0078`, `0079`, `0080`. `migrate --plan` → «No planned migration operations»
- [x] Исправлена путаница с Gapy: в базе миграция была записана как `0076_gapy_driver_passports`, файл переименовали в `0077`.
      2026-09-24 выполнено `migrate export 0077_gapy_driver_passports --fake`. Колонки уже были, схема не менялась
- [x] PR #20 Gaplama batches смержен (`e72e6837`). Миграции `core/0060-0063`, `export/0081` применены к общей
      базе. Исправлены по review 3 из 4 находок (§5), 4-я отложена отдельным PR
- [x] PR #21 «draft → Подготовка/Preparation/Taýýarlyk» смержен (`d770353b`, 2026-09-26). Миграция `core/0064`
      применена к общей базе. Review: 1 находка (пропущенный `comment='assigned from draft'` в activity log
      рейса) — исправлена. Тесты: backend 29/29 (свои), frontend 1061/1061, tsc чисто

---

## 2. Твои действия

### 2.1 Ручная проверка (ничего не проверялось в браузере)
- [ ] PR #18 Gapy: пункты (1)–(12) в `BUILD_TEST_LOG.md`. Минимум:
  - Gapy Satyş → заполнить строку 21 → статус **Tamamlandy**
  - Adaty → **Ýola çykdy**
  - Sales Reports → «All»: у Gapy «—», не красное «Missing»
- [ ] PR #19 задачи: пункты (1)–(10) в `BUILD_TEST_LOG.md`. Минимум:
  - Gapy satys Нет→Да: задачи поменялись, **статус не сдвинулся**
  - Галочку поставить и снять: ничего не произошло
  - Swap Peregruz между двумя рейсами: у каждого задачи под новое значение
- [ ] PR #20 Gaplama: запись в `BUILD_TEST_LOG.md` от 2026-09-25 («Gaplama Üýtget edit…»). Минимум:
  - Редактировать существующий грузовик (Üýtget) — сплит и общий вес обновляются одним запросом
  - Роль без права на `weight_net` не может отредактировать — и партии тоже не переписываются
- [ ] PR #21 «Подготовка»: запись в `BUILD_TEST_LOG.md` от 2026-09-24. Минимум:
  - Рейс в старом статусе draft — в детали, списке, Sheet и на доске статус читается «Подготовка» /
    «Preparation» / «Taýýarlyk», не «Черновик» / «Draft» / «Garalama»
  - Лента активности рейса, который прошёл через сборку (assign) — комментарий там тоже без слова draft
  - Quota dashboard и local sell plan по-прежнему говорят «черновик» — так и задумано, не баг
  - Admin → Block Management: `carry_days = 0` отклоняется
- [ ] После проверки отметь `[x]` в `BUILD_TEST_LOG.md` (или скажи мне)

### 2.2 Деплой на beta (10.10.11.25)
- [ ] После `git pull` на сервере выполнить `migrate`
  - Если beta работает с той же базой, миграции уже применены, `migrate` ничего не сделает. Это нормально
  - Если упадёт на `0077_gapy_driver_passports` (колонки уже есть): `migrate export 0077_gapy_driver_passports --fake`, потом снова `migrate`
- [ ] Пересобрать celery-контейнеры (правило из памяти: после деплоя)

### 2.3 Уборка (решить, когда удобно)
- [ ] Скопировать 29 media-файлов из старых папок в `yigit_platform/backend/media/`:
  - `yigit_split`: 21 сертификат качества
  - `yigit_merge_trial`: 2 контракта PDF, паспорт водителя, документ на грузовик
  - `yigit_merge_base`: 2 контракта PDF
- [ ] Потом удалить папки `yigit_split`, `yigit_merge_trial`, `yigit_merge_base`
- [ ] Удалить ветки, которые уже в main (локально и на GitHub):
  `feat/quality-and-taskrules`, `merge/gadams-trial`, `Copy_Gadams_UI`, `feat/transport-fleet-map`, `learn/django`,
  `feat/gapy-terminal`, `feat/task-condition-reconcile`, `feat/gaplama-batches`, `feat/prep-label`
- [ ] Удалить папки `ygt_gapy`, `ygt_taskreconcile`, `ygt_gaplama_batches`, `ygt_prep_label` (всё смержено)
- [ ] Решить сам (в них есть коммиты, которых нет в main): `wip/quality-inspector` (1 коммит),
      `feature/copy-sera-butce-ui` (4, старая), `backup/pre-rebase-2026-09-11`
- [ ] `yigit_learn` (учебная база `YIGIT_LEARN`): не трогаю без твоего слова
- [ ] Старый stash `contracts/CMR WIP` (`feat/supply-draft-creation`): решить, нужен ли

---

## 3. Gaplama (`feat/gaplama-batches`, PR #20): миграции — УЖЕ ИСПРАВЛЕНЫ ✅

Другая сессия переномеровала их 2026-09-25, до того как я начал проверку PR. Финальное состояние:

| Миграция | В базе? | Зависимость |
|---|---|---|
| `core/0059_greenhouseconfig_gaplama_carry_days` | Применена | — |
| `core/0060_greenhouseblock_carry_days` | Применена | `core/0059_greenhouseconfig_gaplama_carry_days` |
| `core/0061_alter_greenhouseblock_carry_days` | Применена | `core/0060` |
| `core/0062_merge_carry_days_and_border_point` | Применена | `core/0059_country_border_point` + `core/0061` (merge-миграция) |
| `core/0063_greenhouseblock_carry_days_min` | Применена (мой фикс 2026-09-25) | `core/0062` |
| `export/0081_block_source_batch_key` | Применена | `export/0080_task_one_per_shipment_rule` |

Проверено: `showmigrations core export` — всё `[X]`; `makemigrations --check` — чисто;
`migrate --plan` на ветке — «No planned migration operations». Конфликтов с main нет.

---

## 4. Правило, чтобы не повторилось

- Перед новой миграцией: `ls backend/apps/<app>/migrations/ | tail -3` **и** `git log --oneline origin/main -5`
- **Никогда не переименовывать применённую миграцию** (так и случилась история с Gapy `0076 → 0077`).
  Переименовывать можно только ту, которой нет в `showmigrations` как `[X]`
- Если две ветки сделали одинаковый номер: переименовывать ту, что **не применена**, либо делать merge-миграцию

---

## 5. PR #20 review: 3 из 4 находок исправлены, 4-я — отдельным PR

Внешний ревью нашёл 3 проблемы (P1/P2), плюс мой собственный review — ещё 2. Статус:

- [x] `carry_days` без минимума на сервере — `1830c898`
- [x] Отрицательный `weight_kg` в `set_block_sources` — `7e06a445`
- [x] Редактирование грузовика (Üýtget) двумя независимыми запросами (split + weight_net) —
      объединено в одну транзакцию, право на `weight_net` проверяется до записи — `f9737349`
- [ ] **Отложено, нужен отдельный PR:** сервер не защищает остатки блока от одновременного
      перерасхода. Проверка «хватает ли kg» сейчас только в браузере (`rowInvalid` в
      `GaplamaTruckForm.tsx`); `skip_forecast_check: true` на create отключает серверную проверку
      намеренно (Sheet R8 и supply-column drafts обязаны её обходить). Два оператора, видя один
      остаток, могут оба создать грузовик и вместе выбрать больше, чем есть.
      **Что нужно:** вынести функцию расчёта доступности из `build_gaplama_board`
      (`backend/apps/export/services/gaplama.py`, 347 строк, FIFO/batch-walk с доказанными
      инвариантами — не тривиально), залочить нужные строки в транзакции записи
      (`select_for_update`), повторить на сервере то же асимметричное правило, что на фронтенде
      (уменьшение/без изменений — всегда можно, растёт только до текущего остатка). Часы работы,
      не минуты — отложено по согласованию с пользователем 2026-09-25, PR #20 мержится без этого.
- [ ] Мелочи из review (не блокируют): дублирующаяся строка «Serhet nokady» в
      `BUILD_TEST_LOG.md:207-208`; отсутствие проверки на отрицательный `weight_kg` в
      `set_block_sources`'s override (тот же класс проблемы — уже прикрыт негативной проверкой
      выше, но стоит перепроверить после мержа); мёртвое поле `GreenhouseConfig.gaplama_carry_days`
      в конфиге без UI-подсказки, что оно не используется.
