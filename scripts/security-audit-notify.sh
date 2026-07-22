#!/usr/bin/env bash
set -euo pipefail

notify_config=/etc/netdata/health_alarm_notify.conf

if [[ ! -r "$notify_config" ]]; then
  logger -t eclinic-security-audit "Telegram configuration is not readable"
  exit 1
fi

# This file is root-owned and contains the existing Netdata Telegram settings.
# shellcheck disable=SC1090
source "$notify_config"

if [[ "${SEND_TELEGRAM:-NO}" != "YES" || -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${DEFAULT_RECIPIENT_TELEGRAM:-}" ]]; then
  logger -t eclinic-security-audit "Telegram notification is not configured"
  exit 1
fi

message="E-Clinic: ежедневная проверка безопасности завершилась ошибкой на сервере $(hostname). Проверьте: sudo journalctl -u eclinic-security-audit.service -n 100 --no-pager"

printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" \
  | curl --config - --fail --silent --show-error \
      --data-urlencode "chat_id=$DEFAULT_RECIPIENT_TELEGRAM" \
      --data-urlencode "text=$message" \
      --output /dev/null

logger -t eclinic-security-audit "Failure notification sent to Telegram"
