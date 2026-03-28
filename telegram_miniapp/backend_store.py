from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


ALLOWED_LOAD_TYPES = {"heavy", "medium", "light", "deload"}


def utc_now() -> int:
    return int(time.time())


def normalize_load_type(value: object, exercises: list[dict[str, Any]]) -> str:
    if isinstance(value, str) and value in ALLOWED_LOAD_TYPES:
        return value

    total_volume = 0.0
    for exercise in exercises:
        for workout_set in exercise["sets"]:
            weight = float(workout_set["weight"])
            reps = int(workout_set["reps"])
            if weight > 0 and reps > 0:
                total_volume += weight * reps

    if total_volume >= 3000:
        return "heavy"
    if total_volume >= 1600:
        return "medium"
    return "light"


def normalize_notes(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_workout_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], str]:
    raw_exercises = payload.get("data", {}).get("exercises", [])
    if not isinstance(raw_exercises, list) or not raw_exercises:
        raise ValueError("Workout must contain at least one exercise")

    normalized_exercises: list[dict[str, Any]] = []
    for raw_exercise in raw_exercises:
        if not isinstance(raw_exercise, dict):
            raise ValueError("Exercise payload must be an object")

        exercise_id = raw_exercise.get("exercise_id")
        if not isinstance(exercise_id, int):
            raise ValueError("exercise_id must be an integer")

        exercise_name = str(raw_exercise.get("name", "")).strip()
        if not exercise_name:
            raise ValueError("Exercise name is required")

        raw_sets = raw_exercise.get("sets", [])
        if not isinstance(raw_sets, list) or not raw_sets:
            raise ValueError("Each exercise must contain at least one set")

        normalized_sets: list[dict[str, Any]] = []
        for index, raw_set in enumerate(raw_sets, start=1):
            if not isinstance(raw_set, dict):
                raise ValueError("Set payload must be an object")

            try:
                reps = int(raw_set.get("reps", 0))
                weight = float(raw_set.get("weight", 0))
            except (TypeError, ValueError) as exc:
                raise ValueError("Set reps and weight must be numeric") from exc

            if reps < 1:
                raise ValueError("Set reps must be at least 1")
            if weight < 0:
                raise ValueError("Set weight must be zero or positive")

            normalized_sets.append(
                {
                    "set_index": index,
                    "reps": reps,
                    "weight": weight,
                    "notes": normalize_notes(raw_set.get("notes")),
                }
            )

        normalized_exercises.append(
            {
                "exercise_id": exercise_id,
                "name": exercise_name,
                "sets": normalized_sets,
            }
        )

    workout_date = str(payload.get("workout_date", "")).strip()
    if len(workout_date) != 10:
        raise ValueError("workout_date must be in YYYY-MM-DD format")

    client_id = str(payload.get("client_id") or payload.get("id") or "").strip()
    if not client_id:
        raise ValueError("client_id is required")

    data = payload.get("data", {})
    normalized_payload = {
        "workout_date": workout_date,
        "plan_id": None,
        "data": {
            "focus": None,
            "notes": normalize_notes(data.get("notes")),
            "load_type": normalize_load_type(data.get("load_type"), normalized_exercises),
            "exercises": normalized_exercises,
        },
    }

    return normalized_payload, client_id


class MiniAppStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_user_id INTEGER UNIQUE,
                    auth_source TEXT NOT NULL,
                    debug_alias TEXT UNIQUE,
                    username TEXT,
                    first_name TEXT NOT NULL,
                    last_name TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workouts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    client_id TEXT,
                    workout_date TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    UNIQUE(user_id, client_id)
                );

                CREATE INDEX IF NOT EXISTS idx_workouts_user_date
                ON workouts(user_id, workout_date DESC, id DESC);
                """
            )

    def ensure_debug_user(self, alias: str, first_name: str = "Browser", last_name: str = "Debug") -> dict[str, Any]:
        timestamp = utc_now()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE debug_alias = ?",
                (alias,),
            ).fetchone()
            if row is None:
                connection.execute(
                    """
                    INSERT INTO users (
                        telegram_user_id,
                        auth_source,
                        debug_alias,
                        username,
                        first_name,
                        last_name,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (None, "debug", alias, None, first_name, last_name, timestamp, timestamp),
                )
                row = connection.execute(
                    "SELECT * FROM users WHERE debug_alias = ?",
                    (alias,),
                ).fetchone()

        if row is None:
            raise RuntimeError("Failed to create debug user")
        return self._serialize_user(row)

    def upsert_telegram_user(
        self,
        telegram_user: dict[str, Any],
        auth_source: str = "telegram",
    ) -> dict[str, Any]:
        telegram_user_id = telegram_user.get("id")
        if isinstance(telegram_user_id, str) and telegram_user_id.isdigit():
            telegram_user_id = int(telegram_user_id)
        if not isinstance(telegram_user_id, int):
            raise ValueError("Telegram user id is missing in initData")

        timestamp = utc_now()
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE telegram_user_id = ?",
                (telegram_user_id,),
            ).fetchone()

            values = (
                str(telegram_user.get("username") or "").strip() or None,
                str(telegram_user.get("first_name") or "Telegram").strip(),
                str(telegram_user.get("last_name") or "").strip() or None,
                timestamp,
            )

            if row is None:
                connection.execute(
                    """
                    INSERT INTO users (
                        telegram_user_id,
                        auth_source,
                        debug_alias,
                        username,
                        first_name,
                        last_name,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        telegram_user_id,
                        auth_source,
                        None,
                        values[0],
                        values[1],
                        values[2],
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                connection.execute(
                    """
                    UPDATE users
                    SET auth_source = ?, username = ?, first_name = ?, last_name = ?, updated_at = ?
                    WHERE telegram_user_id = ?
                    """,
                    (auth_source, *values, telegram_user_id),
                )

            row = connection.execute(
                "SELECT * FROM users WHERE telegram_user_id = ?",
                (telegram_user_id,),
            ).fetchone()

        if row is None:
            raise RuntimeError("Failed to upsert Telegram user")
        return self._serialize_user(row)

    def get_user_by_id(self, user_id: int) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        return self._serialize_user(row) if row is not None else None

    def list_workouts(self, user_id: int) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, user_id, client_id, workout_date, payload_json, created_at, updated_at
                FROM workouts
                WHERE user_id = ?
                ORDER BY workout_date DESC, id DESC
                """,
                (user_id,),
            ).fetchall()
        return [self._deserialize_workout(row) for row in rows]

    def save_workout(self, user_id: int, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        normalized_payload, client_id = normalize_workout_payload(payload)
        timestamp = utc_now()

        with self._connect() as connection:
            existing = connection.execute(
                """
                SELECT id, user_id, client_id, workout_date, payload_json, created_at, updated_at
                FROM workouts
                WHERE user_id = ? AND client_id = ?
                """,
                (user_id, client_id),
            ).fetchone()

            if existing is not None:
                return self._deserialize_workout(existing), False

            cursor = connection.execute(
                """
                INSERT INTO workouts (
                    user_id,
                    client_id,
                    workout_date,
                    payload_json,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    client_id,
                    normalized_payload["workout_date"],
                    json.dumps(normalized_payload, ensure_ascii=False),
                    timestamp,
                    timestamp,
                ),
            )

            row = connection.execute(
                """
                SELECT id, user_id, client_id, workout_date, payload_json, created_at, updated_at
                FROM workouts
                WHERE id = ?
                """,
                (cursor.lastrowid,),
            ).fetchone()

        if row is None:
            raise RuntimeError("Failed to persist workout")
        return self._deserialize_workout(row), True

    def _deserialize_workout(self, row: sqlite3.Row) -> dict[str, Any]:
        payload = json.loads(row["payload_json"])
        return {
            "id": row["id"],
            "workout_date": payload["workout_date"],
            "plan_id": payload.get("plan_id"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "data": payload["data"],
        }

    def _serialize_user(self, row: sqlite3.Row) -> dict[str, Any]:
        first_name = row["first_name"] or ""
        last_name = row["last_name"] or ""
        display_name = f"{first_name} {last_name}".strip() or "Trainer user"
        return {
            "id": row["id"],
            "auth_source": row["auth_source"],
            "telegram_user_id": row["telegram_user_id"],
            "username": row["username"],
            "first_name": row["first_name"],
            "last_name": row["last_name"],
            "debug_alias": row["debug_alias"],
            "is_default_debug_user": row["auth_source"] == "debug",
            "display_name": display_name,
        }
