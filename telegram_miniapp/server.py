#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import time
from http.cookies import SimpleCookie
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlparse

from backend_store import MiniAppStore


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = Path(os.getenv("MINIAPP_STATIC_DIR", str(BASE_DIR / "web"))).resolve()
DATA_DIR = BASE_DIR / "data"
HOST = os.getenv("MINIAPP_HOST", "127.0.0.1")
PORT = int(os.getenv("MINIAPP_PORT", "8080"))
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
MAX_AUTH_AGE_SECONDS = int(os.getenv("MINIAPP_MAX_AUTH_AGE", "86400"))
DEV_MODE = os.getenv("MINIAPP_DEV_MODE", "").lower() in {"1", "true", "yes", "on"}
ALLOW_DEBUG_USER = os.getenv("MINIAPP_ALLOW_DEBUG_USER", "").lower() in {"1", "true", "yes", "on"}
DEFAULT_DEBUG_USER_ALIAS = os.getenv("MINIAPP_DEFAULT_DEBUG_USER_ALIAS", "browser-default")
DEFAULT_DEBUG_USER_FIRST_NAME = os.getenv("MINIAPP_DEFAULT_DEBUG_USER_FIRST_NAME", "Browser")
DEFAULT_DEBUG_USER_LAST_NAME = os.getenv("MINIAPP_DEFAULT_DEBUG_USER_LAST_NAME", "Debug")
DB_PATH = Path(os.getenv("MINIAPP_DB_PATH", str(DATA_DIR / "trainer.db")))
SESSION_COOKIE_NAME = "trainer_session"
SESSION_SECRET = os.getenv("MINIAPP_SESSION_SECRET") or BOT_TOKEN or "trainer-dev-session-secret"
SESSION_MAX_AGE_SECONDS = int(os.getenv("MINIAPP_SESSION_MAX_AGE", "2592000"))
COOKIE_SECURE = os.getenv("MINIAPP_COOKIE_SECURE", "").lower() in {"1", "true", "yes", "on"}
WATCHED_EXTENSIONS = {".py", ".html", ".css", ".js", ".json", ".md"}
STORE = MiniAppStore(DB_PATH)


def iter_watched_files() -> list[Path]:
    return [
        path
        for path in sorted(BASE_DIR.rglob("*"))
        if path.is_file()
        and path.suffix in WATCHED_EXTENSIONS
        and "__pycache__" not in path.parts
    ]


def build_dev_version() -> dict[str, object]:
    hasher = hashlib.sha1()
    latest_mtime_ns = 0
    watched_files = 0

    for path in iter_watched_files():
        stat = path.stat()
        relative_path = path.relative_to(BASE_DIR).as_posix()
        latest_mtime_ns = max(latest_mtime_ns, stat.st_mtime_ns)
        watched_files += 1
        hasher.update(relative_path.encode("utf-8"))
        hasher.update(b":")
        hasher.update(str(stat.st_mtime_ns).encode("utf-8"))
        hasher.update(b"\n")

    return {
        "dev_mode": DEV_MODE,
        "version": hasher.hexdigest()[:12],
        "latest_mtime_ns": latest_mtime_ns,
        "watched_files": watched_files,
    }


def build_data_check_string(init_data: str) -> tuple[str, str, dict[str, str]]:
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    received_hash = pairs.pop("hash", "")
    pairs.pop("signature", None)

    if not received_hash:
        raise ValueError("Missing hash in initData")

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(pairs.items(), key=lambda item: item[0])
    )
    return data_check_string, received_hash, pairs


