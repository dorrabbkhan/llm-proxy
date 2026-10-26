#!/usr/bin/env bash
# Usage: notify.sh "<message>"
echo ">>> $1"
command -v notify-send >/dev/null && notify-send "llm-proxy conductor" "$1" || true
