#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MINIAPP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

TARGET_HOST="${TRAINER_VPS_HOST:-root@89.124.83.32}"
REMOTE_BASE="${TRAINER_REMOTE_BASE:-/opt/trainer-miniapp}"
BOT_SERVICE="${TRAINER_BOT_SERVICE:-trainer-miniapp-bot.service}"


log() {
  printf '[deploy] %s\n' "$*"
}


usage() {
  cat <<EOF
Usage:
  $(basename "$0") web
  $(basename "$0") bot
  $(basename "$0") all

Optional environment variables:
  TRAINER_VPS_HOST      SSH target, default: $TARGET_HOST
  TRAINER_REMOTE_BASE   Remote base dir, default: $REMOTE_BASE
  TRAINER_BOT_SERVICE   systemd service name, default: $BOT_SERVICE
EOF
}


require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[deploy] error: command not found: %s\n' "$1" >&2
    exit 1
  fi
}


remote() {
  ssh "$TARGET_HOST" "$@"
}


remote_has_rsync() {
  remote 'command -v rsync >/dev/null 2>&1'
}


sync_dir() {
  local src="$1"
  local dest="$2"

  if command -v rsync >/dev/null 2>&1 && remote_has_rsync; then
    log "Syncing $(basename "$src") with rsync"
    rsync -az --delete "${src}/" "${TARGET_HOST}:${dest}/"
    return
  fi

  log "rsync unavailable, using tar+ssh fallback"

  local archive
  archive="$(mktemp "${TMPDIR:-/tmp}/trainer-miniapp.XXXXXX.tar")"
  tar -C "$src" -cf "$archive" .
  scp "$archive" "${TARGET_HOST}:/tmp/trainer-miniapp-sync.tar" >/dev/null
  rm -f "$archive"

  remote "mkdir -p '$dest' && find '$dest' -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -C '$dest' -xf /tmp/trainer-miniapp-sync.tar && rm -f /tmp/trainer-miniapp-sync.tar"
}


deploy_web() {
  log "Deploying web files to $TARGET_HOST:$REMOTE_BASE/www"
  remote "mkdir -p '$REMOTE_BASE/www'"
  sync_dir "$MINIAPP_DIR/web" "$REMOTE_BASE/www"
  log "Web deploy finished"
}


deploy_bot() {
  log "Deploying bot files to $TARGET_HOST"
  remote "mkdir -p '$REMOTE_BASE/bot'"
  scp "$MINIAPP_DIR/bot.py" "${TARGET_HOST}:${REMOTE_BASE}/bot/bot.py" >/dev/null
  scp "$SCRIPT_DIR/trainer-miniapp-bot.service" "${TARGET_HOST}:/etc/systemd/system/${BOT_SERVICE}" >/dev/null

  remote "chmod 644 '$REMOTE_BASE/bot/bot.py' '/etc/systemd/system/$BOT_SERVICE'"
  remote "test -f /etc/trainer-miniapp/bot.env"
  remote "systemctl daemon-reload && systemctl enable --now '$BOT_SERVICE' && systemctl restart '$BOT_SERVICE'"

  log "Bot deploy finished"
}


main() {
  local target="${1:-web}"

  require_cmd ssh
  require_cmd scp
  require_cmd tar

  case "$target" in
    web)
      deploy_web
      ;;
    bot)
      deploy_bot
      ;;
    all)
      deploy_web
      deploy_bot
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
}


main "$@"
