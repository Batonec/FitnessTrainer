#!/usr/bin/env python3
"""Coach MCP — talk to your training data in Claude and debug recommendations.

A thin read-only MCP server over the same SQLite database the Trainer mini app
uses (``backend``). It reuses ``backend_store`` and ``recommender`` so
the recommendation debugging tools generate exactly what the backend would.

Run (stdio, for local Claude Desktop):
    python coach_mcp/server.py

Run (streamable-http, behind a Cloudflare tunnel like investor-mcp):
    python coach_mcp/server.py --transport streamable-http --host 127.0.0.1 --port 8001

Environment:
    ANTHROPIC_API_KEY        required for the generate/debug tools
    COACH_MCP_BACKEND_DIR    dir containing backend_store.py + recommender.py
                             (default: ../backend; on the VPS set it to
                             /opt/trainer-miniapp/app)
    MINIAPP_DB_PATH          SQLite path (default: <backend_dir>/data/trainer.db)
    COACH_MCP_STATIC_DIR     dir holding data/exercises.json (default:
                             MINIAPP_STATIC_DIR, else <backend_dir>/static)
    COACH_MCP_USER_ID        user id to operate on (default:
                             MINIAPP_TELEGRAM_RECOVERY_USER_ID, else 3)
    ANTHROPIC_MODEL          override model (default from recommender)
    COACH_MCP_PATH           HTTP path for streamable transport (default: /mcp)
    COACH_MCP_AUTH_TOKEN     if set, require Authorization: Bearer <token>
    COACH_MCP_ALLOWED_HOSTS  comma list to enable strict DNS-rebinding protection
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # noqa: BLE001 - dotenv is optional
    pass

# --- locate and import the backend modules (backend_store + recommender) ------
_BACKEND_DIR = os.getenv("COACH_MCP_BACKEND_DIR") or str(
    Path(__file__).resolve().parent.parent / "backend"
)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

import backend_store  # noqa: E402
import recommender  # noqa: E402

from mcp.server.fastmcp import FastMCP  # noqa: E402
from mcp.server.transport_security import TransportSecuritySettings  # noqa: E402
from mcp.types import CallToolResult, TextContent  # noqa: E402


# --- configuration ------------------------------------------------------------
_DB_PATH = Path(
    os.getenv("MINIAPP_DB_PATH") or str(Path(_BACKEND_DIR) / "data" / "trainer.db")
)
_STATIC_DIR = Path(
    os.getenv("COACH_MCP_STATIC_DIR")
    or os.getenv("MINIAPP_STATIC_DIR")
    or str(Path(_BACKEND_DIR) / "static")
)
_DEFAULT_USER_ID = int(
    os.getenv("COACH_MCP_USER_ID")
    or os.getenv("MINIAPP_TELEGRAM_RECOVERY_USER_ID")
    or "3"
)

STORE = backend_store.MiniAppStore(_DB_PATH)

_INSTRUCTIONS = """\
Тренер-ассистент по силовым тренировкам пользователя (доступ только на чтение).

У тебя есть инструменты к истории тренировок, замерам веса тела, каталогу
упражнений и к движку рекомендаций «следующая тренировка».

Когда пользователь спрашивает «что мне потренировать дальше / разбери мой
прогресс / почему такая рекомендация»:
1) посмотри историю (coach_list_workouts) и при необходимости каталог
   (coach_get_catalog) и динамику веса (coach_list_body_weights);
2) для отладки рекомендаций используй coach_preview_prompt (увидеть точный
   промпт без траты токенов), coach_debug_recommendation (сырой ответ модели
   ДО валидации + валидированный результат + токены) и coach_get_stored_recommendation
   (что сейчас лежит в кэше приложения);
3) coach_generate_recommendation генерирует новую рекомендацию; по умолчанию
   НЕ записывает её в базу приложения (store=false) — поставь store=true, только
   если пользователь хочет обновить рекомендацию в самом приложении.

