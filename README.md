# Trainer Mini App

`Trainer` — это Telegram Mini App для учёта тренировок и веса тела.

Актуальное состояние репозитория содержит только Mini App, backend, Telegram-бота, тесты и документацию. Старый Android-проект сохранён в истории git, но в текущем состоянии репозитория его больше нет.

## Быстрые ссылки

- [Бизнес-логика продукта](./BUSINESS_LOGIC.md)
- [Технический README по запуску, переменным окружения и деплою](./telegram_miniapp/README.md)
- [Frontend Mini App](./telegram_miniapp/web)
- [Backend API](./telegram_miniapp/server.py)
- [SQLite storage](./telegram_miniapp/backend_store.py)
- [Telegram-бот](./telegram_miniapp/bot.py)
- [GitHub Actions workflows](./.github/workflows)
- [Скрипт деплоя на VPS](./telegram_miniapp/deploy/deploy.sh)

## Что сейчас умеет продукт

- запускаться как Telegram Mini App из [telegram_miniapp/bot.py](./telegram_miniapp/bot.py);
- показывать историю тренировок на экране `Trainings`;
- создавать новую тренировку через FAB, а не через отдельную вкладку;
- восстанавливать незавершённый черновик тренировки;
- поддерживать суперсеты и параллельное ведение нескольких упражнений в одном черновике;
- подсказывать основную плитку упражнений из реальной истории тренировок;
- редактировать и удалять сохранённые тренировки;
- показывать прогресс по выбранному упражнению на экране `Progress`;
- вести отдельный экран `Weight` для контроля веса тела;
- сохранять вес тела на backend и удалять запись по тапу на точку графика;
- хранить пользовательские данные на SQLite backend, а не в `localStorage`;
- запускаться в обычном браузере как debug-user для локальной разработки;
- проходить через CI и деплоиться на VPS только после успешных тестов.

## Коротко про текущую архитектуру

- [telegram_miniapp/web](./telegram_miniapp/web) — основной frontend Mini App;
- [telegram_miniapp/server.py](./telegram_miniapp/server.py) — HTTP API, Telegram auth/session resolve и локальная раздача статики;
- [telegram_miniapp/backend_store.py](./telegram_miniapp/backend_store.py) — SQLite storage для пользователей, тренировок и веса тела;
- [telegram_miniapp/bot.py](./telegram_miniapp/bot.py) — Telegram-бот на long polling;
- [tests](./tests) — unit, integration и browser e2e тесты;
- [telegram_miniapp/deploy](./telegram_miniapp/deploy) — VPS deploy tooling;
- [BUSINESS_LOGIC.md](./BUSINESS_LOGIC.md) — продуктовая спецификация.

## Текущий UX в двух словах

- Нижняя навигация сейчас состоит из `Trainings`, `Progress` и `Weight`.
- Создание тренировки открывается по плавающей кнопке `+` на экране `Trainings`.
- Если есть живой черновик, `+` превращается в точку входа обратно в конструктор, а вокруг FAB показывается прогресс по основной плитке упражнений.
- Экран `Progress` показывает количество тренировок за период и рост веса/повторов по выбранному упражнению.
- Экран `Weight` показывает диапазоны `7D / 30D / All`, inline-ввод веса, summary-strip и график веса тела.
- Фича `План следующей тренировки` в коде сохранена, но в UI сейчас отключена флагом.

## Локальный запуск

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 telegram_miniapp/dev_server.py
```

После этого приложение доступно на:

```text
http://127.0.0.1:8080/
```

Для локальной отладки браузер без Telegram автоматически получает debug-сессию.

## Тесты

Быстрый прогон:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m unittest discover -s tests -p "test_*.py" -v
```

Полный прогон c browser e2e:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
.venv/bin/python -m unittest discover -s tests -p "test_*.py" -v
```

## Деплой

Локальный ручной деплой на текущий VPS:

```bash
cd /Users/batonec/AndroidStudioProjects/Trainer
./telegram_miniapp/deploy/deploy.sh web
```

Полное описание окружения, сервисов и GitHub Actions лежит в:

- [telegram_miniapp/README.md](./telegram_miniapp/README.md)

## GitHub Actions

В репозитории настроены workflow, где тесты являются пререквизитом для деплоя:

- [ci.yml](./.github/workflows/ci.yml) — тесты на каждый `push` и `pull_request`, плюс orchestration deploy jobs на `main`;
- [deploy-web.yml](./.github/workflows/deploy-web.yml) — web deploy;
- [deploy-backend.yml](./.github/workflows/deploy-backend.yml) — backend deploy;
- [deploy-bot.yml](./.github/workflows/deploy-bot.yml) — bot deploy.

Для работы GitHub Actions нужны secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`
- `VPS_PORT` — опционально
