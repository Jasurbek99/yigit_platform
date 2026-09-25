# Мерж и миграции: что осталось (состояние на 2026-09-25)

Один список, чтобы ничего не терялось между сообщениями. Отмечай `[x]`, когда сделано.

---

## 1. Сделано (для справки)

- [x] PR #18 Gapy-Satyş terminal смержен (`e1240daa`), миграций в нём нет
- [x] PR #19 пересчёт задач смержен (`05b01dc8`)
- [x] Миграции применены к общей базе: `export/0078`, `0079`, `0080`. `migrate --plan` → «No planned migration operations»
- [x] Исправлена путаница с Gapy: в базе миграция была записана как `0076_gapy_driver_passports`, файл переименовали в `0077`.
      2026-09-24 выполнено `migrate export 0077_gapy_driver_passports --fake`. Колонки уже были, схема не менялась

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
  `feat/gapy-terminal`, `feat/task-condition-reconcile`
- [ ] Удалить папки `ygt_gapy` и `ygt_taskreconcile` (всё смержено)
- [ ] Решить сам (в них есть коммиты, которых нет в main): `wip/quality-inspector` (1 коммит),
      `feature/copy-sera-butce-ui` (4, старая), `backup/pre-rebase-2026-09-11`
- [ ] `yigit_learn` (учебная база `YIGIT_LEARN`): не трогаю без твоего слова
- [ ] Старый stash `contracts/CMR WIP` (`feat/supply-draft-creation`): решить, нужен ли

---

## 3. Gaplama (`feat/gaplama-batches`): миграции перед мержем

Над веткой сейчас работает другая сессия (папка `ygt_gaplama_batches`). Не трогать, пока она не закончит.

| Миграция в ветке | В базе? | Конфликт с main | Что сделать |
|---|---|---|---|
| `core/0059_greenhouseconfig_gaplama_carry_days` | **Применена** | в main тоже есть `core/0059_country_border_point` | **Не переименовывать.** Оставить как есть |
| `core/0060_greenhouseblock_carry_days` | Нет | — | Добавить в её `dependencies` ещё `("core", "0059_country_border_point")`: она станет merge-миграцией для двух 0059 |
| `export/0077_block_source_batch_key` | Нет | в main есть `export/0077_gapy_driver_passports`, последняя уже `0080` | Переименовать в `0081_block_source_batch_key`, зависимость: `("export", "0080_task_one_per_shipment_rule")` |

Проверки перед мержем Gaplama:
- [ ] `showmigrations core export`: ничего лишнего не висит
- [ ] `makemigrations --check`: нет новых миграций
- [ ] `migrate --plan`: только `core/0060` и `export/0081`

⚠️ **Пока Gaplama не смержена:** в базе уже есть колонка `core_greenhouse_config.gaplama_carry_days`
(NOT NULL, без значения по умолчанию), а код main о ней не знает. Сейчас это безопасно: в таблице 1 строка,
новых код main не создаёт. **Не создавать новые строки GreenhouseConfig** (не делать seed, не пересоздавать базу), пока Gaplama не в main.

---

## 4. Правило, чтобы не повторилось

- Перед новой миграцией: `ls backend/apps/<app>/migrations/ | tail -3` **и** `git log --oneline origin/main -5`
- **Никогда не переименовывать применённую миграцию** (так и случилась история с Gapy `0076 → 0077`).
  Переименовывать можно только ту, которой нет в `showmigrations` как `[X]`
- Если две ветки сделали одинаковый номер: переименовывать ту, что **не применена**, либо делать merge-миграцию
