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
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable


ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-8")
DEFAULT_MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "3500"))
DEFAULT_HISTORY_LIMIT = int(os.getenv("RECOMMENDATION_HISTORY_LIMIT", "20"))
DEFAULT_TIMEOUT = float(os.getenv("ANTHROPIC_TIMEOUT", "90"))

# Transient failures worth retrying with backoff (rate limits, overload, gateway
# hiccups). Permanent errors (400/401/403/404, refusal) are never retried.
DEFAULT_MAX_RETRIES = int(os.getenv("ANTHROPIC_MAX_RETRIES", "2"))
DEFAULT_RETRY_BACKOFF = float(os.getenv("ANTHROPIC_RETRY_BACKOFF", "1.5"))
RETRYABLE_STATUS = frozenset({408, 409, 425, 429, 500, 502, 503, 504, 529})

# Server-side sanity bounds (JSON Schema can't express numeric ranges, so the
# model output is clamped/filtered after parsing).
MAX_REPS = 100
MAX_WEIGHT = 1000.0
MAX_EXERCISES = 10
MAX_SETS_PER_EXERCISE = 12
MAX_REST_DAYS = 7  # how far out the coach may schedule the next session

ALLOWED_LOAD_TYPES = ("heavy", "medium", "light")

_EFFORT_MARK = {"easy": "-", "ok": "", "hard": "+"}

# What each catalog machine actually is (from the athlete's own descriptions) —
# the terse RU names alone don't tell the model which muscle works.
CATALOG_SEMANTICS: dict[int, str] = {
    18: "рычажный жим сидя от груди, горизонтальный — грудь (вся), вторично трицепс и передняя дельта",
    1: "ТО ЖЕ движение, что и №18 (дубль в каталоге): встречается в старых записях истории — в ПЛАН всегда ставь id 18, id 1 не используй",
    17: "пек-дек «бабочка» — изоляция груди",
    9: "вертикальная тяга с двумя сходящимися ручками (имитация подтягиваний) — широчайшие, вторично бицепс",
    4: "подтягивания в гравитроне — широчайшие/верх спины. ВНИМАНИЕ: поле weight — вес ПРОТИВОВЕСА-помощи, прогресс = УМЕНЬШЕНИЕ веса",
    10: "рычажная горизонтальная тяга (хаммер) — толщина спины (середина трапеции, ромбовидные), вторично бицепс",
    13: "махи в тренажёре с упором в локти, сидя — средняя дельта",
    11: "тренажёр на сгибание рук — бицепс",
    12: "трицепс на блоке вниз (ручка варьируется: прямая/канат) — трицепс",
    8: "жим ногами в платформе 45° — квадрицепс + ягодичные",
    16: "разгибания ног сидя — квадрицепс (изоляция)",
    15: "сгибания ног лёжа — бицепс бедра",
}

# Muscles the athlete CANNOT train with the current catalog — standing context
# so the model knows they sit at zero structurally, not by athlete's laziness.
CATALOG_GAPS = "задняя дельта, икры, пресс, разгибатели спины — упражнений в каталоге нет"

