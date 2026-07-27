# Django: курс по проекту YGT Platform

**Дизайн курса:** [`docs/superpowers/specs/2026-07-17-django-learning-mode-design.md`](../superpowers/specs/2026-07-17-django-learning-mode-design.md)
**Начат:** 2026-07-17
**Ритм:** 30–60 мин ежедневно

## Учебная среда

| Что | Где |
|-----|-----|
| Песочница (можно ломать всё) | `d:\projects\yigit_learn`, ветка `learn/django` |
| Учебная база | `YIGIT_LEARN` на `localhost` (83 таблицы) |
| Python | `d:\projects\yigit_platform\backend\venv\Scripts\python.exe` |
| Боевая база | `YIGIT_PLATFROM` @ `10.10.11.233\YIGIT` — **в песочнице недосягаема** |

Django shell в песочнице:

```bash
cd /d/projects/yigit_learn/backend
/d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py shell
```

**Почему песочница безопасна:** `.env` лежит в `.gitignore`, поэтому `git worktree add` её не скопировал. Без `DB_PASSWORD` Django вообще отказывается стартовать (`config/settings.py:170`). Учебная `.env` создана вручную и указывает только на `localhost`. Боевой базы в этой копии не существует.

## ⚠️ Прежде чем запускать тесты

**71 тест из 351 падает уже сейчас** — давняя известная проблема, 4 группы причин. См. [`docs/PRE_EXISTING_TEST_FAILURES.md`](../PRE_EXISTING_TEST_FAILURES.md). Красный прогон — **не твоя вина.**

## Фаза 1: чтение

Сквозная линия — один реальный запрос `GET /api/v1/export/shipments/`, прослеженный от URL до SQL и обратно до JSON.

| # | Урок | Смогу объяснить | ✓ |
|---|------|-----------------|---|
| 1 | Карта: приложения, `settings.py`, `urls.py` | Из чего состоит Django-проект | [ ] |
| 2 | Модель `Shipment` | Как класс Python становится таблицей | [ ] |
| 3 | Миграции | Что делает `makemigrations`, как читать миграцию | [ ] |
| 4 | QuerySet | Ленивость, `.query`, N+1, `select_related` | [ ] |
| 5 | Сериализатор | Почему `code` в БД → `shipment_code` в API | [ ] |
| 6 | ViewSet + роутер + permissions | Кто что имеет право видеть | [ ] |
| 7 | Аутентификация | Почему JWT в httpOnly cookie, а не в localStorage | [ ] |
| 8 | Тесты | Как устроен `tests_task_api.py` | [ ] |
| 9 | Бизнес-логика | `transition_to()`; почему запрещены сигналы | [ ] |
| 10 | Сборка | Весь путь запроса целиком, самостоятельно | [ ] |

**Урок засчитан, только когда ты пересказал его своими словами.** Не «понятно», а «могу объяснить». Это единственная честная проверка — и ровно тот навык, который нужен, когда о проекте спросят вживую.

## Фаза 2: гибрид

Спроектируем после Фазы 1: пишешь сам → сравниваем с реальным кодом `export/`.

## Мои заметки

Сюда — то, что понял своими словами, и вопросы, оставшиеся открытыми.
