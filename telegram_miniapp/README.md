# Trainer Telegram Mini App

Текущий `Trainer` — это Telegram Mini App с собственным backend API на SQLite, Telegram-ботом, browser debug-режимом и CI/deploy цепочкой на VPS.

Этот документ отвечает на технический вопрос “из чего это собрано, как запустить, как тестировать и как выкатывать”.

Продуктовая спецификация лежит отдельно:

- [BUSINESS_LOGIC.md](../BUSINESS_LOGIC.md)

## Что входит в текущую систему

- [telegram_miniapp/web](./web) — frontend Mini App
- [telegram_miniapp/server.py](./server.py) — HTTP API, Telegram auth/session resolve, раздача статики
- [telegram_miniapp/backend_store.py](./backend_store.py) — SQLite storage
- [telegram_miniapp/bot.py](./bot.py) — Telegram-бот
- [telegram_miniapp/dev_server.py](./dev_server.py) — локальный dev launcher с autoreload
- [tests](../tests) — unit, integration и browser e2e тесты

## Текущее поведение продукта с технической точки зрения

Сейчас Mini App умеет:

- запускаться из Telegram и резолвить signed user context;
- fallback-иться в `telegram_unsafe` или `telegram_recovery`, если Telegram launch payload пришёл неполным;
- работать в локальном браузере как debug-user;
- показывать три экрана:
  - `Trainings`
  - `Progress`
  - `Weight`
- открывать новую тренировку через FAB на `Trainings`;
- восстанавливать живой draft тренировки из `localStorage`;
- стартовать `New Workout` сразу с preview-карточками основной шестёрки упражнений;
- использовать одну и ту же общую план-логику для:
  - reference-строки `прошлое выполнение → план`
  - быстрого planned add
  - стартовых значений set-modal
  - кольцевого прогресса вокруг FAB
- хранить per-set `effort` (`easy / ok / hard`) и показывать его как `🙂 / 😐 / 😣`;
- удалять сет или упражнение через центрированную modal-карточку по long press;
- хранить и удалять записи веса тела через backend.

## Основные HTTP endpoints

- `GET /api/health`
- `GET /api/dev/version`
- `POST /api/session/resolve`
- `POST /api/session/logout`
- `POST /api/telegram/auth`
- `GET /api/workouts`
- `POST /api/workouts`
- `PUT /api/workouts/{id}`
- `DELETE /api/workouts/{id}`
- `GET /api/body-weights`
- `POST /api/body-weights`
- `DELETE /api/body-weights/{id}`
- `GET /api/recommendations/next`
- `POST /api/recommendations/refresh`

Для нативного iOS personal-build `POST /api/session/resolve` принимает `shell=ios` и `native_user_id=3`: backend выдаёт обычную `trainer_session` для уже существующего пользователя с этим `id`.

## Совет тренера (LLM-рекомендация)

`recommender.py` строит план следующей тренировки по истории пользователя через Claude
Messages API (structured outputs, чистый stdlib `urllib` — без SDK/venv). Хранится одна
строка на пользователя в таблице `recommendations` (статусы `none`/`pending`/`ready`/`failed`).

- `GET /api/recommendations/next` — мгновенно отдаёт кэш (или `status: none`), не ждёт генерации; в ответе есть флаг `stale` (есть ли тренировка новее той, по которой считали).
- `POST /api/recommendations/refresh` — синхронная форс-генерация (10–40 с), per-user lock + анти-дребезг.
- После создания/изменения/удаления тренировки рекомендация перегенерируется в фоновом потоке.

Формат рекомендации: `focus`, `load_type` (heavy/medium/light), развёрнутый `rationale`
(почему именно такой план) и `exercises[]` с `exercise_id`/`name`/`note`/`sets[{reps,weight}]`.
Требуется `ANTHROPIC_API_KEY`; без него генерация отвечает понятной ошибкой, остальные
эндпоинты работают как прежде.

## Локальный запуск

### 1. Запуск backend и статики

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF python3 telegram_miniapp/server.py
```

После запуска приложение доступно на:

```text
http://127.0.0.1:8080/
```

В этом режиме:

- backend и статика поднимаются вместе;
- SQLite хранится локально;
- браузер без Telegram может автоматически получить debug-user;
- UI-состояния вроде draft/tab/range живут в `localStorage`.

Отдельная debug-страница для Telegram stub-сценариев:

```text
http://127.0.0.1:8080/stub.html
```

### 2. Dev-режим с автообновлением

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF python3 telegram_miniapp/dev_server.py
```

Launcher:

- следит за `.py` файлами и перезапускает backend;
- даёт live reload фронта;
- держит приложение на `http://127.0.0.1:8080/`.

