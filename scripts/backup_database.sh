#!/bin/bash

# Конфигурация
DB_NAME="skisimulator"
DB_USER="batl-zlat"
DB_HOST="127.0.0.1"
DB_PORT="5432"
DB_PASSWORD="Nemezida2324%)"
BACKUP_DIR="/root/gornostyle-backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE}.sql.gz"
RETENTION_DAYS=30

# Экспортируем пароль для pg_dump
export PGPASSWORD="$DB_PASSWORD"

# Создаем директорию для бэкапов, если её нет
mkdir -p "$BACKUP_DIR"

# Создаем бэкап
echo "[$(date)] Создание бэкапа базы данных ${DB_NAME}..."
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

# Проверяем успешность создания бэкапа
if [ $? -eq 0 ]; then
    echo "[$(date)] Бэкап успешно создан: ${BACKUP_FILE}"
    
    # Удаляем старые бэкапы
    echo "[$(date)] Удаление старых бэкапов..."
    find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete
    
    echo "[$(date)] Процесс бэкапа завершен успешно"
else
    echo "[$(date)] ОШИБКА: Не удалось создать бэкап"
    exit 1
fi

# Очищаем переменную с паролем
unset PGPASSWORD 