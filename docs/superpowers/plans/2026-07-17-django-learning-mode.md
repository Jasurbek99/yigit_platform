# План внедрения: учебная среда Django

**Спек:** `docs/superpowers/specs/2026-07-17-django-learning-mode-design.md`

**Цель:** Дать ученику изолированную копию проекта, где можно ломать что угодно, не задев боевую базу — и файл курса, переживающий снос песочницы.

**Подход:** git worktree с собственной `.env`, указывающей на локальную MSSQL `YIGIT_LEARN`. Переиспользуем существующий `backend/venv` — отдельный не нужен, пакеты те же.

**Не TDD.** Это настройка среды, а не код. Тестов писать не на что; вместо них — проверка после каждого шага (команда + ожидаемый вывод).

## Глобальные ограничения

- **Коммиты только по явному слову пользователя** (`CLAUDE.md`: «Never commit or push without explicit instruction»). Шаги с коммитом ниже — заготовки, выполнять по команде.
- **Боевая база `YIGIT_PLATFROM` на `10.10.11.233\YIGIT` не должна быть затронута ни одной командой этого плана.**
- Коллация учебной БД: `Cyrillic_General_CI_AS` (`.claude/rules/mssql-compat.md`).
- Учебные реквизиты — локальный сервер, `YigitTestUser` / `TestPassword123!` / `localhost` (`backend/.env.example`).

---

### Задача 1: Worktree и ветка

**Файлы:**
- Создать: `d:\projects\yigit_learn\` (worktree, ветка `learn/django`)

**Результат:** отдельная папка с копией проекта, `git status` в ней чистый, `.env` отсутствует.

- [ ] **Шаг 1: Создать worktree с новой веткой от main**

```bash
cd /d/projects/yigit_platform
git worktree add -b learn/django /d/projects/yigit_learn main
```

Ожидается: `Preparing worktree (new branch 'learn/django')` + `HEAD is now at ff5a11b ...`

- [ ] **Шаг 2: Убедиться, что .env НЕ скопировался**

```bash
ls /d/projects/yigit_learn/backend/.env
```

Ожидается: `No such file or directory` — **это успех, а не ошибка.** Именно это делает боевую базу недосягаемой.

- [ ] **Шаг 3: Убедиться, что Django без .env не стартует**

```bash
cd /d/projects/yigit_learn/backend && /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py check
```

Ожидается: `RuntimeError: DB_PASSWORD is not set...` — защита конструкцией работает.

---

### Задача 2: Учебная база YIGIT_LEARN

**Файлы:**
- Создать: `d:\projects\yigit_learn\backend\.env` (gitignored, не коммитится)

**Результат:** `manage.py migrate` в worktree наполняет `YIGIT_LEARN`, боевая база нетронута.

- [ ] **Шаг 1: Создать базу на локальном сервере**

```bash
/d/projects/yigit_platform/backend/venv/Scripts/python.exe -c "
import pyodbc
cn = pyodbc.connect('DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;UID=YigitTestUser;PWD=TestPassword123!;TrustServerCertificate=yes', autocommit=True)
cn.execute(\"IF DB_ID('YIGIT_LEARN') IS NULL CREATE DATABASE YIGIT_LEARN COLLATE Cyrillic_General_CI_AS\")
print('OK')
"
```

Ожидается: `OK`. Если ошибка подключения — локальный MSSQL не запущен; см. «Риски» ниже.

- [ ] **Шаг 2: Написать учебную .env**

Скопировать `backend/.env.example` в `d:\projects\yigit_learn\backend\.env` и заменить блок Database на:

```
DB_NAME=YIGIT_LEARN
DB_USER=YigitTestUser
DB_PASSWORD=TestPassword123!
DB_HOST=localhost
DB_PORT=
```

Остальные ключи (`SECRET_KEY`, `DJANGO_DEBUG=True`, CORS/CSRF, TEST_DB_*) — как в примере.

- [ ] **Шаг 3: Проверить, что подключились именно к учебной базе**

```bash
cd /d/projects/yigit_learn/backend && /d/projects/yigit_platform/backend/venv/Scripts/python.exe -c "
import django, os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); django.setup()
from django.conf import settings
print(settings.DATABASES['default']['NAME'], '@', settings.DATABASES['default']['HOST'])
"
```

Ожидается: `YIGIT_LEARN @ localhost`. **Если увидишь `YIGIT_PLATFROM` или `10.10.11.233` — СТОП**, `.env` не подхватилась.

- [ ] **Шаг 4: Накатить миграции**

```bash
cd /d/projects/yigit_learn/backend && /d/projects/yigit_platform/backend/venv/Scripts/python.exe manage.py migrate
```

Ожидается: длинный список `Applying ... OK`. Это же — материал Урока 3.

---

### Задача 3: Файл курса

**Файлы:**
- Создать: `d:\projects\yigit_platform\docs\learning\CURRICULUM.md` (на ветке **main**, не в worktree)

**Результат:** чеклист из 10 уроков с галочками; переживает снос песочницы.

- [ ] **Шаг 1: Создать `docs/learning/CURRICULUM.md`**

Содержимое: таблица 10 уроков из спека (колонки: №, урок, «что смогу объяснить», галочка), ссылка на спек, напоминание про 71 падающий тест.

- [ ] **Шаг 2: Коммит — ТОЛЬКО по слову пользователя**

```bash
cd /d/projects/yigit_platform
git add docs/superpowers/specs/2026-07-17-django-learning-mode-design.md \
        docs/superpowers/plans/2026-07-17-django-learning-mode.md \
        docs/learning/CURRICULUM.md
git commit -m "docs: add Django learning mode spec, plan and curriculum"
```

---

## Риски

**Локальный MSSQL может быть не запущен.** Задача 2 тогда падает на шаге 1. Это **не блокирует обучение**: уроки 1–5 разбирают чтение кода, а ключевое упражнение (`str(qs.query)` → какой SQL) не требует ни подключения, ни данных. Если сервер не поднимется — начинаем Урок 1 без базы и чиним её к Уроку 3 (миграции), где она впервые реально нужна.

**Порядок исполнения:** Задача 3 (файл курса) не зависит от Задач 1–2. При проблемах с БД делать её первой и начинать Урок 1.