## Запуск Telegram-бота

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF WEB_APP_URL=https://trainer-miniapp.example.com python3 telegram_miniapp/bot.py
```

Бот:

- выставляет menu button `Trainer`;
- отвечает на `/start`, `/menu`, `/help`;
- открывает Mini App по `WEB_APP_URL`.

## Что важно понимать про клиентскую логику

### Draft и план тренировки

- источник прошлой тренировки ищется по последнему релевантному выполнению упражнения;
- planned set = прошлый set с `+1` к повторениям;
- быстрый тап по синему `+` добавляет следующий planned set;
- long press по синему `+` открывает ручной ввод;
- reference-строка и set-modal обязаны использовать один и тот же плановый helper.

### Per-set effort

У каждого сета может быть:

- `easy`
- `ok`
- `hard`
- `null`

На UI это отображается как:

- `🙂`
- `😐`
- `😣`

Effort хранится в backend, проходит нормализацию в store и используется в summary-строках без свободного текстового комментария.

### Прогресс-кольцо вокруг FAB

Кольцо вокруг FAB на `Trainings` и `New Workout` считается по основной шестёрке упражнений.

Важно:

- прогресс считается не по факту “у упражнения появился хотя бы один сет”;
- он считается дробно по количеству выполненных planned sets относительно полного плана упражнения;
- кольцо анимируется вперёд и назад при изменении draft-state.

### Telegram shell

При инициализации frontend старается:

- вызвать `disableVerticalSwipes()`;
- вызвать `requestFullscreen()`.

Это улучшает полноэкранный UX в Telegram-клиентах, которые поддерживают соответствующий Bot API WebApp surface.

## Полезные переменные окружения

### Для `server.py`

- `BOT_TOKEN` — включает серверную валидацию Telegram `initData`
- `MINIAPP_STATIC_DIR`
- `MINIAPP_HOST` — по умолчанию `127.0.0.1`
- `MINIAPP_PORT` — по умолчанию `8080`
- `MINIAPP_MAX_AUTH_AGE`
- `MINIAPP_DEV_MODE`
- `MINIAPP_ALLOW_DEBUG_USER`
- `MINIAPP_DEFAULT_DEBUG_USER_ALIAS`
- `MINIAPP_DEFAULT_DEBUG_USER_FIRST_NAME`
- `MINIAPP_DEFAULT_DEBUG_USER_LAST_NAME`
- `MINIAPP_DB_PATH`
- `MINIAPP_SESSION_SECRET`
- `MINIAPP_SESSION_MAX_AGE`
- `MINIAPP_COOKIE_SECURE`
- `MINIAPP_TELEGRAM_RECOVERY_USER_ID`

#### Совет тренера (LLM)

- `ANTHROPIC_API_KEY` — ключ Claude API (обязателен для генерации рекомендаций)
- `ANTHROPIC_MODEL` — модель, по умолчанию `claude-opus-4-8`
- `ANTHROPIC_MAX_TOKENS` — лимит вывода, по умолчанию `2500`
- `ANTHROPIC_TIMEOUT` — таймаут запроса к Claude в секундах, по умолчанию `90`
- `RECOMMENDATION_HISTORY_LIMIT` — сколько последних тренировок отдавать модели, по умолчанию `20`
- `RECOMMENDATION_REFRESH_MIN_INTERVAL` — анти-дребезг ручного refresh в секундах, по умолчанию `10`

### Для `bot.py`

- `BOT_TOKEN`
- `WEB_APP_URL`
- `BOT_POLL_TIMEOUT`

## Что проверять вручную

В актуальном интерфейсе должны быть:

- вкладки `Trainings`, `Progress`, `Weight`;
- FAB `+` на `Trainings`;
- swipe edit/delete у карточек истории тренировок;
- восстановление живого draft;
- preview-карточки основной шестёрки в `New Workout`;
- compact reference-строка `прошлое выполнение → план`;
- быстрый planned add по синему `+`;
- long press по синему `+` как ручной set-modal;
- выбор `effort` в set-modal;
- центрированная modal-карточка удаления по long press на карточке упражнения;
- экран `Weight` с inline composer и удалением записи по точке графика.

## Локальный запуск тестов

Быстрый прогон:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m unittest discover -s tests -p "test_*.py" -v
```

Полный прогон:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m unittest discover -s tests -p "test_*.py" -v
```

## Деплой на VPS

Для текущего VPS есть готовый скрипт:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
./telegram_miniapp/deploy/deploy.sh web
```

Другие варианты:

```bash
./telegram_miniapp/deploy/deploy.sh backend
./telegram_miniapp/deploy/deploy.sh bot
./telegram_miniapp/deploy/deploy.sh all
```

Текущие значения по умолчанию в deploy tooling:

- `root@89.124.83.32`
- `/opt/trainer-miniapp`
- `trainer-miniapp-backend.service`
- `trainer-miniapp-bot.service`

## GitHub Actions

Основной workflow:

- [ci.yml](../.github/workflows/ci.yml)

Что делает `ci.yml`:

- детектит, менялись ли `web`, `backend`, `bot`;
- прогоняет полный test suite;
- после успешного test job на `main` запускает только релевантные deploy workflows.

Reusable workflows:

- [deploy-web.yml](../.github/workflows/deploy-web.yml)
- [deploy-backend.yml](../.github/workflows/deploy-backend.yml)
- [deploy-bot.yml](../.github/workflows/deploy-bot.yml)

Важно:

- deploy не должен происходить без зелёных тестов;
- backend workflow предполагает существование `/etc/trainer-miniapp/backend.env` на VPS;
- bot workflow предполагает существование `/etc/trainer-miniapp/bot.env` на VPS.

### GitHub Secrets

Нужны:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` — опционально
