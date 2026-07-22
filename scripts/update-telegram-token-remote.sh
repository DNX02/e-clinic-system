#!/usr/bin/env bash
set -euo pipefail

token_file=/tmp/eclinic-telegram-token
script_file=/tmp/eclinic-update-telegram-token.sh
test_log=/tmp/eclinic-telegram-notification-test.log
config=/etc/netdata/health_alarm_notify.conf

cleanup() {
  if command -v shred >/dev/null 2>&1; then
    shred -u -- "$token_file" "$test_log" 2>/dev/null || true
  else
    rm -f -- "$token_file" "$test_log"
  fi
  rm -f -- "$script_file"
}
trap cleanup EXIT

[[ -f "$config" ]] || { echo "Netdata notification config is missing" >&2; exit 1; }

umask 077
IFS= read -r token
[[ "$token" =~ ^[0-9]{8,12}:[A-Za-z0-9_-]{30,}$ ]] || {
  echo "Invalid Telegram bot token format" >&2
  exit 1
}
printf '%s' "$token" >"$token_file"
unset token

python3 - "$config" "$token_file" <<'PY'
from pathlib import Path
import re
import sys

config_path = Path(sys.argv[1])
token_path = Path(sys.argv[2])
token = token_path.read_text(encoding="utf-8-sig").strip()

if not re.fullmatch(r"\d{8,12}:[A-Za-z0-9_-]{30,}", token):
    raise SystemExit("Invalid Telegram bot token format")

content = config_path.read_text(encoding="utf-8")
updated, count = re.subn(
    r"(?m)^(\s*TELEGRAM_BOT_TOKEN=).*$",
    lambda match: f'{match.group(1)}"{token}"',
    content,
)
if count != 1:
    raise SystemExit(f"Expected one TELEGRAM_BOT_TOKEN setting, found {count}")

config_path.write_text(updated, encoding="utf-8")
PY

systemctl restart netdata
systemctl is-active --quiet netdata

sudo -u netdata /usr/libexec/netdata/plugins.d/alarm-notify.sh test >"$test_log" 2>&1
sent_count=$(grep -c "sent telegram notification" "$test_log" || true)
if [[ "$sent_count" -lt 3 ]]; then
  echo "Telegram notification test failed" >&2
  exit 1
fi

echo "Telegram token updated; three test notifications were sent."
