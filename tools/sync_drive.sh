#!/bin/zsh
# Синхронизация Dopa Room с Google Drive. Запуск: ./sync_drive.sh [--dry] [--force 52]
cd "$(dirname "$0")" && exec node drive_sync.mjs "$@"
