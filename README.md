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
- экран `Progress` с локальной аналитикой;
- экран `New` для создания новой тренировки;
- работа на локальных JSON-фикстурах и `localStorage`;
- локальный dev-режим с автообновлением;
- деплой web-части и бота на VPS.
- GitHub Actions автодеплой на VPS по SSH.

## Бизнес-логика в двух словах

Приложение сейчас работает в локальном web-режиме:

- справочник упражнений и стартовая история тренировок загружаются из JSON-файлов;
- пользовательские тренировки сохраняются локально в браузере;
- все экраны работают на объединенном наборе `фикстуры + локальный кэш`;
- новая тренировка сразу начинает участвовать в истории, прогрессе и логике подбора стандартного веса.

Подробная спецификация находится здесь:

- [BUSINESS_LOGIC.md](./BUSINESS_LOGIC.md)

## Структура репозитория

- `telegram_miniapp/web/` — основной frontend Mini App;
- `telegram_miniapp/bot.py` — Telegram-бот на long polling;
- `telegram_miniapp/server.py` — локальный сервер для разработки;
- `telegram_miniapp/dev_server.py` — dev launcher с autoreload;
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

## GitHub Actions

В репозитории настроены два workflow:

- [deploy-web.yml](./.github/workflows/deploy-web.yml) — автодеплой `telegram_miniapp/web/**` на VPS при пуше в `main`
- [deploy-bot.yml](./.github/workflows/deploy-bot.yml) — деплой `bot.py` и systemd unit на VPS при изменении бота

Чтобы они заработали в GitHub, в secrets репозитория нужно добавить:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` — опционально, если SSH не на `22`
