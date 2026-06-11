# Coach MCP

Read-only MCP server over the Trainer mini-app data, plus tools to **debug the
next-workout recommendations**. It reads the same SQLite database the backend
uses (`backend`) and reuses `recommender.py`, so what you see here is
exactly what the app's backend generates.

Use it to chat with Claude as a "coach" about your training, and to inspect the
recommendation pipeline (the exact prompt, the raw model output before
validation, token usage and cost).

## Tools

| Tool | What it does |
|------|--------------|
| `coach_list_workouts(limit=20)` | Workout history (newest first) + the compact serialization the model sees |
| `coach_get_workout(workout_id)` | One workout, full payload |
| `coach_list_body_weights()` | Body-weight history |
| `coach_get_catalog()` | The exercise catalog (only these exercises exist) |
| `coach_get_stored_recommendation()` | The recommendation currently cached for the app (status/based_on/payload/tokens/stale) |
| `coach_preview_prompt(limit=20)` | The exact system+user prompt and JSON schema — **no API call** (free) |
| `coach_debug_recommendation(limit=20)` | Calls the model and returns the **raw output (pre-validation)** + validated result + prompt + tokens/cost. Does not write to the DB |
| `coach_generate_recommendation(limit=20, store=false)` | Generate a validated recommendation; `store=true` overwrites the app's cached recommendation |

All tools accept an optional `user_id` (defaults to the configured user).

## Environment

| Var | Default | Notes |
|-----|---------|-------|
| `ANTHROPIC_API_KEY` | — | Required for `coach_debug_recommendation` / `coach_generate_recommendation` |
| `COACH_MCP_BACKEND_DIR` | `../backend` | Dir with `backend_store.py` + `recommender.py`. On the VPS: `/opt/trainer-miniapp/app` |
| `MINIAPP_DB_PATH` | `<backend_dir>/data/trainer.db` | SQLite path. On the VPS: `/opt/trainer-miniapp/data/trainer.db` |
| `COACH_MCP_STATIC_DIR` | `MINIAPP_STATIC_DIR` or `<backend_dir>/web` | Holds `data/exercises.json`. On the VPS: `/opt/trainer-miniapp/www` |
| `COACH_MCP_USER_ID` | `MINIAPP_TELEGRAM_RECOVERY_USER_ID` or `3` | Which user to operate on |
| `ANTHROPIC_MODEL` | from `recommender` (`claude-opus-4-8`) | Model for generation |
| `COACH_MCP_HOST` / `COACH_MCP_PORT` | `127.0.0.1` / `8001` | streamable-http bind (8001 to avoid investor-mcp's 8000) |
| `COACH_MCP_PATH` | `/mcp` | HTTP path; use a secret path in production |
| `COACH_MCP_AUTH_TOKEN` | — | If set, require `Authorization: Bearer <token>` |
| `COACH_MCP_ALLOWED_HOSTS` | — | Comma list → enables strict DNS-rebinding protection |

## Run locally (stdio, e.g. Claude Desktop)

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r coach_mcp/requirements.txt
ANTHROPIC_API_KEY=sk-ant-... python coach_mcp/server.py
```

## Deploy on the VPS (streamable-http behind Cloudflare tunnel)

Same shape as `investor-mcp`. The backend already lives at
`/opt/trainer-miniapp/app`, so point the importer there and reuse the existing
`backend.env` secrets.

```bash
# one-time
python3 -m venv /opt/coach-mcp/venv
/opt/coach-mcp/venv/bin/pip install -r requirements.txt
# env (own EnvironmentFile, or reuse the backend's):
#   COACH_MCP_BACKEND_DIR=/opt/trainer-miniapp/app
#   MINIAPP_DB_PATH=/opt/trainer-miniapp/data/trainer.db
#   COACH_MCP_STATIC_DIR=/opt/trainer-miniapp/www
#   ANTHROPIC_API_KEY=...           (already in /etc/trainer-miniapp/backend.env)
#   COACH_MCP_PATH=/<random-secret-path>/mcp
/opt/coach-mcp/venv/bin/python server.py --transport streamable-http --host 127.0.0.1 --port 8001
```

Then add a Cloudflare tunnel public hostname → `http://localhost:8001` and use
`https://<host>/<secret-path>/mcp` as the connector URL in Claude.

> **RAM note:** the VPS is ~1 GB and already runs the backend, two Caddy
> containers, cloudflared and the investor-mcp tunnel. A second `mcp`+uvicorn
> process adds ~50–80 MB — check `free -m` headroom (or run it on demand) before
> leaving it always-on.

> **Security:** these tools expose the user's full training history and can spend
> Anthropic tokens (`coach_debug_recommendation` / `coach_generate_recommendation`).
> Behind a public tunnel, use a secret `COACH_MCP_PATH` and/or `COACH_MCP_AUTH_TOKEN`.
