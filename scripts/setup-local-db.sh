#!/bin/bash
# Скрипт для настройки локальной базы данных для разработки

set -e

echo "🔧 Настройка локальной базы данных для разработки..."

# Проверяем, запущен ли PostgreSQL
if ! pg_isready -q; then
    echo "❌ PostgreSQL не запущен. Запустите его командой:"
    echo "   sudo systemctl start postgresql"
    exit 1
fi

# Создаем пользователя (если не существует)
echo "👤 Создание пользователя batl-zlat..."
sudo -u postgres psql -c "CREATE USER \"batl-zlat\" WITH PASSWORD 'Nemezida2324%)';" 2>/dev/null || echo "   Пользователь уже существует"

# Создаем базу данных (если не существует)
echo "📦 Создание базы данных skisimulator..."
sudo -u postgres psql -c "CREATE DATABASE skisimulator OWNER \"batl-zlat\";" 2>/dev/null || echo "   База данных уже существует"

# Даем права пользователю
echo "🔐 Настройка прав доступа..."
sudo -u postgres psql -d skisimulator -c "GRANT ALL PRIVILEGES ON DATABASE skisimulator TO \"batl-zlat\";"
sudo -u postgres psql -d skisimulator -c "GRANT ALL ON SCHEMA public TO \"batl-zlat\";"

echo "✅ Локальная база данных настроена!"
echo ""
echo "📝 Теперь вы можете:"
echo "   1. Запустить миграции: npm run migrate"
echo "   2. Инициализировать базу данных: npm run init-db"
echo "   3. Или восстановить дамп с сервера"