def validate_init_data(init_data: str, bot_token: str) -> dict[str, object]:
    if not init_data.strip():
        return {"ok": False, "reason": "initData is empty"}

    if not bot_token:
        return {"ok": False, "reason": "BOT_TOKEN is not configured on the server"}

    try:
        data_check_string, received_hash, parsed_fields = build_data_check_string(init_data)
    except ValueError as exc:
        return {"ok": False, "reason": str(exc)}

    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        return {
            "ok": False,
            "reason": "Hash mismatch. initData did not pass Telegram verification.",
        }

    auth_date_raw = parsed_fields.get("auth_date")
    auth_age_seconds = None
    auth_is_fresh = True
    if auth_date_raw:
        try:
            auth_timestamp = int(auth_date_raw)
            auth_age_seconds = int(time.time()) - auth_timestamp
            auth_is_fresh = auth_age_seconds <= MAX_AUTH_AGE_SECONDS
        except ValueError:
            auth_is_fresh = False

    decoded_fields: dict[str, object] = {}
    for key, value in parsed_fields.items():
        if key in {"user", "chat", "receiver"}:
            try:
                decoded_fields[key] = json.loads(value)
            except json.JSONDecodeError:
                decoded_fields[key] = value
        else:
            decoded_fields[key] = value

    return {
        "ok": True,
        "auth_is_fresh": auth_is_fresh,
        "auth_age_seconds": auth_age_seconds,
        "received": decoded_fields,
    }


def debug_user_enabled() -> bool:
    return DEV_MODE or ALLOW_DEBUG_USER


def make_session_value(user_id: int) -> str:
    payload = str(user_id)
    signature = hmac.new(
        SESSION_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}.{signature}"


def read_session_user_id(cookie_value: str) -> int | None:
    if not cookie_value or "." not in cookie_value:
        return None

    raw_user_id, received_signature = cookie_value.split(".", 1)
    try:
        user_id = int(raw_user_id)
    except ValueError:
        return None

    expected_signature = hmac.new(
        SESSION_SECRET.encode("utf-8"),
        raw_user_id.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, received_signature):
        return None

    return user_id


