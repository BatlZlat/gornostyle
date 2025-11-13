#!/bin/bash
set -euo pipefail

BACKUP_DIR="/root/gornostyle-backups"
REMOTE="yadisk:gornostyle-backups"
LOG_FILE="${BACKUP_DIR}/backup.log"

latest=$(ls -1t ${BACKUP_DIR}/skisimulator_*.sql.gz ${BACKUP_DIR}/skisimulator_*.dump 2>/dev/null | head -n 1 || true)
if [ -z "$latest" ]; then
    echo "[$(date)] Нет файлов для отправки" >> "$LOG_FILE"
    exit 0
fi

echo "[$(date)] Загрузка ${latest} на Яндекс.Диск..." >> "$LOG_FILE"
rclone copy "$latest" "$REMOTE" >> "$LOG_FILE" 2>&1

echo "[$(date)] Очистка файлов на Диске старше 10 дней..." >> "$LOG_FILE"
rclone delete "$REMOTE" --min-age 10d >> "$LOG_FILE" 2>&1

echo "[$(date)] Готово" >> "$LOG_FILE"

