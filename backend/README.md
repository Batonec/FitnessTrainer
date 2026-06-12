# Trainer Backend

Backend для приложения `Trainer`: HTTP API на стандартной библиотеке Python + SQLite.
Обслуживает нативный iOS-клиент (см. [../ios](../ios)) и MCP-сервер
[../coach_mcp](../coach_mcp). Веб-мини-апп и Telegram-бот удалены (июнь 2026).

Продуктовая спецификация — в [BUSINESS_LOGIC.md](../BUSINESS_LOGIC.md).

## Состав

- [backend/server.py](./server.py) — HTTP API, резолв сессии (iOS fixed-user + browser debug), раздача каталога упражнений
- [backend/backend_store.py](./backend_store.py) — SQLite-хранилище и нормализация данных
- [backend/recommender.py](./recommender.py) — «Совет тренера»: генерация рекомендации через Claude API
- [backend/static/data/exercises.json](./static/data/exercises.json) — каталог упражнений (отдаётся клиенту по `/data/exercises.json`)
- [backend/deploy](./deploy) — деплой на VPS
- [backend/tests](./tests) — тесты backend

## HTTP endpoints

- `GET /api/health`
- `GET /api/dev/version`
- `POST /api/session/resolve` — iOS fixed-user (`shell=ios` + `native_user_id`) либо browser debug
- `POST /api/session/logout`
- `GET /api/workouts` · `POST /api/workouts` · `PUT /api/workouts/{id}` · `DELETE /api/workouts/{id}`
- `GET /api/body-weights` · `POST /api/body-weights` · `DELETE /api/body-weights/{id}`
- `GET /api/recommendations/next` · `POST /api/recommendations/refresh`

Каталог упражнений отдаётся как статика по `GET /data/exercises.json` (его читает и iOS-клиент,
и `recommender.py`).

### Сессии

- **Native iOS fixed user** — iOS присылает `shell=ios` и `native_user_id` в `POST /api/session/resolve`;
  backend находит пользователя с этим `id` и выдаёт подписанную cookie `trainer_session`. Это
  personal-build режим, не рассчитанный на публичный multi-user доступ.
- **Browser debug user** — для локальной разработки (`MINIAPP_ALLOW_DEBUG_USER=1`) браузер без
  сессии автоматически получает debug-пользователя.

## Совет тренера (LLM-рекомендация)

`recommender.py` строит план следующей тренировки по истории пользователя через Claude
Messages API (structured outputs, чистый stdlib `urllib` — без SDK/venv). Хранится одна
строка на пользователя в таблице `recommendations` (статусы `none`/`pending`/`ready`/`failed`).

- `GET /api/recommendations/next` — мгновенно отдаёт кэш (или `status: none`), не ждёт генерации;
  в ответе есть флаг `stale` (есть ли тренировка новее той, по которой считали).
- `POST /api/recommendations/refresh` — синхронная форс-генерация (10–40 с), per-user lock + анти-дребезг.
- После создания/изменения/удаления тренировки рекомендация перегенерируется в фоновом потоке.

Формат: `focus`, `load_type` (heavy/medium/light), развёрнутый `rationale` (почему именно
такой план) и `exercises[]` с `exercise_id`/`name`/`note`/`sets[{reps,weight}]`. Требуется
`ANTHROPIC_API_KEY`; без него генерация отвечает понятной ошибкой, остальные эндпоинты работают.

## Локальный запуск

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
MINIAPP_ALLOW_DEBUG_USER=1 python3 backend/server.py
```

API поднимается на `http://127.0.0.1:8080/`, SQLite — локально. iOS-клиент собирается
из [../ios](../ios) в Xcode.

## Переменные окружения

### `server.py`

- `MINIAPP_HOST` — по умолчанию `127.0.0.1`
- `MINIAPP_PORT` — по умолчанию `8080`
- `MINIAPP_STATIC_DIR` — каталог со статикой (`static/`), откуда отдаётся `/data/exercises.json`
- `MINIAPP_DB_PATH` — путь к SQLite
- `MINIAPP_SESSION_SECRET` — секрет для подписи cookie `trainer_session`
- `MINIAPP_SESSION_MAX_AGE` · `MINIAPP_COOKIE_SECURE`
- `MINIAPP_DEV_MODE` · `MINIAPP_ALLOW_DEBUG_USER` — включают browser debug-пользователя
- `MINIAPP_DEFAULT_DEBUG_USER_ALIAS` / `_FIRST_NAME` / `_LAST_NAME`

### Совет тренера (LLM)

- `ANTHROPIC_API_KEY` — ключ Claude API (обязателен для генерации)
- `ANTHROPIC_MODEL` — модель, по умолчанию `claude-opus-4-8`
- `ANTHROPIC_MAX_TOKENS` — лимит вывода, по умолчанию `2500`
- `ANTHROPIC_TIMEOUT` — таймаут запроса к Claude, по умолчанию `90`
- `RECOMMENDATION_HISTORY_LIMIT` — сколько последних тренировок отдавать модели, по умолчанию `20`
- `RECOMMENDATION_REFRESH_MIN_INTERVAL` — анти-дребезг ручного refresh в секундах, по умолчанию `10`

## Тесты

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m unittest discover -s backend/tests -p "test_*.py" -v
```

## Деплой на VPS

Backend деплоится через CI ([../.github/workflows/deploy-backend.yml](../.github/workflows/deploy-backend.yml))
после зелёных тестов на `main`, либо вручную:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
./backend/deploy/deploy.sh backend
```

Значения по умолчанию в deploy tooling:

- `root@89.124.83.32`
- `/opt/trainer-miniapp` (исторический путь на VPS, не переименовывался)
- `trainer-miniapp-backend.service`

Backend workflow предполагает существование `/etc/trainer-miniapp/backend.env` на VPS
(там же лежит `ANTHROPIC_API_KEY`).

## GitHub Actions

- [ci.yml](../.github/workflows/ci.yml) — прогоняет тесты на каждый push; на `main` после
  зелёных тестов деплоит backend, если он затронут.
- [deploy-backend.yml](../.github/workflows/deploy-backend.yml) — reusable деплой backend.

Нужные GitHub Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT` (опционально).
