#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any
from urllib import error, request


BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEB_APP_URL = os.getenv("WEB_APP_URL", "")
POLL_TIMEOUT = int(os.getenv("BOT_POLL_TIMEOUT", "30"))


def api_request(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is required")

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    raw_body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=raw_body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=POLL_TIMEOUT + 10) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Telegram API HTTP {exc.code}: {body}") from exc


def send_message(chat_id: int, text: str, reply_markup: dict[str, Any] | None = None) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    result = api_request("sendMessage", payload)
    if not result.get("ok"):
        raise RuntimeError(f"sendMessage failed: {result}")


def configure_commands() -> None:
    result = api_request(
        "setMyCommands",
        {
            "commands": [
                {"command": "start", "description": "Open Trainer Mini App"},
                {"command": "menu", "description": "Show the Mini App button"},
                {"command": "help", "description": "Show help"},
            ]
        },
    )
    if not result.get("ok"):
        raise RuntimeError(f"setMyCommands failed: {result}")


def configure_menu_button() -> None:
    if not WEB_APP_URL:
        return

    result = api_request(
        "setChatMenuButton",
        {
            "menu_button": {
                "type": "web_app",
                "text": "Trainer",
                "web_app": {"url": WEB_APP_URL},
            }
        },
    )
    if not result.get("ok"):
        raise RuntimeError(f"setChatMenuButton failed: {result}")


def ensure_bot_configuration() -> None:
    try:
        configure_commands()
        configure_menu_button()
        print("Bot commands and menu button configured")
    except Exception as exc:
        print(f"[bot] configuration warning: {exc}", file=sys.stderr)


def launcher_keyboard() -> dict[str, Any]:
    return {
        "keyboard": [
            [
                {
                    "text": "Open Trainer",
                    "web_app": {"url": WEB_APP_URL},
                }
            ]
        ],
        "resize_keyboard": True,
        "is_persistent": True,
    }


def handle_message(message: dict[str, Any]) -> None:
    chat = message.get("chat", {})
    chat_id = chat.get("id")
    if chat_id is None:
        return

    if "web_app_data" in message:
        raw_data = message["web_app_data"].get("data", "")
        send_message(
            chat_id,
            "Mini App ответил боту.\n\n"
            f"Payload:\n{raw_data}",
            reply_markup=launcher_keyboard() if WEB_APP_URL else None,
        )
        return

    text = (message.get("text") or "").strip()
    if text not in {"/start", "/menu", "/help"}:
        return

    if not WEB_APP_URL:
        send_message(
            chat_id,
            "WEB_APP_URL не настроен. Задай публичный HTTPS URL Mini App и перезапусти бота.",
        )
        return

    send_message(
        chat_id,
        "Trainer Mini App готов к запуску.\n\n"
        "Внутри сейчас доступно:\n"
        "1. история тренировок,\n"
        "2. вкладка Progress с локальной аналитикой,\n"
        "3. создание новой тренировки с локальным сохранением.\n\n"
        "Кнопка работает только в личном чате с ботом.",
        reply_markup=launcher_keyboard(),
    )


def poll_updates() -> None:
    offset = 0
    while True:
        try:
            response = api_request(
                "getUpdates",
                {
                    "offset": offset,
                    "timeout": POLL_TIMEOUT,
                    "allowed_updates": ["message"],
                },
            )
        except Exception as exc:
            print(f"[bot] polling error: {exc}", file=sys.stderr)
            time.sleep(3)
            continue

        for update in response.get("result", []):
            offset = max(offset, update["update_id"] + 1)
            message = update.get("message")
            if message:
                try:
                    handle_message(message)
                except Exception as exc:
                    print(f"[bot] failed to handle message: {exc}", file=sys.stderr)


def main() -> None:
    if not BOT_TOKEN:
        print("BOT_TOKEN is required", file=sys.stderr)
        raise SystemExit(1)

    if WEB_APP_URL and not WEB_APP_URL.startswith("https://"):
        print("WEB_APP_URL must start with https:// for Telegram Mini Apps", file=sys.stderr)
        raise SystemExit(1)

    print("Trainer bot is running in long polling mode")
    if WEB_APP_URL:
        print(f"Mini App URL: {WEB_APP_URL}")
    else:
        print("Mini App URL is not configured")
    ensure_bot_configuration()
    poll_updates()


if __name__ == "__main__":
    main()