class MiniAppHandler(BaseHTTPRequestHandler):
    server_version = "TrainerMiniApp/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "server_time": int(time.time()),
                    "bot_token_configured": bool(BOT_TOKEN),
                    "debug_user_enabled": debug_user_enabled(),
                    "db_path": str(DB_PATH),
                },
            )
            return

        if path == "/api/dev/version":
            self._send_json(HTTPStatus.OK, build_dev_version())
            return

        if path == "/api/workouts":
            user, headers = self._resolve_current_user(allow_debug_fallback=True)
            if user is None:
                self._send_json(
                    HTTPStatus.UNAUTHORIZED,
                    {
                        "ok": False,
                        "reason": "No active session. Open Mini App from Telegram or enable debug user mode.",
                    },
                )
                return

            workouts = STORE.list_workouts(int(user["id"]))
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "user": user, "workouts": workouts},
                extra_headers=headers,
            )
            return

        static_path = self._resolve_static_path(path)
        if static_path is not None:
            self._send_file(static_path)
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/telegram/auth":
            payload = self._read_json_body()
            if payload is None:
                return

            init_data = str(payload.get("initData", ""))
            validation_result = validate_init_data(init_data, BOT_TOKEN)
            status = HTTPStatus.OK if validation_result.get("ok") else HTTPStatus.BAD_REQUEST
            self._send_json(status, validation_result)
            return

        if path == "/api/session/resolve":
            payload = self._read_json_body()
            if payload is None:
                return

            current_user, current_headers = self._resolve_current_user()
            if current_user is not None and not payload.get("initData"):
                self._send_json(
                    HTTPStatus.OK,
                    {"ok": True, "user": current_user},
                    extra_headers=current_headers,
                )
                return

            init_data = str(payload.get("initData", ""))
            unsafe_telegram_user = payload.get("unsafeUser")
            validation_result = None
            if init_data:
                validation_result = validate_init_data(init_data, BOT_TOKEN)
                if not validation_result.get("ok"):
                    if not isinstance(unsafe_telegram_user, dict):
                        self._send_json(HTTPStatus.BAD_REQUEST, validation_result)
                        return
                else:
                    telegram_user = validation_result.get("received", {}).get("user")
                    if not isinstance(telegram_user, dict):
                        self._send_json(
                            HTTPStatus.BAD_REQUEST,
                            {"ok": False, "reason": "Telegram user payload is missing in initData"},
                        )
                        return

                    try:
                        user = STORE.upsert_telegram_user(telegram_user)
                    except ValueError as exc:
                        self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "reason": str(exc)})
                        return

                    headers = {"Set-Cookie": self._build_session_cookie(int(user["id"]))}
                    self._send_json(
                        HTTPStatus.OK,
                        {
                            "ok": True,
                            "user": user,
                            "auth_mode": "telegram",
                            "auth_is_fresh": validation_result.get("auth_is_fresh"),
                            "auth_age_seconds": validation_result.get("auth_age_seconds"),
                        },
                        extra_headers=headers,
                    )
                    return

            if isinstance(unsafe_telegram_user, dict):
                try:
                    user = STORE.upsert_telegram_user(
                        unsafe_telegram_user,
                        auth_source="telegram_unsafe",
                    )
                except ValueError as exc:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "reason": str(exc)})
                    return

                headers = {"Set-Cookie": self._build_session_cookie(int(user["id"]))}
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "user": user,
                        "auth_mode": "telegram_unsafe",
                        "warning": "Mini App launched without verified initData, using Telegram user fallback.",
                        "validation_reason": validation_result.get("reason") if validation_result else None,
                    },
                    extra_headers=headers,
                )
                return

            if debug_user_enabled():
                user = STORE.ensure_debug_user(
                    DEFAULT_DEBUG_USER_ALIAS,
                    DEFAULT_DEBUG_USER_FIRST_NAME,
                    DEFAULT_DEBUG_USER_LAST_NAME,
                )
                headers = {"Set-Cookie": self._build_session_cookie(int(user["id"]))}
                self._send_json(
                    HTTPStatus.OK,
                    {"ok": True, "user": user, "auth_mode": "debug"},
                    extra_headers=headers,
                )
                return

            self._send_json(
                HTTPStatus.UNAUTHORIZED,
                {
                    "ok": False,
                    "reason": "Open Mini App from Telegram or enable debug user mode for browser access.",
                },
            )
            return

        if path == "/api/workouts":
            payload = self._read_json_body()
            if payload is None:
                return

            user, headers = self._resolve_current_user(allow_debug_fallback=True)
            if user is None:
                self._send_json(
                    HTTPStatus.UNAUTHORIZED,
                    {
                        "ok": False,
                        "reason": "No active session. Open Mini App from Telegram or enable debug user mode.",
                    },
                )
                return

            try:
                workout, created = STORE.save_workout(int(user["id"]), payload)
            except ValueError as exc:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "reason": str(exc)})
                return

            self._send_json(
                HTTPStatus.CREATED if created else HTTPStatus.OK,
                {"ok": True, "created": created, "user": user, "workout": workout},
                extra_headers=headers,
            )
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Not found"})

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        workout_id = self._parse_workout_id(path)
        if workout_id is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Not found"})
            return

        payload = self._read_json_body()
        if payload is None:
            return

        user, headers = self._resolve_current_user(allow_debug_fallback=True)
        if user is None:
            self._send_json(
                HTTPStatus.UNAUTHORIZED,
                {
                    "ok": False,
                    "reason": "No active session. Open Mini App from Telegram or enable debug user mode.",
                },
            )
            return

        try:
            workout = STORE.update_workout(int(user["id"]), workout_id, payload)
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "reason": str(exc)})
            return

        if workout is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Workout not found"})
            return

        self._send_json(
            HTTPStatus.OK,
            {"ok": True, "user": user, "workout": workout},
            extra_headers=headers,
        )

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        workout_id = self._parse_workout_id(path)
        if workout_id is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Not found"})
            return

        user, headers = self._resolve_current_user(allow_debug_fallback=True)
        if user is None:
            self._send_json(
                HTTPStatus.UNAUTHORIZED,
                {
                    "ok": False,
                    "reason": "No active session. Open Mini App from Telegram or enable debug user mode.",
                },
            )
            return

        workout = STORE.delete_workout(int(user["id"]), workout_id)
        if workout is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Workout not found"})
            return

        self._send_json(
            HTTPStatus.OK,
            {"ok": True, "user": user, "workout": workout, "deleted": True},
            extra_headers=headers,
        )

    def log_message(self, format: str, *args: object) -> None:
        print(f"[miniapp] {self.address_string()} - {format % args}")

    def _read_json_body(self) -> dict[str, Any] | None:
        content_length = int(self.headers.get("Content-Length", "0"))
        payload_raw = self.rfile.read(content_length).decode("utf-8")
        try:
            return json.loads(payload_raw or "{}")
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "reason": "Invalid JSON body"})
            return None

    def _send_json(
        self,
        status: HTTPStatus,
        payload: dict[str, object],
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def _send_file(self, file_path: Path) -> None:
        if not file_path.exists():
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Missing asset"})
            return

        body = file_path.read_bytes()
        guessed_content_type, _ = mimetypes.guess_type(str(file_path))
        content_type = guessed_content_type or "application/octet-stream"
        if content_type.startswith("text/"):
            content_type = f"{content_type}; charset=utf-8"

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _resolve_static_path(self, raw_path: str) -> Path | None:
        requested_path = "index.html" if raw_path == "/" else raw_path.lstrip("/")
        candidate = (STATIC_DIR / requested_path).resolve()

        try:
            candidate.relative_to(STATIC_DIR.resolve())
        except ValueError:
            return None

        if candidate.is_file():
            return candidate

        return None

    def _parse_workout_id(self, path: str) -> int | None:
        prefix = "/api/workouts/"
        if not path.startswith(prefix):
            return None

        raw_id = path.removeprefix(prefix).strip("/")
        if not raw_id or "/" in raw_id:
            return None

        try:
            return int(raw_id)
        except ValueError:
            return None

    def _build_session_cookie(self, user_id: int) -> str:
        parts = [
            f"{SESSION_COOKIE_NAME}={make_session_value(user_id)}",
            "HttpOnly",
            "Path=/",
            f"Max-Age={SESSION_MAX_AGE_SECONDS}",
            "SameSite=Lax",
        ]
        if COOKIE_SECURE:
            parts.append("Secure")
        return "; ".join(parts)

    def _resolve_current_user(
        self,
        allow_debug_fallback: bool = False,
    ) -> tuple[dict[str, Any] | None, dict[str, str]]:
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            cookies = SimpleCookie()
            cookies.load(cookie_header)
            raw_cookie = cookies.get(SESSION_COOKIE_NAME)
            if raw_cookie is not None:
                user_id = read_session_user_id(raw_cookie.value)
                if user_id is not None:
                    user = STORE.get_user_by_id(user_id)
                    if user is not None:
                        return user, {}

        if allow_debug_fallback and debug_user_enabled():
            user = STORE.ensure_debug_user(
                DEFAULT_DEBUG_USER_ALIAS,
                DEFAULT_DEBUG_USER_FIRST_NAME,
                DEFAULT_DEBUG_USER_LAST_NAME,
            )
            return user, {"Set-Cookie": self._build_session_cookie(int(user["id"]))}

        return None, {}


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), MiniAppHandler)
    print(f"Trainer Mini App server listening on http://{HOST}:{PORT}")
    print(f"Static assets: {STATIC_DIR}")
    print(f"SQLite database: {DB_PATH}")
    if BOT_TOKEN:
        print("Telegram initData verification: enabled")
    else:
        print("Telegram initData verification: disabled, set BOT_TOKEN to enable it")
    if DEV_MODE:
        print("Mini App dev mode: enabled")
    if debug_user_enabled():
        print("Browser debug user mode: enabled")
    server.serve_forever()


if __name__ == "__main__":
    main()