# Primary muscle group per exercise — drives the weekly-volume accounting.
MUSCLE_GROUPS: dict[str, tuple[int, ...]] = {
    "грудь": (18, 1, 17),
    "спина": (9, 4, 10),
    "дельты": (13,),
    "бицепс": (11,),
    "трицепс": (12,),
    "квадрицепс/ягодичные": (8, 16),
    "бицепс бедра": (15,),
}


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
# Athlete profile
# --------------------------------------------------------------------------- #
def load_profile(path: Path | str | None) -> dict[str, Any] | None:
    """Load the athlete profile JSON (personal context for the coach prompt).

    The real profile lives ONLY on the server next to the database — it holds
    personal/medical context and must never be committed to the public repo
    (see coach_profile.example.json). Missing/broken file → None: generation
    still works, just without the personal context.
    """
    if not path:
        return None
    try:
        raw = json.loads(Path(path).read_text("utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    blocks = raw.get("blocks")
    if not isinstance(blocks, dict) or not blocks:
        return None
    return raw


def _render_profile(profile: dict[str, Any] | None) -> str:
    if not profile:
        return (
            "Профиль атлета не настроен — веди как взрослого здорового любителя, "
            "цель: качественный набор мышечной массы."
        )
    parts = []
    for title, text in profile.get("blocks", {}).items():
        body = str(text).strip()
        if body:
            parts.append(f"[{title}]\n{body}")
    return "\n\n".join(parts)


# --------------------------------------------------------------------------- #
# Computed training context (volumes, body-weight trend, plan adherence)
# --------------------------------------------------------------------------- #
def _workout_date(workout: dict[str, Any]) -> date | None:
    try:
        return date.fromisoformat(str(workout.get("workout_date", "")))
    except ValueError:
        return None


def _sets_per_group(workouts: list[dict[str, Any]], today: date, days: int) -> dict[str, int]:
    """Work sets per muscle group over the trailing `days` window."""
    group_of: dict[int, str] = {}
    for group, ids in MUSCLE_GROUPS.items():
        for exercise_id in ids:
            group_of[exercise_id] = group

    counts = {group: 0 for group in MUSCLE_GROUPS}
    cutoff = days - 1
    for workout in workouts:
        when = _workout_date(workout)
        if when is None or (today - when).days > cutoff or when > today:
            continue
        for exercise in (workout.get("data", {}) or {}).get("exercises", []) or []:
            group = group_of.get(exercise.get("exercise_id"))
            if group is None:
                continue
            counts[group] += len(exercise.get("sets", []) or [])
    return counts


def _volume_report(workouts: list[dict[str, Any]], today: date) -> str:
    week = _sets_per_group(workouts, today, 7)
    month = _sets_per_group(workouts, today, 28)
    lines = []
    for group in MUSCLE_GROUPS:
        weekly_avg = month[group] / 4
        lines.append(f"  {group}: {week[group]} подходов за 7 дней (в среднем {weekly_avg:.1f}/нед за месяц)")
    return "\n".join(lines)


# Plausible adult body-weight bounds: entries outside are logging noise (e.g.
# an exercise weight saved into the body-weight table) and must never reach
# the calorie-advice logic.
MIN_PLAUSIBLE_BODY_WEIGHT = 40.0
MAX_PLAUSIBLE_BODY_WEIGHT = 150.0


def _body_weight_report(body_weights: list[dict[str, Any]], today: date) -> str | None:
    """Last weigh-ins plus the trend over the recent window (implausible
    entries dropped, staleness flagged so the model won't advise on garbage)."""
    points: list[tuple[date, float]] = []
    dropped = 0
    for entry in body_weights:  # oldest-first
        try:
            when = date.fromisoformat(str(entry.get("entry_date", "")))
            weight = float(entry.get("weight", 0))
        except (TypeError, ValueError):
            continue
        if not (MIN_PLAUSIBLE_BODY_WEIGHT <= weight <= MAX_PLAUSIBLE_BODY_WEIGHT):
            dropped += 1
            continue
        points.append((when, weight))
    if not points:
        return None

    tail = points[-6:]
    series = ", ".join(f"{when.isoformat()}: {weight:g}кг" for when, weight in tail)
    last_date, _ = points[-1]
    age_days = (today - last_date).days
    line = f"Замеры: {series}. Дней с последнего замера: {age_days}."
    if dropped:
        line += f" (отброшено неправдоподобных записей: {dropped})"
    if age_days > 14:
        line += " ДАННЫЕ УСТАРЕЛИ — советы по калориям не давай, попроси взвеситься."

    window = [p for p in points if (today - p[0]).days <= 42]
    if len(window) >= 2 and (window[-1][0] - window[0][0]).days >= 7:
        span_days = (window[-1][0] - window[0][0]).days
        per_week = (window[-1][1] - window[0][1]) / span_days * 7
        line += f" Тренд: {per_week:+.2f} кг/нед за последние {span_days} дн."
    return line


def _plan_adherence_report(workouts: list[dict[str, Any]]) -> str | None:
    """Compare the most recent snapshot-carrying workout against its plan."""
    for workout in workouts:  # newest-first
        snapshot = (workout.get("data", {}) or {}).get("recommendation")
        if not isinstance(snapshot, dict):
            continue
        planned = {
            ex.get("exercise_id"): ex
            for ex in snapshot.get("exercises", []) or []
            if isinstance(ex, dict)
        }
        if not planned:
            return None
        actual = {
            ex.get("exercise_id"): ex
            for ex in (workout.get("data", {}) or {}).get("exercises", []) or []
        }

        done, total = 0, 0
        deviations: list[str] = []
        for exercise_id, plan_ex in planned.items():
            plan_sets = plan_ex.get("sets", []) or []
            total += len(plan_sets)
            fact = actual.get(exercise_id)
            if fact is None:
                deviations.append(f"{plan_ex.get('name', exercise_id)}: пропущено")
                continue
            fact_sets = fact.get("sets", []) or []
            done += min(len(fact_sets), len(plan_sets))
            if len(fact_sets) != len(plan_sets):
                deviations.append(
                    f"{plan_ex.get('name', exercise_id)}: {len(fact_sets)}/{len(plan_sets)} подходов"
                )
        extras = [
            str(ex.get("name", ""))
            for exercise_id, ex in actual.items()
            if exercise_id not in planned
        ]
        if extras:
            deviations.append("сверх плана: " + ", ".join(filter(None, extras)))

        summary = f"Последняя тренировка по твоему плану ({workout.get('workout_date')}): {done}/{total} плановых подходов"
        if deviations:
            summary += "; отклонения: " + "; ".join(deviations[:4])
        return summary + "."
    return None


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


def _build_system_prompt(
    catalog: list[dict[str, Any]],
    profile: dict[str, Any] | None = None,
) -> str:
    catalog_lines = "\n".join(
        f"  {item['id']} — {item['name']}: {CATALOG_SEMANTICS.get(item['id'], 'тренажёр')}"
        for item in catalog
    )
    return (
        "Ты — персональный силовой тренер этого атлета и полностью заменяешь живого "
        "тренера: ведёшь его многомесячную программу, решаешь, какой будет СЛЕДУЮЩАЯ "
        "тренировка, когда её провести, когда дать отдых или разгрузку, и следишь за "
        "недельными объёмами и движением к цели. Ты видишь его историю и контекст в "
        "каждом запросе — твоя задача давать связную систему, а не тренировку в вакууме.\n\n"
        "=== АТЛЕТ ===\n"
        f"{_render_profile(profile)}\n\n"
        "=== ТРЕНАЖЁРЫ (каталог) ===\n"
        "В план включай ТОЛЬКО эти упражнения (id и названия точные):\n"
        f"{catalog_lines}\n"
        f"Структурные пробелы каталога: {CATALOG_GAPS}.\n"
        "Поле name каждого элемента exercises[] должно ДОСЛОВНО совпадать с названием "
        "из каталога для его exercise_id. Если для цели не хватает движения (в первую "
        "очередь задняя дельта при таком объёме жимов) — предложи его ТЕКСТОМ в "
        "rationale («советую добавить X, потому что Y»), но не в каждой карточке — "
        "примерно раз в пару недель; атлет сам решит и добавит. В exercises[] "
        "несуществующие упражнения не включай никогда.\n\n"
        "=== ТРЕНЕРСКАЯ ПОЛИТИКА ===\n"
        "- Ритм: базово 3 full body в неделю с днём отдыха между (допустимо 2–4 по "
        "усталости, стрессу и давности последней тренировки).\n"
        "- Недельный объём (прямые подходы): крупные группы (грудь, спина, "
        "квадрицепс+ягодичные) 10–16; средняя дельта 6–12; бицепс/трицепс напрямую "
        "4–8 — жимы добирают трицепсу и передней дельте, тяги — бицепсу примерно "
        "половину стимула, поэтому больше прямой работы рукам не нужно; бицепс бедра "
        "5–10 — ставь сгибания ног почти в каждую сессию, пока группа хронически "
        "недобирает. Наращивай объёмы плавно от нижних границ.\n"
        "- Сессия: 14–20 рабочих подходов, ориентир ~60 минут (при 18+ подходах "
        "предупреди, что выйдет ближе к 75–90 мин, или сократи отдых на изоляции до "
        "60–90 сек). Разминочные подходы в план НЕ включай — атлет делает их сам.\n"
        "- Волны интенсивности ДЛЯ БАЗОВЫХ движений (жимы, тяги, жим ногами): heavy "
        "6–10 повторов, medium 10–14, light 12–18. Изоляция (дельты, бицепс, трицепс, "
        "бабочка, разгибания/сгибания ног) остаётся в 10–15+ повторах даже в "
        "heavy-день. После heavy-сессии heavy не ставь.\n"
        "- Метки нагрузки в истории ([heavy]/[medium]/[light]/[?]) проставлялись "
        "автоматикой/атлетом и могут быть неточны — оценивай реальную тяжесть сессии "
        "сам по весам и повторам относительно истории.\n"
        "- Усилие: рабочие подходы с запасом 1–2 повтора; на изоляции в последнем "
        "подходе допустимо 0–1; жимы (ногами, от груди) до отказа не доводить.\n"
        "- Прогрессия: шаг веса бери из истории КОНКРЕТНОГО тренажёра (каким шагом "
        "атлет реально менял вес). +1 повтор или +1 шаг веса, если в прошлый раз "
        "подходы шли с отметкой «-» (легко) или без отметки; при «+» (тяжело) — "
        "закрепи вес. Одиночные аномальные подходы (резко выпадающий вес среди "
        "стабильной серии) считай шумом записи — прогрессию от них не строй.\n"
        "- Возврат после перерыва: если с последней тренировки прошло ≥14 дней — "
        "первая сессия medium/light на ~85–90% последних рабочих весов, 10–14 "
        "подходов, без отказа (правило 14–20 подходов не действует); возврат к "
        "прежним весам за 2–3 сессии. Длинный перерыв сам по себе — разгрузка: "
        "счётчик deload обнуляется, правило «после heavy не heavy» через перерыв "
        "не применяется. После перерыва в rationale вместо сводки нулевых объёмов "
        "опиши план разгона на 2–3 сессии.\n"
        "- Разгрузка (deload): при падении повторов на тех же весах две сессии подряд "
        "или ~6 недель непрерывных тренировок без разгрузки — предложи лёгкую неделю "
        "(−30–40% объёма) и прямо скажи об этом в rationale.\n"
        "- Регулярность: если перерывы >10 дней повторяются, мягко предложи в "
        "rationale привязать тренировки к конкретным дням недели — без нотаций.\n"
        "- Питание: следи за трендом веса тела по скользящему среднему 2–3 недель. "
        "Целевой темп +0.4–0.5 кг/мес, потолок набора ~84 кг при сохранении сухости. "
        "Стартовый ориентир ~2350–2450 ккал; вес стоит дольше 2 недель — посоветуй "
        "+100–150 ккал; растёт быстрее ~0.2 кг/нед — посоветуй −100–150 ккал. Белок "
        "(~140 г) достаточен — не трогай. Советы по калориям давай ТОЛЬКО по свежим "
        "(≤14 дней) и правдоподобным замерам; иначе попроси взвеситься и калории не "
        "обсуждай.\n"
        "- Медицинская граница: вопросы ГЗТ, дозировок, анализов и давления — зона "
        "лечащего врача. Никаких советов и интерпретаций по ним не давай; гормональный "
        "фон используй только как контекст восстановления.\n\n"
        "=== RATIONALE (тренерский комментарий в карточке) ===\n"
        "Пиши на «ты», как живой тренер, структурно и по делу:\n"
        "1) почему именно такой день (тяжесть, состав) — с опорой на объёмы недели, "
        "давность и отметки тяжести;\n"
        "2) КОГДА идти на эту тренировку — словами (сегодня / завтра / «дай ещё "
        "день отдыха») и обязательно тем же числом в поле rest_days "
        "(0 = сегодня, 1 = завтра, 2 = послезавтра); держи текст и rest_days "
        "согласованными;\n"
        "3) краткий статус недельного объёма по группам (где добор, где уже хватит);\n"
        "4) комментарий по весу тела и калориям, если есть свежие данные;\n"
        "5) при необходимости — предложение нового упражнения или разгрузки.\n"
        "В note каждого упражнения — одна фраза: почему такой вес/повторы относительно "
        "прошлого раза («+2.5 кг — прошлый раз все подходы easy», «закрепляем вес — было "
        "тяжело»).\n\n"
        "Все веса в килограммах. Отвечай строго в заданной JSON-схеме, без текста вне JSON."
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
    chunks = [
        f"Сегодня: {today.isoformat()} ({_RU_WEEKDAYS[today.weekday()]}).",
        days_line,
        "Рабочие подходы по группам (по основной мышце упражнения):\n"
        + _volume_report(workouts, today),
    ]

    body_line = _body_weight_report(body_weights, today)
    if body_line:
        chunks.append(f"Вес тела. {body_line}")

    adherence = _plan_adherence_report(workouts)
    if adherence:
        chunks.append(adherence)

    chunks.append(
        "История тренировок (от старых к новым; формат "
        "'дата [нагрузка] упражнение вес×повторы, ...'). Значок после подхода — "
        "субъективная тяжесть: '-' = легко, '+' = тяжело (это НЕ дополнительные "
        "повторы), без значка = нормально:"
    )
    chunks.append(_serialize_history(workouts, history_limit))
    chunks.append(
        "Составь план следующей тренировки и тренерский комментарий (когда идти, "
        "статус недельных объёмов, питание по тренду веса)."
    )
    return "\n\n".join(chunks)


_RU_WEEKDAYS = (
    "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье",
)


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
            "rest_days": {
                "type": "integer",
                "description": (
                    "Через сколько дней от сегодня проводить эту тренировку: "
                    "0 = сегодня, 1 = завтра, 2 = послезавтра и т.д. Учитывай "
                    "давность последней тренировки, нагрузку прошлой сессии, "
                    "усталость/сон/стресс, ритм ~3 раза в неделю и гормональный "
                    "цикл (тяжёлые сессии — ближе к началу недельного цикла)"
                ),
            },
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
        "required": ["focus", "load_type", "rest_days", "rationale", "exercises"],
        "additionalProperties": False,
    }


# --------------------------------------------------------------------------- #
# Anthropic call (stdlib urllib)
# --------------------------------------------------------------------------- #
def _fetch_anthropic(
    request: urllib.request.Request,
    *,
    timeout: float,
    max_retries: int,
    backoff: float,
    sleep: Callable[[float], None],
) -> str:
    """POST to the API, retrying transient failures with exponential backoff.

    Returns the raw response body. Raises :class:`RecommendationError` on a
    permanent failure or once retries are exhausted.
    """
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            retryable = exc.code in RETRYABLE_STATUS
            if not retryable or attempt >= max_retries:
                detail = exc.read().decode("utf-8", "replace")[:300]
                raise RecommendationError(
                    f"Claude API вернул ошибку {exc.code}: {detail}"
                ) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt >= max_retries:
                if isinstance(exc, TimeoutError) or isinstance(
                    getattr(exc, "reason", None), TimeoutError
                ):
                    raise RecommendationError("Claude API не ответил вовремя") from exc
                reason = getattr(exc, "reason", exc)
                raise RecommendationError(
                    f"Не удалось связаться с Claude API: {reason}"
                ) from exc
        sleep(backoff * (2 ** attempt))
        attempt += 1


def _call_anthropic(
    system: str,
    user: str,
    schema: dict[str, Any],
    *,
    model: str,
    max_tokens: int,
    api_key: str,
    timeout: float,
    max_retries: int = DEFAULT_MAX_RETRIES,
    backoff: float = DEFAULT_RETRY_BACKOFF,
    sleep: Callable[[float], None] = time.sleep,
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

    raw = _fetch_anthropic(
        request,
        timeout=timeout,
        max_retries=max_retries,
        backoff=backoff,
        sleep=sleep,
    )

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

    try:
        rest_days = int(raw.get("rest_days"))
    except (TypeError, ValueError):
        rest_days = 1
    rest_days = min(max(rest_days, 0), MAX_REST_DAYS)

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
        "rest_days": rest_days,
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
    profile: dict[str, Any] | None = None,
    today: date | None = None,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    history_limit: int = DEFAULT_HISTORY_LIMIT,
    timeout: float = DEFAULT_TIMEOUT,
    max_retries: int = DEFAULT_MAX_RETRIES,
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
    system = _build_system_prompt(catalog, profile)
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
        max_retries=max_retries,
    )
    recommendation = _validate(parsed, catalog)
    # Resolve the model's relative rest_days into an absolute date at generation
    # time (auto-freshness regenerates daily, so it stays current). The card
    # shows a fixed target instead of doing date math on the client.
    recommendation["next_workout_date"] = (
        today + timedelta(days=recommendation["rest_days"])
    ).isoformat()
    return recommendation, usage, model
