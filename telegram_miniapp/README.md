# Trainer Telegram Mini App Stub

Минимальный старт для первого шага:

- бот присылает кнопку `Open Trainer`
- Telegram открывает полноценный локальный web-интерфейс Trainer
- приложение работает на JSON-фикстурах и локальном кэше без backend
- старая auth/debug-заглушка сохранена отдельно
- сервер по-прежнему умеет валидировать `Telegram.WebApp.initData`

## Структура

- `telegram_miniapp/server.py` — маленький HTTP-сервер без зависимостей
- `telegram_miniapp/bot.py` — простой Telegram-бот на long polling
- `telegram_miniapp/web/` — статическое web-приложение и локальные фикстуры

## Что нужно

- Python 3.13+ у тебя уже есть
- `BOT_TOKEN` от BotFather
- публичный `https://` URL для Mini App

Telegram Bot API описывает `WebAppInfo.url` как HTTPS URL веб-приложения, а также указывает, что `web_app` кнопки доступны в приватном чате с ботом.

## Быстрый запуск

### 1. Запусти web-сервер

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF python3 telegram_miniapp/server.py
```

Локально он поднимется на `http://127.0.0.1:8080`, но Telegram не откроет такой URL как Mini App.

По этому адресу теперь открывается основной web-интерфейс Trainer.
Старая debug-страница доступна отдельно:

```text
http://127.0.0.1:8080/stub.html
```

### 2. Выставь его наружу через публичный HTTPS

Подойдет любой вариант, который дает постоянный `https://` адрес:

- VPS + Nginx/Caddy
- reverse proxy на твоем сервере
- временный tunnel для быстрой проверки

После этого у тебя должен появиться адрес вида:

```text
https://trainer-miniapp.example.com
```

### 3. Запусти бота

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF WEB_APP_URL=https://trainer-miniapp.example.com python3 telegram_miniapp/bot.py
```

### 4. Открой диалог с ботом и отправь `/start`

Бот пришлет кнопку `Open Trainer`.

## Dev-режим без ручного рестарта

Для локальной разработки теперь есть отдельный launcher:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
BOT_TOKEN=123456:ABCDEF python3 telegram_miniapp/dev_server.py
```

Что он делает:

- автоматически перезапускает backend, если меняется любой `.py` файл в `telegram_miniapp/`
- страница в браузере сама перезагружается, если меняется `html/css/js`
- при перезапуске backend краткий разрыв соединения нормален, страница потом сама обновится

Локально открывай:

```text
http://127.0.0.1:8080/
```

## Деплой на VPS одной командой

Для текущего VPS есть готовый скрипт:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
./telegram_miniapp/deploy/deploy.sh web
```

Что он делает:

- заливает `telegram_miniapp/web/` на VPS в `/opt/trainer-miniapp/www`
- не трогает `443`
- не требует ручного `scp` для каждого файла

Если изменялся бот, можно выкатить и его:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
./telegram_miniapp/deploy/deploy.sh bot
```

Или все сразу:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
./telegram_miniapp/deploy/deploy.sh all
```

По умолчанию скрипт использует:

- `root@89.124.83.32`
- `/opt/trainer-miniapp`
- `trainer-miniapp-bot.service`

При желании это можно переопределить через env:

```bash
TRAINER_VPS_HOST=root@1.2.3.4 ./telegram_miniapp/deploy/deploy.sh web
```

## Что проверить внутри Mini App

На основном приложении ты увидишь:

- экран `Trainings`
- экран `Progress`
- экран `Новая тренировка`
- работу на локальных JSON-фикстурах и `localStorage`

Если нужен именно Telegram auth/debug flow, открой `/stub.html`.

## Полезные переменные окружения

### Для `server.py`

- `BOT_TOKEN` — включает серверную проверку `initData`
- `MINIAPP_HOST` — по умолчанию `127.0.0.1`
- `MINIAPP_PORT` — по умолчанию `8080`
- `MINIAPP_MAX_AUTH_AGE` — по умолчанию `86400`

### Для `bot.py`

- `BOT_TOKEN` — обязателен
- `WEB_APP_URL` — обязателен для открытия Mini App
- `BOT_POLL_TIMEOUT` — по умолчанию `30`

## Что делать дальше

Когда убедишься, что запуск и авторизация работают, следующий логичный шаг:

1. сохранить подтвержденного Telegram-пользователя в backend
2. завести серверную сессию или JWT после проверки `initData`
3. перенести первый экран тренировок в web UI