Это аналитика и сценарии, не медицинский совет. Веса — в килограммах, отвечай
по-русски."""

mcp = FastMCP("Coach MCP", instructions=_INSTRUCTIONS)


# --- helpers ------------------------------------------------------------------
def _json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def _result(payload: dict[str, Any]) -> CallToolResult:
    """Wrap a dict into an MCP CallToolResult (text + structuredContent + isError).

    Mirrors the investor-mcp convention: the whole payload is serialized into the
    text content (so every client shows the model the data) and also placed in
    structuredContent; isError is derived from ``ok``.
    """
    summary = payload.get("summary") or (
        "Ошибка." if not payload.get("ok", True) else "Готово."
    )
    return CallToolResult(
        content=[TextContent(type="text", text=f"{summary}\n\n{_json(payload)}")],
        structuredContent=payload,
        isError=not payload.get("ok", True),
    )


def _err(summary: str) -> dict[str, Any]:
    return {"ok": False, "summary": summary}


def _uid(user_id: int | None) -> int:
    return int(user_id) if user_id else _DEFAULT_USER_ID


def _catalog() -> list[dict[str, Any]]:
    return recommender.load_catalog(_STATIC_DIR)


def _estimate_cost(model: str, usage: dict[str, Any]) -> dict[str, Any] | None:
    # Per-1M-token prices for the models this project uses.
    prices = {
        "claude-opus-4-8": (5.0, 25.0),
        "claude-sonnet-4-6": (3.0, 15.0),
        "claude-haiku-4-5": (1.0, 5.0),
    }
    if model not in prices:
        return None
    in_p, out_p = prices[model]
    it = usage.get("input_tokens") or 0
    ot = usage.get("output_tokens") or 0
    usd = it * in_p / 1_000_000 + ot * out_p / 1_000_000
    return {"input_tokens": it, "output_tokens": ot, "usd": round(usd, 4)}


# --- tools: data --------------------------------------------------------------
@mcp.tool()
def coach_list_workouts(limit: int = 20, user_id: int | None = None) -> CallToolResult:
    """История тренировок (новые сверху) + компактная сериализация, как её видит модель."""
    try:
        uid = _uid(user_id)
        workouts = STORE.list_workouts(uid)
        compact = recommender._serialize_history(workouts, limit)
        return _result(
            {
                "ok": True,
                "summary": f"Тренировок: {len(workouts)} (показаны последние {min(limit, len(workouts))}).",
                "user_id": uid,
                "total": len(workouts),
                "workouts": workouts[:limit],
                "compact_history": compact,
            }
        )
    except Exception as exc:  # noqa: BLE001
        return _result(_err(f"Не удалось прочитать тренировки: {exc}"))


@mcp.tool()
def coach_get_workout(workout_id: int, user_id: int | None = None) -> CallToolResult:
    """Одна тренировка по id (полные данные)."""
    try:
        uid = _uid(user_id)
        workout = STORE.get_workout_by_id(uid, int(workout_id))
        if workout is None:
            return _result(_err(f"Тренировка #{workout_id} не найдена."))
        return _result({"ok": True, "summary": "Готово.", "user_id": uid, "workout": workout})
    except Exception as exc:  # noqa: BLE001
        return _result(_err(f"Ошибка: {exc}"))


@mcp.tool()
def coach_list_body_weights(user_id: int | None = None) -> CallToolResult:
    """История замеров веса тела (старые сверху)."""
    try:
        uid = _uid(user_id)
        entries = STORE.list_body_weights(uid)
        return _result(
            {
                "ok": True,
                "summary": f"Замеров веса: {len(entries)}.",
                "user_id": uid,
                "entries": entries,
            }
        )
    except Exception as exc:  # noqa: BLE001
        return _result(_err(f"Ошибка: {exc}"))


@mcp.tool()
def coach_get_catalog() -> CallToolResult:
    """Каталог доступных упражнений (id + название) — других упражнений не существует."""
    try:
        catalog = _catalog()
        return _result(
            {"ok": True, "summary": f"Упражнений: {len(catalog)}.", "catalog": catalog}
        )
    except Exception as exc:  # noqa: BLE001
        return _result(_err(f"Каталог недоступен: {exc}"))


# --- tools: recommendation debugging -----------------------------------------
@mcp.tool()
def coach_get_stored_recommendation(user_id: int | None = None) -> CallToolResult:
    """Текущая рекомендация из кэша приложения (status, based_on, payload, токены, ошибка)."""
    try:
        uid = _uid(user_id)
        rec = STORE.get_recommendation(uid)
        latest = STORE.get_latest_workout_id(uid)
        if rec is None:
            return _result(
                {"ok": True, "summary": "Рекомендации в кэше ещё нет.", "user_id": uid, "status": "none"}
            )
        rec["stale"] = bool(rec.get("status") == "ready" and rec.get("based_on_workout_id") != latest)
        rec.update({"ok": True, "user_id": uid, "latest_workout_id": latest, "summary": f"Статус: {rec.get('status')}."})
        return _result(rec)
    except Exception as exc:  # noqa: BLE001
        return _result(_err(f"Ошибка: {exc}"))


@mcp.tool()
def coach_preview_prompt(limit: int = 20, user_id: int | None = None) -> CallToolResult:
    """Показать ТОЧНЫЙ промпт (system + user) и JSON-схему, которые уйдут в Claude. Без вызова API (бесплатно)."""
    try:
        uid = _uid(user_id)
        catalog = _catalog()
        workouts = STORE.list_workouts(uid)
        body_weights = STORE.list_body_weights(uid)
        system = recommender._build_system_prompt(catalog)
        user = recommender._build_user_prompt(workouts, body_weights, date.today(), limit)
        schema = recommender._build_schema(catalog)
        return _result(
            {
                "ok": True,
                "summary": "Промпт собран (без обращения к модели).",
                "user_id": uid,
                "model": recommender.DEFAULT_MODEL,
                "history_used": min(limit, len(workouts)),
                "system_prompt": system,
                "user_prompt": user,
                "json_schema": schema,
            }
        )
    except Exception as exc:  # noqa: BLE001
        return _result(_err(f"Ошибка: {exc}"))


@mcp.tool()
def coach_debug_recommendation(limit: int = 20, user_id: int | None = None) -> CallToolResult:
    """Глубокая отладка: вызвать модель и вернуть СЫРОЙ ответ (до валидации) + валидированный результат + промпт + токены/стоимость.

    Ничего не записывает в базу приложения."""
    try:
        uid = _uid(user_id)
        api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            return _result(_err("ANTHROPIC_API_KEY не задан в окружении."))
        catalog = _catalog()
        workouts = STORE.list_workouts(uid)
        if not workouts:
            return _result(_err("Нет истории тренировок для генерации."))
        body_weights = STORE.list_body_weights(uid)
        system = recommender._build_system_prompt(catalog)
        user = recommender._build_user_prompt(workouts, body_weights, date.today(), limit)
        schema = recommender._build_schema(catalog)
        model = recommender.DEFAULT_MODEL

        raw, usage = recommender._call_anthropic(
            system,
            user,
            schema,
            model=model,
            max_tokens=recommender.DEFAULT_MAX_TOKENS,
            api_key=api_key,
            timeout=recommender.DEFAULT_TIMEOUT,
        )
        # Validate separately so the caller can compare raw vs cleaned output.
        validation_error = None
        validated = None
        try:
            validated = recommender._validate(raw, catalog)
        except recommender.RecommendationError as exc:
            validation_error = str(exc)

        return _result(
            {
                "ok": True,
                "summary": "Готово: сырой и валидированный ответ модели.",
                "user_id": uid,
                "model": model,
                "history_used": min(limit, len(workouts)),
                "raw_model_output": raw,
                "validated": validated,
                "validation_error": validation_error,
                "usage": usage,
                "cost": _estimate_cost(model, usage),
                "user_prompt": user,
            }
        )
    except recommender.RecommendationError as exc:
        return _result(_err(str(exc)))
    except Exception as exc:  # noqa: BLE001
        return _result(_err(f"Ошибка отладки: {exc}"))


@mcp.tool()
def coach_generate_recommendation(
    limit: int = 20, store: bool = False, user_id: int | None = None
) -> CallToolResult:
    """Сгенерировать новую рекомендацию (валидированную). store=false (по умолчанию) — НЕ писать в базу приложения; store=true — обновить кэш, который видит приложение."""
    try:
        uid = _uid(user_id)
        workouts = STORE.list_workouts(uid)
        body_weights = STORE.list_body_weights(uid)
        catalog = _catalog()
        recommendation, usage, model = recommender.generate(
            workouts, body_weights, catalog, history_limit=limit
        )
        stored = None
        if store:
            based_on = STORE.get_latest_workout_id(uid)
            stored = STORE.save_recommendation(
                uid,
                based_on,
                len(workouts),
                model,
                recommendation,
                usage.get("input_tokens"),
                usage.get("output_tokens"),
            )
        return _result(
            {
                "ok": True,
                "summary": (
                    "Сгенерировано и сохранено в кэш приложения."
                    if store
                    else "Сгенерировано (в базу НЕ записано)."
                ),
                "user_id": uid,
                "model": model,
                "stored": bool(store),
                "recommendation": recommendation,
                "usage": usage,
                "cost": _estimate_cost(model, usage),
                "stored_row": stored,
            }
        )
    except recommender.RecommendationError as exc:
        return _result(_err(str(exc)))
    except Exception as exc:  # noqa: BLE001
        return _result(_err(f"Ошибка генерации: {exc}"))


# --- ASGI bearer-auth middleware (same shape as investor-mcp) -----------------
class _BearerAuthMiddleware:
    """Require ``Authorization: Bearer <token>`` on HTTP; active only when a token is set."""

    def __init__(self, app: Any, token: str) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"").decode("latin-1")
        if auth != f"Bearer {self.token}":
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
            return
        await self.app(scope, receive, send)


def main() -> None:
    parser = argparse.ArgumentParser(description="Coach MCP server")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default=os.getenv("COACH_MCP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("COACH_MCP_PORT", "8001")))
    parser.add_argument("--mcp-path", default=os.getenv("COACH_MCP_PATH", "/mcp"))
    args = parser.parse_args()

    if args.transport == "stdio":
        mcp.run()
        return

    mcp.settings.host = args.host
    mcp.settings.port = args.port
    mcp.settings.streamable_http_path = args.mcp_path
    allowed = os.getenv("COACH_MCP_ALLOWED_HOSTS")
    if allowed:
        hosts = [h.strip() for h in allowed.split(",") if h.strip()]
        mcp.settings.transport_security = TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=hosts,
            allowed_origins=[f"https://{h}" for h in hosts],
        )
    else:
        mcp.settings.transport_security = TransportSecuritySettings(
            enable_dns_rebinding_protection=False
        )

    token = os.getenv("COACH_MCP_AUTH_TOKEN")
    if token:
        import uvicorn

        uvicorn.run(_BearerAuthMiddleware(mcp.streamable_http_app(), token),
                    host=args.host, port=args.port, log_level="info")
    else:
        mcp.run(transport="streamable-http")


if __name__ == "__main__":
    main()
