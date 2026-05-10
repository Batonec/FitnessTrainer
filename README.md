# Trainer Mini App

`Trainer` — это Telegram Mini App для ведения истории тренировок, отслеживания прогресса по упражнениям и контроля веса тела.

В текущем состоянии репозиторий содержит:

- web-клиент Mini App;
- backend API на SQLite;
- Telegram-бота;
- unit / integration / browser e2e тесты;
- документацию по продуктовой и технической логике.

Старый Android-клиент сохранён только в истории git. Актуальный продукт сейчас живёт вокруг Mini App.

## Навигация по документации

- [BUSINESS_LOGIC.md](./BUSINESS_LOGIC.md) — продуктовая логика и инварианты
- [telegram_miniapp/README.md](./telegram_miniapp/README.md) — технический README по Mini App, backend, env и деплою
- [telegram_miniapp/web](./telegram_miniapp/web) — frontend
- [telegram_miniapp/server.py](./telegram_miniapp/server.py) — HTTP API и session/auth logic
- [telegram_miniapp/backend_store.py](./telegram_miniapp/backend_store.py) — SQLite storage и нормализация данных
- [telegram_miniapp/bot.py](./telegram_miniapp/bot.py) — Telegram-бот
- [tests](./tests) — тестовый suite
- [telegram_miniapp/deploy](./telegram_miniapp/deploy) — deploy tooling

## Что умеет продукт сейчас

- запускаться как Telegram Mini App из бота;
- работать в локальном браузере как debug-user для разработки;
- показывать историю тренировок на экране `Trainings`;
- открывать новую тренировку по FAB `+`, а не через отдельную вкладку;
- восстанавливать незавершённый черновик тренировки;
- не стартовать пустым экраном: сразу показывать preview-карточки основной шестёрки упражнений;
- поддерживать суперсеты и параллельное ведение нескольких упражнений;
- строить план по упражнению из последнего выполнения и использовать его везде одинаково:
  - в карточке упражнения;
  - в set-modal;
  - в быстром planned add по синей кнопке `+`;
- добавлять planned set коротким тапом по синей кнопке `+`;
- открывать ручной ввод сета long press-ом по этой же кнопке `+`;
- сохранять оценку тяжести каждого сета через `🙂 / 😐 / 😣`;
- показывать эту оценку в текущем draft, в истории тренировок и в reference-строках прошлого выполнения;
- удалять последний сет или всё упражнение через центрированную long-press модалку карточки упражнения;
- показывать прогресс по выбранному упражнению на экране `Progress`;
- показывать отдельный экран `Weight` с графиком, inline-вводом и удалением записи по тапу на точку;
- хранить тренировки и вес тела на backend, а не в `localStorage`;
- прогоняться через CI и деплоиться на VPS после зелёных тестов.

## Текущий продуктовый UX в двух словах

- Нижняя навигация состоит из `Trainings`, `Progress` и `Weight`.
- На `Trainings` показывается серверная история тренировок текущего пользователя в компактных карточках.
- На карточке сохранённой тренировки упражнения и сеты схлопываются в короткие summary-строки.
- Load-type (`heavy / medium / light`) по-прежнему вычисляется и хранится, но в текущем UX на карточках истории не показывается.
- Если есть живой draft, FAB на `Trainings` становится входом обратно в конструктор.
- Вокруг FAB показывается кольцевой прогресс по основной шестёрке упражнений.
- Этот прогресс сейчас считается дробно: по доле выполненных planned sets, а не просто по факту “в упражнении появился хотя бы один сет”.
- `New Workout` сразу показывает preview-карточки основной шестёрки упражнений и редкий каталог под плашкой `Ещё упражнения`.
- Каждая карточка упражнения показывает reference-строку `прошлое выполнение → план`, построенную из одного и того же общего источника плановой логики.
- Реально добавленные сеты показываются отдельной синей строкой и используют ту же логику схлопывания, что и история тренировок.
- Set-modal компактная, без кнопки `Отмена`, закрывается тапом вне модалки и позволяет выбрать `effort`.
- Long press по карточке упражнения открывает центрированную action-модалку удаления.
- Экран `Weight` хранит одну запись на дату и поддерживает удаление записи через тап по точке графика.

## Что считается источником истины

- история тренировок — backend / SQLite;
- записи веса тела — backend / SQLite;
- справочник упражнений — [telegram_miniapp/web/data/exercises.json](./telegram_miniapp/web/data/exercises.json);
- черновик тренировки и некоторые UI-состояния — `localStorage`.

`localStorage` не считается источником истины для уже сохранённых тренировок и веса тела.

## Коротко про архитектуру

- [telegram_miniapp/web](./telegram_miniapp/web) — основной frontend Mini App
- [telegram_miniapp/server.py](./telegram_miniapp/server.py) — API, session resolve, Telegram auth, раздача статики
- [telegram_miniapp/backend_store.py](./telegram_miniapp/backend_store.py) — SQLite persistence и нормализация данных
- [telegram_miniapp/bot.py](./telegram_miniapp/bot.py) — Telegram-бот на long polling
- [tests](./tests) — unit, integration и browser e2e тесты
- [telegram_miniapp/deploy](./telegram_miniapp/deploy) — ручной deploy на VPS
- [.github/workflows](./.github/workflows) — CI и deploy pipelines

## Локальный запуск

Быстрый старт:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 telegram_miniapp/dev_server.py
```

После этого приложение доступно на:

```text
http://127.0.0.1:8080/
```

В браузере без Telegram сервер автоматически выдаёт debug-user, если debug-режим разрешён переменными окружения.

## Тесты

Быстрый запуск:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m unittest discover -s tests -p "test_*.py" -v
```

Полный запуск с browser e2e:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m unittest discover -s tests -p "test_*.py" -v
```

## Деплой

Ручной деплой на текущий VPS:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
./telegram_miniapp/deploy/deploy.sh web
```

Полное техническое описание окружения, сервисов и deploy flow лежит в:

- [telegram_miniapp/README.md](./telegram_miniapp/README.md)

## GitHub Actions

Основной workflow:

- [ci.yml](./.github/workflows/ci.yml)

Что он делает:

- определяет, затронуты ли `web`, `backend` и/или `bot`;
- всегда прогоняет полный test suite;
- после зелёного тестового job запускает точечный deploy на `main` только для реально затронутых частей.

Дополнительные reusable workflows:

- [deploy-web.yml](./.github/workflows/deploy-web.yml)
- [deploy-backend.yml](./.github/workflows/deploy-backend.yml)
- [deploy-bot.yml](./.github/workflows/deploy-bot.yml)

Нужные GitHub secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` — опционально

## Где смотреть за текущей логикой

Если нужен именно продуктовый ответ “как это должно работать сейчас”, сначала смотри:

1. [BUSINESS_LOGIC.md](./BUSINESS_LOGIC.md)
2. [telegram_miniapp/web/main.js](./telegram_miniapp/web/main.js)
3. [tests](./tests)
