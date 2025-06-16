#!/bin/bash

# Проверка наличия аргумента с датой бэкапа
if [ -z "$1" ]; then
    echo "Использование: $0 YYYY-MM-DD [remote]"
    echo "Пример: $0 2024-03-20        # восстановление из локального бэкапа"
    echo "Пример: $0 2024-03-20 remote # восстановление из удаленного бэкапа"
    exit 1
fi

# Конфигурация
DB_NAME="gornostyle"
BACKUP_DATE="$1"
BACKUP_DIR="/home/dan/Project/gornostyle/backups/database"
REMOTE_HOST="root@90.156.210.24"
REMOTE_DIR="/root/gornostyle-backups"
TEMP_DIR="/tmp/gornostyle-restore"

# Создаем временную директорию
mkdir -p "$TEMP_DIR"

# Определяем источник бэкапа
if [ "$2" = "remote" ]; then
    echo "Восстановление из удаленного бэкапа..."
    BACKUP_FILE="${TEMP_DIR}/${DB_NAME}_${BACKUP_DATE}.sql.gz"
    
    # Ищем бэкап на удаленном сервере
    REMOTE_BACKUP=$(ssh "$REMOTE_HOST" "find $REMOTE_DIR -name '${DB_NAME}_${BACKUP_DATE}*.sql.gz' -type f | sort -r | head -n 1")
    
    if [ -z "$REMOTE_BACKUP" ]; then
        echo "Бэкап за указанную дату не найден на удаленном сервере"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    
    # Копируем бэкап с удаленного сервера
    echo "Копирование бэкапа с удаленного сервера..."
    scp "$REMOTE_HOST:$REMOTE_BACKUP" "$BACKUP_FILE"
    
    if [ $? -ne 0 ]; then
        echo "Ошибка при копировании бэкапа с удаленного сервера"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
else
    echo "Восстановление из локального бэкапа..."
    BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${BACKUP_DATE}*.sql.gz"
    
    # Проверяем наличие локального бэкапа
    if [ ! -f $BACKUP_FILE ]; then
        echo "Бэкап за указанную дату не найден локально: ${BACKUP_FILE}"
        exit 1
    fi
fi

# Останавливаем приложение (если необходимо)
echo "Остановка приложения..."
# TODO: Добавить команды остановки приложения

# Восстанавливаем базу данных
echo "Восстановление базы данных..."
gunzip -c $BACKUP_FILE | psql "$DB_NAME"

if [ $? -eq 0 ]; then
    echo "База данных успешно восстановлена"
else
    echo "Ошибка при восстановлении базы данных"
    if [ "$2" = "remote" ]; then
        rm -rf "$TEMP_DIR"
    fi
    exit 1
fi

# Запускаем приложение (если необходимо)
echo "Запуск приложения..."
# TODO: Добавить команды запуска приложения

# Очищаем временные файлы
if [ "$2" = "remote" ]; then
    rm -rf "$TEMP_DIR"
fi

echo "Процесс восстановления завершен" 