#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
POLL_INTERVAL_SECONDS = float(os.getenv("MINIAPP_DEV_POLL_INTERVAL", "0.75"))


def iter_backend_files() -> list[Path]:
    return [
        path
        for path in sorted(BASE_DIR.rglob("*.py"))
        if path.is_file() and "__pycache__" not in path.parts
    ]


def snapshot_backend() -> dict[str, int]:
    snapshot: dict[str, int] = {}
    for path in iter_backend_files():
        try:
            snapshot[str(path)] = path.stat().st_mtime_ns
        except FileNotFoundError:
            continue
    return snapshot


def describe_changes(before: dict[str, int], after: dict[str, int]) -> list[str]:
    changed_paths = sorted(set(before) | set(after))
    return [Path(path).name for path in changed_paths if before.get(path) != after.get(path)]


def start_server_process() -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    env["MINIAPP_DEV_MODE"] = "1"
    command = [sys.executable, str(BASE_DIR / "server.py")]
    print("[dev] starting Mini App server")
    return subprocess.Popen(command, cwd=REPO_ROOT, env=env)


def stop_server_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return

    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> None:
    previous_snapshot = snapshot_backend()
    process = start_server_process()

    try:
        while True:
            time.sleep(POLL_INTERVAL_SECONDS)
            current_snapshot = snapshot_backend()

            if process.poll() is not None:
                print("[dev] server stopped, restarting")
                process = start_server_process()
                previous_snapshot = current_snapshot
                continue

            if current_snapshot != previous_snapshot:
                changed = ", ".join(describe_changes(previous_snapshot, current_snapshot))
                print(f"[dev] backend change detected: {changed}")
                stop_server_process(process)
                process = start_server_process()
                previous_snapshot = current_snapshot
    except KeyboardInterrupt:
        print("\n[dev] stopping Mini App server")
    finally:
        stop_server_process(process)


if __name__ == "__main__":
    main()
