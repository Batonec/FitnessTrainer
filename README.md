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
- [telegram_miniapp/recommender.py](./telegram_miniapp/recommender.py) — «Совет тренера»: генерация рекомендации через Claude API
- [ios](./ios) — нативный iOS-клиент (SwiftUI) + [бриф карточки «Совет тренера»](./ios/RECOMMENDATION_CARD_BRIEF.md)
- [coach_mcp](./coach_mcp) — MCP-сервер: общение с данными тренировок в Claude и отладка рекомендаций

## Что умеет продукт сейчас

- запускаться как Telegram Mini App из бота;
- работать в локальном браузере как debug-user для разработки;
- выдавать нативному iOS-клиенту ту же backend-сессию для фиксированного пользователя `id=3`;
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
- предлагать «Совет тренера» — план следующей тренировки по истории, сгенерированный Claude (карточка вверху `Trainings` в iOS-клиенте; кэш + ручной refresh + авто-перегенерация после тренировки);
- общаться с данными тренировок и отлаживать рекомендации в Claude через MCP-сервер `coach_mcp`;
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

> **Веб-мини-апп и Telegram-бот удалены** (июнь 2026): теперь продукт — это backend API
> + нативный iOS-клиент. Сохранился только бэкенд (`server.py`/`backend_store.py`/
> `recommender.py`), его база и каталог упражнений (`web/data/exercises.json`, отдаётся iOS
> по `/data/exercises.json`).

## Коротко про архитектуру

- [telegram_miniapp/server.py](./telegram_miniapp/server.py) — API, session resolve (iOS fixed-user + debug), раздача каталога
- [telegram_miniapp/backend_store.py](./telegram_miniapp/backend_store.py) — SQLite persistence и нормализация данных
- [telegram_miniapp/recommender.py](./telegram_miniapp/recommender.py) — «Совет тренера» через Claude API
- [ios](./ios) — нативный iOS-клиент (SwiftUI)
- [coach_mcp](./coach_mcp) — MCP-сервер для общения с данными и отладки рекомендаций
- [tests](./tests) — unit/integration тесты
- [telegram_miniapp/deploy](./telegram_miniapp/deploy) — deploy backend на VPS
- [.github/workflows](./.github/workflows) — CI и backend deploy

## Локальный запуск (backend)

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
MINIAPP_ALLOW_DEBUG_USER=1 python3 telegram_miniapp/server.py
```

API поднимается на `http://127.0.0.1:8080/`. iOS-клиент собирается из [ios/](./ios) в Xcode.

## Тесты

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m unittest discover -s tests -p "test_*.py" -v
```

iOS-тесты — через Xcode (`xcodebuild test` по схеме `TrainerIOS`).

## Деплой

Бэкенд деплоится на VPS — описание окружения, сервисов и flow в:

- [telegram_miniapp/README.md](./telegram_miniapp/README.md)

## GitHub Actions

Основной workflow:

- [ci.yml](./.github/workflows/ci.yml)

Что он делает:

- всегда прогоняет полный test suite;
- после зелёного тестового job деплоит backend на `main`, если затронут backend.

Дополнительный reusable workflow:

- [deploy-backend.yml](./.github/workflows/deploy-backend.yml)

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
