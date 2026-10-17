#!/usr/bin/env bash
# Installs the city as macOS login services (launchd), so it starts on login
# and restarts itself if anything dies:
#   com.naoeumfa.api     the city API on 127.0.0.1:8787
#   com.naoeumfa.tunnel  the public tunnel (re-points Vercel when its hostname changes)
#   com.naoeumfa.backup  checked copy of the book to iCloud Drive every 5 minutes
#   com.naoeumfa.awake   keeps the Mac from sleeping while on power
#
#   bash scripts/city-install.sh            install / reinstall
#   bash scripts/city-install.sh uninstall  remove all four
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
LABELS=(com.naoeumfa.api com.naoeumfa.tunnel com.naoeumfa.backup com.naoeumfa.awake)

stop_all() {
  for label in "${LABELS[@]}"; do
    launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
    rm -f "$AGENTS/$label.plist"
  done
}

if [ "${1:-}" = "uninstall" ]; then
  stop_all
  echo "removed: ${LABELS[*]}"
  exit 0
fi

mkdir -p "$AGENTS"
stop_all

service() {
  local label=$1 program=$2 extra=$3
  cat >"$AGENTS/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>$program</array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>RunAtLoad</key><true/>
  $extra
  <key>StandardOutPath</key><string>/tmp/$label.log</string>
  <key>StandardErrorPath</key><string>/tmp/$label.log</string>
</dict>
</plist>
PLIST
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
}

KEEP='<key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>'
service com.naoeumfa.api "<string>/bin/bash</string><string>$REPO/scripts/city-api.sh</string>" "$KEEP"
service com.naoeumfa.tunnel "<string>/bin/bash</string><string>$REPO/scripts/city-tunnel.sh</string>" "$KEEP"
service com.naoeumfa.backup "<string>/bin/bash</string><string>$REPO/scripts/city-backup.sh</string>" '<key>StartInterval</key><integer>300</integer>'
service com.naoeumfa.awake "<string>/usr/bin/caffeinate</string><string>-s</string><string>-i</string>" "$KEEP"

echo "installed: ${LABELS[*]}"
echo "logs: /tmp/com.naoeumfa.*.log · tunnel: /tmp/naoeumfa-tunnel.log"
