#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlparse


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "web"
HOST = os.getenv("MINIAPP_HOST", "127.0.0.1")
PORT = int(os.getenv("MINIAPP_PORT", "8080"))
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
MAX_AUTH_AGE_SECONDS = int(os.getenv("MINIAPP_MAX_AUTH_AGE", "86400"))
DEV_MODE = os.getenv("MINIAPP_DEV_MODE", "").lower() in {"1", "true", "yes", "on"}
WATCHED_EXTENSIONS = {".py", ".html", ".css", ".js", ".json", ".md"}


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


class MiniAppHandler(BaseHTTPRequestHandler):
    server_version = "TrainerMiniApp/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
                },
            )
            return

        if path == "/api/dev/version":
            self._send_json(HTTPStatus.OK, build_dev_version())
            return

        static_path = self._resolve_static_path(path)
        if static_path is not None:
            self._send_file(static_path)
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/telegram/auth":
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "reason": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        payload_raw = self.rfile.read(content_length).decode("utf-8")

        try:
            payload = json.loads(payload_raw or "{}")
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "reason": "Invalid JSON body"})
            return

        init_data = str(payload.get("initData", ""))
        validation_result = validate_init_data(init_data, BOT_TOKEN)
        status = HTTPStatus.OK if validation_result.get("ok") else HTTPStatus.BAD_REQUEST
        self._send_json(status, validation_result)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[miniapp] {self.address_string()} - {format % args}")

    def _send_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
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


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), MiniAppHandler)
    print(f"Trainer Mini App server listening on http://{HOST}:{PORT}")
    print(f"Static assets: {STATIC_DIR}")
    if BOT_TOKEN:
        print("Telegram initData verification: enabled")
    else:
        print("Telegram initData verification: disabled, set BOT_TOKEN to enable it")
    if DEV_MODE:
        print("Mini App dev mode: enabled")
    server.serve_forever()


if __name__ == "__main__":
    main()
