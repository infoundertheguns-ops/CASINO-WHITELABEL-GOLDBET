#!/bin/bash
# ═══ Scraper Watchdog — State-Based (no spam) ═══
# Monitors flashscore-scraper. Alerts ONLY on state transitions.
# Deploy: /root/scraper-watchdog.sh, invoked via /etc/cron.d/scraper-watchdog every 5min
#
# scraper-vps active services (2026-05-11): flashscore-scraper (sole enrichment source post-Sofa deprecation)

# Source /etc/environment so TELEGRAM vars are loaded under cron (cron doesn't load /etc/environment by default)
[ -f /etc/environment ] && set -a && . /etc/environment && set +a

# ═══ CONFIG ═══
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
STATE_FILE="/tmp/watchdog-state.json"
HEARTBEAT_FILE="/tmp/scraper-heartbeat"
MAX_HEARTBEAT_AGE=600  # 10 minutes
LOG_TAG="[WATCHDOG $(date '+%Y-%m-%d %H:%M:%S')]"

# Auto-detect hostname for VPS identification
HOSTNAME_SHORT=$(hostname -s 2>/dev/null || hostname)

# ═══ FUNCTIONS ═══

send_telegram() {
    [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ] && return
    local message="$1"
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d chat_id="${TELEGRAM_CHAT_ID}" \
        -d text="${message}" \
        -d parse_mode="HTML" > /dev/null 2>&1
}

# Read previous state for a service (returns "ok" or "down")
get_prev_state() {
    local service="$1"
    if [ -f "$STATE_FILE" ]; then
        # Simple JSON parsing with grep/sed
        grep -o "\"${service}\":\"[^\"]*\"" "$STATE_FILE" 2>/dev/null | sed 's/.*:"\(.*\)"/\1/'
    fi
}

# Save state file
save_state() {
    echo "$1" > "$STATE_FILE"
}

# Check a systemd service, return "ok" or "down"
check_service() {
    local service="$1"
    local status
    status=$(systemctl is-active "$service" 2>/dev/null)
    if [ "$status" = "active" ]; then
        echo "ok"
    else
        echo "down"
    fi
}

# Get system info
get_system_info() {
    local mem cpu
    mem=$(free -m | awk '/Mem:/ {printf "%d/%dMB (%.0f%%)", $3, $2, $3/$2*100}')
    cpu=$(cat /proc/loadavg | awk '{printf "%.2f %.2f %.2f", $1, $2, $3}')
    echo "CPU: ${cpu} | RAM: ${mem}"
}

# ═══ DETECT WHICH SERVICES TO MONITOR ═══
SERVICES=()

# Check which services exist on this VPS
for svc in flashscore-scraper; do
    if systemctl list-unit-files "${svc}.service" &>/dev/null; then
        if systemctl list-unit-files "${svc}.service" | grep -q "${svc}"; then
            SERVICES+=("$svc")
        fi
    fi
done

