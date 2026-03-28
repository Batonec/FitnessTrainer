# Trainer Mini App

`Trainer` — это Telegram Mini App для учета тренировок.

Текущая ветка `main` содержит только web-версию Mini App и документацию по ней. Android-проект сохранен в истории репозитория, но в актуальном состоянии репы оставлен только код, связанный с Mini App.

## Быстрые ссылки

- [Бизнес-логика приложения](./BUSINESS_LOGIC.md)
- [Технический README по запуску и деплою](./telegram_miniapp/README.md)
- [Frontend Mini App](./telegram_miniapp/web)
- [Telegram-бот](./telegram_miniapp/bot.py)
- [GitHub Actions workflows](./.github/workflows)
- [Скрипт деплоя на VPS](./telegram_miniapp/deploy/deploy.sh)

## Что уже работает

- запуск Mini App из Telegram-бота;
- экран `Trainings` с историей тренировок;
- экран `Progress` с аналитикой по фикстурам и серверным тренировкам;
- экран `New` для создания новой тренировки;
- backend на SQLite для сохраненных тренировок;
- browser debug user для локальной отладки без Telegram;
- Telegram fallback user, если Mini App открылся без signed `initData`;
- работа на JSON-фикстурах + backend-хранилище;
- восстановление черновика незавершенной тренировки;
- локальный dev-режим с автообновлением;
- деплой web-части, backend и бота на VPS.
- GitHub Actions автодеплой на VPS по SSH.
- автотесты на push и pull request.

## Бизнес-логика в двух словах

Приложение сейчас работает в гибридном режиме:

- справочник упражнений и стартовая история тренировок загружаются из JSON-файлов;
- пользовательские тренировки сохраняются в backend на SQLite;
- в локальной разработке браузер без Telegram автоматически работает как `default browser user`;
- при проблемах с signed `initData` приложение может зайти через `telegram_unsafe` fallback;
- все экраны работают на объединенном наборе `фикстуры + серверные тренировки`;
- новая тренировка сразу начинает участвовать в истории, прогрессе и логике подбора стандартного веса;
- незавершенная тренировка восстанавливается как черновик и может быть сброшена кнопкой `Начать заново`.

Подробная спецификация находится здесь:

- [BUSINESS_LOGIC.md](./BUSINESS_LOGIC.md)

## Структура репозитория

- `telegram_miniapp/web/` — основной frontend Mini App;
- `telegram_miniapp/bot.py` — Telegram-бот на long polling;
- `telegram_miniapp/server.py` — backend API и локальный сервер для разработки;
- `telegram_miniapp/backend_store.py` — SQLite storage и user/workout persistence;
- `telegram_miniapp/dev_server.py` — dev launcher с autoreload;
- `tests/` — unit, integration и browser e2e тесты;
- `requirements-dev.txt` — зависимости для browser e2e и CI;
- `telegram_miniapp/deploy/` — файлы для деплоя на VPS;
- `BUSINESS_LOGIC.md` — подробное описание бизнес-правил приложения.

## Локальный старт

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 telegram_miniapp/dev_server.py
```

После этого приложение доступно локально на:

```text
http://127.0.0.1:8080/
```

## Деплой

Для текущего проекта уже есть деплой одной командой:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
./telegram_miniapp/deploy/deploy.sh web
```

Полное описание запуска, переменных окружения и деплоя лежит в:

- [telegram_miniapp/README.md](./telegram_miniapp/README.md)

## Тесты

Быстрый локальный прогон без браузерных зависимостей:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m unittest discover -s tests -p "test_*.py" -v
```

Полный прогон с браузерным e2e:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m unittest discover -s tests -p "test_*.py" -v
```

## GitHub Actions

В репозитории настроены четыре workflow:

- [ci.yml](./.github/workflows/ci.yml) — автотесты на каждый `push` и `pull_request`, а на `main` после успешных тестов вызывает нужные деплойные workflow
- [deploy-web.yml](./.github/workflows/deploy-web.yml) — reusable/manual workflow для выкладки `telegram_miniapp/web/**` на VPS
- [deploy-backend.yml](./.github/workflows/deploy-backend.yml) — reusable/manual workflow для backend API и systemd unit
- [deploy-bot.yml](./.github/workflows/deploy-bot.yml) — reusable/manual workflow для `bot.py` и systemd unit

Чтобы они заработали в GitHub, в secrets репозитория нужно добавить:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` — опционально, если SSH не на `22`
