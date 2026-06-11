#!/usr/bin/env python3
"""Next-workout recommendation generation via the Claude Messages API.

Zero third-party dependencies on purpose: the call to api.anthropic.com is made
with stdlib ``urllib`` (the same approach bot.py already uses for the Telegram
API), so the long-running server process gains no extra packages and no extra
RAM footprint on the small VPS.

The public entry point is :func:`generate`, which takes the user's workout
history (as returned by ``MiniAppStore.list_workouts``) plus the exercise
catalog and returns a validated, schema-shaped recommendation dict.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any


ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-8")
DEFAULT_MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2500"))
DEFAULT_HISTORY_LIMIT = int(os.getenv("RECOMMENDATION_HISTORY_LIMIT", "20"))
DEFAULT_TIMEOUT = float(os.getenv("ANTHROPIC_TIMEOUT", "90"))

# Server-side sanity bounds (JSON Schema can't express numeric ranges, so the
# model output is clamped/filtered after parsing).
MAX_REPS = 100
MAX_WEIGHT = 1000.0
MAX_EXERCISES = 10
MAX_SETS_PER_EXERCISE = 12

ALLOWED_LOAD_TYPES = ("heavy", "medium", "light")

_EFFORT_MARK = {"easy": "-", "ok": "", "hard": "+"}


class RecommendationError(Exception):
    """Raised when a recommendation cannot be produced (no history, API error,
    invalid model output, ...). The message is safe to surface to the client."""


# --------------------------------------------------------------------------- #
# Catalog
# --------------------------------------------------------------------------- #
def load_catalog(static_dir: Path) -> list[dict[str, Any]]:
    """Load the exercise catalog the iOS app uses (www/data/exercises.json)."""
    catalog_path = Path(static_dir) / "data" / "exercises.json"
    raw = json.loads(catalog_path.read_text("utf-8"))
    exercises = raw.get("exercises", [])
    catalog: list[dict[str, Any]] = []
    for item in exercises:
        try:
            catalog.append({"id": int(item["id"]), "name": str(item["name"]).strip()})
        except (KeyError, TypeError, ValueError):
            continue
    if not catalog:
        raise RecommendationError("Каталог упражнений пуст или недоступен")
    return catalog


# --------------------------------------------------------------------------- #
# Prompt building
# --------------------------------------------------------------------------- #
def _serialize_workout(workout: dict[str, Any]) -> str:
    data = workout.get("data", {}) or {}
    load_type = data.get("load_type") or "?"
    parts: list[str] = []
    for exercise in data.get("exercises", []) or []:
        name = str(exercise.get("name", "")).strip() or "?"
        sets_repr: list[str] = []
        for workout_set in exercise.get("sets", []) or []:
            try:
                reps = int(workout_set.get("reps", 0))
                weight = float(workout_set.get("weight", 0))
            except (TypeError, ValueError):
                continue
            mark = _EFFORT_MARK.get(workout_set.get("effort") or "", "")
            weight_repr = f"{weight:g}"
            sets_repr.append(f"{weight_repr}кг×{reps}{mark}")
        if sets_repr:
            parts.append(f"{name} {', '.join(sets_repr)}")
    body = "; ".join(parts) if parts else "(нет подходов)"
    return f"{workout.get('workout_date', '?')} [{load_type}] {body}"


def _serialize_history(workouts: list[dict[str, Any]], limit: int) -> str:
    # list_workouts() returns newest-first; take the most recent `limit`
    # and present oldest -> newest so progression reads naturally.
    recent = list(workouts[:limit])
    recent.reverse()
    return "\n".join(_serialize_workout(w) for w in recent)


def _days_since_last(workouts: list[dict[str, Any]], today: date) -> int | None:
    for workout in workouts:  # newest-first
        raw = workout.get("workout_date")
        if not raw:
            continue
        try:
            last = date.fromisoformat(str(raw))
        except ValueError:
            continue
        return (today - last).days
    return None


def _serialize_body_weights(body_weights: list[dict[str, Any]]) -> str | None:
    if not body_weights:
        return None
    # list_body_weights() is oldest-first; show the last few.
    tail = body_weights[-5:]
    points = []
    for entry in tail:
        try:
            points.append(f"{entry.get('entry_date', '?')}: {float(entry.get('weight', 0)):g}кг")
        except (TypeError, ValueError):
            continue
    return ", ".join(points) if points else None


def _build_system_prompt(catalog: list[dict[str, Any]]) -> str:
    catalog_lines = "\n".join(f"  {item['id']} — {item['name']}" for item in catalog)
    return (
        "Ты — персональный силовой тренер. По истории тренировок пользователя ты "
        "составляешь план СЛЕДУЮЩЕЙ тренировки.\n\n"
        "Доступны ТОЛЬКО эти упражнения (используй их id и точные названия, "
        "других упражнений не существует):\n"
        f"{catalog_lines}\n\n"
        "Принципы:\n"
        "- Учитывай прогрессию: если в последних тренировках упражнение давалось "
        "легко (пометка '-') — добавь вес или повторения; если тяжело (пометка "
        "'+') — оставь или чуть снизь нагрузку.\n"
        "- Базовая прогрессия: +1 повтор к подходу или +2.5–5 кг, когда это уместно.\n"
        "- Чередуй нагрузку (load_type): после тяжёлой (heavy) тренировки логична "
        "средняя/лёгкая, и наоборот; учитывай, сколько дней прошло с последней.\n"
        "- Не нагружай повторно мышцы, которые недавно тяжело прорабатывались; "
        "балансируй верх/низ тела и тяги/жимы по истории.\n"
        "- Обычно 4–6 упражнений по 3–4 подхода; вес — реалистичный, исходя из "
        "недавних рабочих весов пользователя (не выдумывай резких скачков).\n"
        "- Все веса в килограммах. Пиши на русском.\n\n"
        "Текстовые пояснения:\n"
        "- В поле rationale дай развёрнутое объяснение (несколько предложений): "
        "почему выбран именно такой состав и нагрузка, что в истории на это "
        "повлияло, и почему НЕ выбран другой вариант. Пиши понятно, по делу, "
        "обращайся к пользователю на «ты».\n"
        "- В поле note у каждого упражнения дай короткое (одна фраза) обоснование "
        "именно этого выбора: почему такой вес и повторы относительно прошлого "
        "раза (например: «+2.5 кг — в прошлый раз все подходы дались легко» или "
        "«оставил вес — было тяжело»).\n\n"
        "Отвечай строго в заданной JSON-схеме, без какого-либо текста вне JSON."
    )


def _build_user_prompt(
    workouts: list[dict[str, Any]],
    body_weights: list[dict[str, Any]],
    today: date,
    history_limit: int,
) -> str:
    days = _days_since_last(workouts, today)
    days_line = (
        f"Дней с последней тренировки: {days}."
        if days is not None
        else "Дата последней тренировки неизвестна."
    )
    body_line = _serialize_body_weights(body_weights)
    history = _serialize_history(workouts, history_limit)
    chunks = [
        f"Сегодня: {today.isoformat()}.",
        days_line,
    ]
    if body_line:
        chunks.append(f"Динамика веса тела (последние замеры): {body_line}.")
    chunks.append(
        "История тренировок (от старых к новым; формат "
        "'дата [нагрузка] упражнение вес×повторы, ...', "
        "'-' = легко, '+' = тяжело):"
    )
    chunks.append(history)
    chunks.append("Составь план следующей тренировки.")
    return "\n\n".join(chunks)


def _build_schema(catalog: list[dict[str, Any]]) -> dict[str, Any]:
    exercise_ids = [item["id"] for item in catalog]
    return {
        "type": "object",
        "properties": {
            "focus": {
                "type": "string",
                "description": "На что нацелена тренировка (кратко, по-русски)",
            },
            "load_type": {"type": "string", "enum": list(ALLOWED_LOAD_TYPES)},
            "rationale": {
                "type": "string",
                "description": (
                    "Развёрнутое объяснение логики тренировки на русском: почему "
                    "такой состав и нагрузка, что в истории на это повлияло и "
                    "почему не выбран другой вариант"
                ),
            },
            "exercises": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "exercise_id": {"type": "integer", "enum": exercise_ids},
                        "name": {"type": "string"},
                        "note": {
                            "type": "string",
                            "description": (
                                "Короткое (одна фраза) обоснование выбора веса/повторов "
                                "для этого упражнения относительно прошлого раза"
                            ),
                        },
                        "sets": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "reps": {"type": "integer"},
                                    "weight": {"type": "number"},
                                },
                                "required": ["reps", "weight"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["exercise_id", "name", "note", "sets"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["focus", "load_type", "rationale", "exercises"],
        "additionalProperties": False,
    }


# --------------------------------------------------------------------------- #
# Anthropic call (stdlib urllib)
# --------------------------------------------------------------------------- #
def _call_anthropic(
    system: str,
    user: str,
    schema: dict[str, Any],
    *,
    model: str,
    max_tokens: int,
    api_key: str,
    timeout: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    body = json.dumps(
        {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": {"format": {"type": "json_schema", "schema": schema}},
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        ANTHROPIC_URL,
        data=body,
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise RecommendationError(
            f"Claude API вернул ошибку {exc.code}: {detail}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RecommendationError(f"Не удалось связаться с Claude API: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RecommendationError("Claude API не ответил вовремя") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RecommendationError("Claude API вернул не-JSON ответ") from exc

    if data.get("stop_reason") == "refusal":
        raise RecommendationError("Модель отказалась генерировать ответ")

    text = next(
        (block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"),
        "",
    )
    if not text:
        raise RecommendationError("Пустой ответ модели")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RecommendationError("Модель вернула невалидный JSON") from exc

    return parsed, data.get("usage", {}) or {}


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #
def _validate(raw: dict[str, Any], catalog: list[dict[str, Any]]) -> dict[str, Any]:
    valid_ids = {item["id"] for item in catalog}
    names_by_id = {item["id"]: item["name"] for item in catalog}

    load_type = raw.get("load_type")
    if load_type not in ALLOWED_LOAD_TYPES:
        load_type = "medium"

    exercises_out: list[dict[str, Any]] = []
    for exercise in raw.get("exercises", []) or []:
        if not isinstance(exercise, dict):
            continue
        try:
            exercise_id = int(exercise.get("exercise_id"))
        except (TypeError, ValueError):
            continue
        if exercise_id not in valid_ids:
            continue

        sets_out: list[dict[str, Any]] = []
        for workout_set in exercise.get("sets", []) or []:
            if not isinstance(workout_set, dict):
                continue
            try:
                reps = int(workout_set.get("reps"))
                weight = float(workout_set.get("weight"))
            except (TypeError, ValueError):
                continue
            if reps < 1:
                continue
            reps = min(reps, MAX_REPS)
            weight = min(max(weight, 0.0), MAX_WEIGHT)
            sets_out.append({"reps": reps, "weight": weight})
            if len(sets_out) >= MAX_SETS_PER_EXERCISE:
                break

        if not sets_out:
            continue

        exercises_out.append(
            {
                "exercise_id": exercise_id,
                # Trust the catalog name over whatever the model echoed back.
                "name": names_by_id.get(exercise_id, str(exercise.get("name", "")).strip()),
                "note": str(exercise.get("note", "")).strip(),
                "sets": sets_out,
            }
        )
        if len(exercises_out) >= MAX_EXERCISES:
            break

    if not exercises_out:
        raise RecommendationError("Модель не предложила ни одного валидного упражнения")

    return {
        "focus": str(raw.get("focus", "")).strip(),
        "load_type": load_type,
        "rationale": str(raw.get("rationale", "")).strip(),
        "exercises": exercises_out,
    }


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #
def generate(
    workouts: list[dict[str, Any]],
    body_weights: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    *,
    today: date | None = None,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    history_limit: int = DEFAULT_HISTORY_LIMIT,
    timeout: float = DEFAULT_TIMEOUT,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Generate a validated next-workout recommendation.

    Returns ``(recommendation, usage, model)``. Raises :class:`RecommendationError`
    on any failure (no history, missing key, API error, unusable output).
    """
    if not workouts:
        raise RecommendationError("Нет истории тренировок для рекомендации")

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RecommendationError("ANTHROPIC_API_KEY не настроен на сервере")

    today = today or date.today()
    system = _build_system_prompt(catalog)
    user = _build_user_prompt(workouts, body_weights, today, history_limit)
    schema = _build_schema(catalog)

    parsed, usage = _call_anthropic(
        system,
        user,
        schema,
        model=model,
        max_tokens=max_tokens,
        api_key=api_key,
        timeout=timeout,
    )
    recommendation = _validate(parsed, catalog)
    return recommendation, usage, model