if [ ${#SERVICES[@]} -eq 0 ]; then
    echo "$LOG_TAG No services found to monitor"
    exit 0
fi

echo "$LOG_TAG Monitoring: ${SERVICES[*]}"

# ═══ BUILD CURRENT STATE ═══
declare -A CURRENT_STATE
ALERTS_TO_SEND=()
SERVICES_TO_RESTART=()

for svc in "${SERVICES[@]}"; do
    current=$(check_service "$svc")
    CURRENT_STATE[$svc]="$current"

    prev=$(get_prev_state "$svc")
    [ -z "$prev" ] && prev="ok"  # First run, assume OK

    if [ "$current" = "down" ] && [ "$prev" = "ok" ]; then
        # Transition OK → DOWN
        ALERTS_TO_SEND+=("down:$svc")
        SERVICES_TO_RESTART+=("$svc")
        echo "$LOG_TAG $svc: OK → DOWN"
    elif [ "$current" = "ok" ] && [ "$prev" = "down" ]; then
        # Transition DOWN → OK (recovered)
        ALERTS_TO_SEND+=("recovered:$svc")
        echo "$LOG_TAG $svc: DOWN → OK (recovered)"
    elif [ "$current" = "down" ] && [ "$prev" = "down" ]; then
        # Still down — try restart again silently
        SERVICES_TO_RESTART+=("$svc")
        echo "$LOG_TAG $svc: still down, retrying restart"
    else
        echo "$LOG_TAG $svc: OK"
    fi
done

# ═══ HEARTBEAT CHECK (flashscore-scraper) ═══
# FS scraper writes Date.now() to $HEARTBEAT_FILE after every successful live cycle.
# Stale heartbeat → live loop hung even though systemd reports active. Restart forces recovery.
HEARTBEAT_ALERT=""
if [[ " ${SERVICES[*]} " =~ " flashscore-scraper " ]] && [ "${CURRENT_STATE[flashscore-scraper]}" = "ok" ]; then
    if [ -f "$HEARTBEAT_FILE" ]; then
        LAST_BEAT=$(cat "$HEARTBEAT_FILE" 2>/dev/null)
        NOW_MS=$(($(date +%s) * 1000))
        AGE_SEC=$(( (NOW_MS - LAST_BEAT) / 1000 ))

        if [ "$AGE_SEC" -gt "$MAX_HEARTBEAT_AGE" ]; then
            prev_hb=$(get_prev_state "heartbeat")
            [ -z "$prev_hb" ] && prev_hb="ok"
            CURRENT_STATE[heartbeat]="stale"

            if [ "$prev_hb" = "ok" ]; then
                HEARTBEAT_ALERT="stale"
                SERVICES_TO_RESTART+=("flashscore-scraper")
                echo "$LOG_TAG heartbeat: STALE (${AGE_SEC}s) — restarting flashscore-scraper"
            else
                # Still stale — restart silently
                SERVICES_TO_RESTART+=("flashscore-scraper")
                echo "$LOG_TAG heartbeat: still stale (${AGE_SEC}s)"
            fi
        else
            CURRENT_STATE[heartbeat]="ok"
            prev_hb=$(get_prev_state "heartbeat")
            if [ "$prev_hb" = "stale" ]; then
                HEARTBEAT_ALERT="recovered"
                echo "$LOG_TAG heartbeat: recovered (${AGE_SEC}s)"
            fi
        fi
    else
        # No heartbeat file — skip check (scraper may not have started yet)
        CURRENT_STATE[heartbeat]="ok"
    fi
fi

# ═══ RESTART DOWNED SERVICES ═══
# Deduplicate
declare -A RESTART_SET
for svc in "${SERVICES_TO_RESTART[@]}"; do
    RESTART_SET[$svc]=1
done

for svc in "${!RESTART_SET[@]}"; do
    echo "$LOG_TAG Restarting $svc..."
    systemctl restart "$svc" 2>/dev/null
    sleep 2
done

# ═══ SEND ALERTS ═══
SYS_INFO=$(get_system_info)

for alert in "${ALERTS_TO_SEND[@]}"; do
    IFS=':' read -r type svc <<< "$alert"
    if [ "$type" = "down" ]; then
        # Check if restart worked
        new_status=$(systemctl is-active "$svc" 2>/dev/null)
        send_telegram "$(cat <<EOF
🔴 <b>${svc} DOWN</b> — ${HOSTNAME_SHORT}

🔄 Auto-restart attempted → ${new_status}
🖥 ${SYS_INFO}
🕐 $(date '+%H:%M %d/%m' --date='TZ="Europe/Rome"' 2>/dev/null || date '+%H:%M %d/%m')
EOF
)"
    elif [ "$type" = "recovered" ]; then
        send_telegram "$(cat <<EOF
✅ <b>${svc} RECOVERED</b> — ${HOSTNAME_SHORT}

🖥 ${SYS_INFO}
🕐 $(date '+%H:%M %d/%m' --date='TZ="Europe/Rome"' 2>/dev/null || date '+%H:%M %d/%m')
EOF
)"
    fi
done

# Heartbeat alerts
if [ "$HEARTBEAT_ALERT" = "stale" ]; then
    new_status=$(systemctl is-active "flashscore-scraper" 2>/dev/null)
    send_telegram "$(cat <<EOF
🟡 <b>HEARTBEAT STALE</b> — ${HOSTNAME_SHORT}

⏱ Last heartbeat: ${AGE_SEC}s ago (limit: ${MAX_HEARTBEAT_AGE}s)
🔄 Scraper restarted → ${new_status}
🖥 ${SYS_INFO}
EOF
)"
    rm -f "$HEARTBEAT_FILE"
elif [ "$HEARTBEAT_ALERT" = "recovered" ]; then
    send_telegram "$(cat <<EOF
✅ <b>HEARTBEAT RECOVERED</b> — ${HOSTNAME_SHORT}

⏱ Heartbeat: ${AGE_SEC}s ago
🖥 ${SYS_INFO}
EOF
)"
fi

# ═══ SAVE STATE ═══
STATE_JSON="{"
first=true
for key in "${!CURRENT_STATE[@]}"; do
    if [ "$first" = true ]; then
        first=false
    else
        STATE_JSON+=","
    fi
    STATE_JSON+="\"${key}\":\"${CURRENT_STATE[$key]}\""
done
STATE_JSON+="}"
save_state "$STATE_JSON"

echo "$LOG_TAG Done. Alerts sent: ${#ALERTS_TO_SEND[@]} service + ${HEARTBEAT_ALERT:+1 heartbeat}"
