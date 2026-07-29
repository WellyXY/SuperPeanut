#!/bin/zsh
set -u

LOG_FILE="/Users/welly/Library/Logs/SuperPeanut/watchdog.log"
COOLDOWN_FILE="/tmp/superpeanut-watchdog-tunnel-restart"
PUBLIC_HEALTH="https://sany-agent-temp.racoonn.me/health"
LOCAL_HEALTH="http://127.0.0.1:8790/health"
USER_DOMAIN="gui/$(/usr/bin/id -u)"

log_event() {
  /bin/printf '%s %s\n' "$(/bin/date '+%Y-%m-%d %H:%M:%S %Z')" "$1" >> "$LOG_FILE"
}

check_health() {
  /usr/bin/curl -fsS --max-time 6 "$1" >/dev/null 2>&1
}

if ! check_health "$LOCAL_HEALTH"; then
  log_event "local broker unhealthy; restarting com.superpeanut.agent"
  /bin/launchctl kickstart -k "$USER_DOMAIN/com.superpeanut.agent" >/dev/null 2>&1
  /bin/sleep 3
  if ! check_health "$LOCAL_HEALTH"; then
    log_event "local broker still unhealthy after restart"
    exit 1
  fi
  log_event "local broker recovered"
fi

if check_health "$PUBLIC_HEALTH"; then
  exit 0
fi

/bin/sleep 5
if check_health "$PUBLIC_HEALTH"; then
  log_event "public endpoint recovered on second check"
  exit 0
fi

now_epoch=$(/bin/date +%s)
last_restart=0
if [[ -f "$COOLDOWN_FILE" ]]; then
  last_restart=$(/bin/cat "$COOLDOWN_FILE" 2>/dev/null || /bin/echo 0)
fi

if (( now_epoch - last_restart < 600 )); then
  log_event "public endpoint unhealthy; tunnel restart skipped during cooldown"
  exit 1
fi

/bin/printf '%s\n' "$now_epoch" > "$COOLDOWN_FILE"
log_event "public endpoint unhealthy twice; restarting com.welly.tutor-tunnel"
/bin/launchctl kickstart -k "$USER_DOMAIN/com.welly.tutor-tunnel" >/dev/null 2>&1
/bin/sleep 5

if check_health "$PUBLIC_HEALTH"; then
  log_event "public endpoint recovered after tunnel restart"
  exit 0
fi

log_event "public endpoint still unhealthy after tunnel restart"
exit 1
