# Trainer Telegram Mini App

Текущий `Trainer` — это Telegram Mini App с собственным backend API на SQLite, Telegram-ботом и browser debug-режимом для локальной разработки.

## Что есть сейчас

- Telegram-бот выставляет menu button `Trainer` и команду `/start`;
- Mini App работает как полноценный web-интерфейс;
- backend хранит:
  - пользователей;
  - тренировки;
  - записи веса тела;
- обычный браузер без Telegram может автоматически входить как debug-user;
- если Telegram не прислал signed `initData`, сервер умеет fallback/recovery режимы;
- новая тренировка создаётся через FAB на экране `Trainings`;
- сохранённый draft восстанавливается после перезагрузки;
- экран `New Workout` сразу показывает preview-карточки основных упражнений из реальной истории, а не пустой picker;
- быстрый tap по синему `+` в карточке упражнения добавляет planned set по прошлой тренировке;
- long press по синему `+` открывает ручной set-modal;
- long press по самой карточке упражнения открывает bottom sheet с удалением последнего сета или всего упражнения;
- set-modal закрывается тапом вне модалки и использует компактные stepper-контролы для веса и повторений;
- экран `Weight` работает на backend и умеет удалять запись по тапу на точку графика;
- старая debug-заглушка по-прежнему доступна отдельно как `stub.html`.

## Структура

- [telegram_miniapp/server.py](./server.py) — backend API, session resolve и локальная раздача статики
- [telegram_miniapp/backend_store.py](./backend_store.py) — SQLite storage
- [telegram_miniapp/bot.py](./bot.py) — Telegram-бот
- [telegram_miniapp/dev_server.py](./dev_server.py) — локальный dev launcher с autoreload
- [telegram_miniapp/web](./web) — frontend Mini App и статические данные
- [tests](../tests) — unit, integration и browser e2e тесты

## Основные HTTP endpoints

- `GET /api/health`
- `GET /api/dev/version`
- `POST /api/session/resolve`
- `POST /api/telegram/auth`
- `GET /api/workouts`
- `POST /api/workouts`
- `PUT /api/workouts/{id}`
- `DELETE /api/workouts/{id}`
- `GET /api/body-weights`
- `POST /api/body-weights`
- `DELETE /api/body-weights/{id}`

## Быстрый локальный запуск

### 1. Запуск backend + статики

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF python3 telegram_miniapp/server.py
```

Локально приложение будет доступно на:

```text
http://127.0.0.1:8080/
```

В этом режиме:

- backend API и статика поднимаются вместе;
- SQLite хранится локально;
- браузер без Telegram может автоматически получить debug-user;
- UI-состояние вроде draft/tab/range хранится в `localStorage`.

Старая debug-страница доступна отдельно:

```text
http://127.0.0.1:8080/stub.html
```

### 2. Dev-режим с автообновлением

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF python3 telegram_miniapp/dev_server.py
```

Что делает launcher:

- следит за `.py` файлами и перезапускает backend;
- даёт live reload фронта;
- оставляет приложение на `http://127.0.0.1:8080/`.

## Запуск бота

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF WEB_APP_URL=https://trainer-miniapp.example.com python3 telegram_miniapp/bot.py
```

Бот:

- настраивает menu button `Trainer`;
- отвечает на `/start`, `/menu`, `/help`;
- открывает Mini App по `WEB_APP_URL`.

## Что проверять вручную

В актуальном интерфейсе должны быть:

- вкладка `Trainings`;
- вкладка `Progress`;
- вкладка `Weight`;
- FAB `+` для входа в конструктор тренировки;
- swipe edit/delete у карточек тренировок;
- восстановление draft;
- preview-карточки основных упражнений в `New Workout`;
- compact reference-строка `прошлый результат → план` в карточке упражнения и set-modal;
- быстрый tap по синему `+` как planned add, а long press по нему как ручной ввод;
- bottom sheet удаления по long press на карточке упражнения;
- inline-ввод веса тела и график;
- отдельная старая страница `/stub.html` для отладочных Telegram-сценариев.

## Полезные переменные окружения

### Для `server.py`

- `BOT_TOKEN` — включает серверную валидацию Telegram `initData`
- `MINIAPP_STATIC_DIR` — каталог со статикой
- `MINIAPP_HOST` — по умолчанию `127.0.0.1`
- `MINIAPP_PORT` — по умолчанию `8080`
- `MINIAPP_MAX_AUTH_AGE` — максимальный возраст Telegram auth payload
- `MINIAPP_DEV_MODE` — включает dev-поведение
- `MINIAPP_ALLOW_DEBUG_USER` — разрешает browser debug-user
- `MINIAPP_DEFAULT_DEBUG_USER_ALIAS`
- `MINIAPP_DEFAULT_DEBUG_USER_FIRST_NAME`
- `MINIAPP_DEFAULT_DEBUG_USER_LAST_NAME`
- `MINIAPP_DB_PATH` — путь к SQLite базе
- `MINIAPP_SESSION_SECRET` — секрет подписи session cookie
- `MINIAPP_SESSION_MAX_AGE` — TTL session cookie
- `MINIAPP_COOKIE_SECURE` — добавляет `Secure` флаг
- `MINIAPP_TELEGRAM_RECOVERY_USER_ID` — recovery-user для Telegram-shell

### Для `bot.py`

- `BOT_TOKEN` — обязателен
- `WEB_APP_URL` — обязателен
- `BOT_POLL_TIMEOUT` — таймаут long polling

## Деплой на VPS одной командой

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

В репозитории настроены:

- [ci.yml](../.github/workflows/ci.yml) — тесты и orchestration deploy jobs
- [deploy-web.yml](../.github/workflows/deploy-web.yml) — web deploy
- [deploy-backend.yml](../.github/workflows/deploy-backend.yml) — backend deploy
- [deploy-bot.yml](../.github/workflows/deploy-bot.yml) — bot deploy

Важно:

- деплой запускается только после успешного CI;
- backend workflow предполагает, что на VPS уже существует `/etc/trainer-miniapp/backend.env`;
- bot workflow предполагает, что на VPS уже существует `/etc/trainer-miniapp/bot.env`.

### GitHub Secrets

Нужны secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` — опционально

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

## Куда смотреть за продуктовой логикой

Продуктовая спецификация живёт здесь:

- [BUSINESS_LOGIC.md](../BUSINESS_LOGIC.md)
