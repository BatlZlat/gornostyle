#!/bin/bash

# Диагностика системы запросов на отзывы

echo "🔍 === ДИАГНОСТИКА СИСТЕМЫ ЗАПРОСОВ НА ОТЗЫВЫ ==="
echo ""

export PGPASSWORD='Nemezida2324%)'
DB_HOST="90.156.210.24"
DB_PORT="5432"
DB_USER="batl-zlat"
DB_NAME="skisimulator"

run_sql() {
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "$1"
}

echo "📅 1. ПРОВЕРКА ТРЕНИРОВОК ЗА СЕГОДНЯ"
echo "===================================="
run_sql "
SELECT 
    'Групповые тренировки' as type,
    COUNT(*) as count,
    COUNT(DISTINCT sp.client_id) as unique_clients
FROM training_sessions ts
JOIN session_participants sp ON ts.id = sp.session_id
WHERE ts.session_date = CURRENT_DATE
    AND sp.status = 'confirmed'

UNION ALL

SELECT 
    'Индивидуальные тренировки' as type,
    COUNT(*) as count,
    COUNT(DISTINCT client_id) as unique_clients
FROM individual_training_sessions
WHERE preferred_date = CURRENT_DATE;
"

echo ""
echo "📊 2. ПРОВЕРКА СТАТУСОВ ТРЕНИРОВОК"
echo "==================================="
run_sql "
SELECT 
    status,
    COUNT(*) as count
FROM training_sessions
WHERE session_date = CURRENT_DATE
GROUP BY status;
"

echo ""
echo "👥 3. КЛИЕНТЫ С TELEGRAM ID"
echo "==========================="
run_sql "
SELECT 
    COUNT(*) as total_clients,
    COUNT(telegram_id) as with_telegram,
    COUNT(*) - COUNT(telegram_id) as without_telegram
FROM clients;
"

echo ""
echo "📱 4. ПРОВЕРКА КЛИЕНТОВ, КОТОРЫЕ ТРЕНИРОВАЛИСЬ СЕГОДНЯ"
echo "======================================================="
run_sql "
WITH todays_clients AS (
    -- Из групповых тренировок
    SELECT DISTINCT
        c.id,
        c.full_name,
        c.telegram_id,
        c.review_2gis,
        c.review_yandex
    FROM training_sessions ts
    JOIN session_participants sp ON ts.id = sp.session_id
    JOIN clients c ON sp.client_id = c.id
    WHERE ts.session_date = CURRENT_DATE
        AND sp.status = 'confirmed'
    
    UNION
    
    -- Из индивидуальных тренировок
    SELECT DISTINCT
        c.id,
        c.full_name,
        c.telegram_id,
        c.review_2gis,
        c.review_yandex
    FROM individual_training_sessions its
    JOIN clients c ON its.client_id = c.id
    WHERE its.preferred_date = CURRENT_DATE
)
SELECT 
    id,
    full_name,
    CASE 
        WHEN telegram_id IS NULL THEN 'НЕТ TELEGRAM'
        ELSE telegram_id 
    END as telegram_id,
    review_2gis,
    review_yandex
FROM todays_clients
ORDER BY full_name;
"

echo ""
echo "🔍 5. ПРОВЕРКА ЗАПРОСА ИЗ review-notification-service.js"
echo "=========================================================="
run_sql "
WITH todays_trainings AS (
    -- Групповые тренировки
    SELECT 
        sp.client_id,
        sp.child_id,
        sp.is_child,
        c.telegram_id,
        c.full_name as client_name,
        ch.full_name as child_name,
        'group' as training_type,
        ts.status as training_status
    FROM training_sessions ts
    JOIN session_participants sp ON ts.id = sp.session_id
    JOIN clients c ON sp.client_id = c.id
    LEFT JOIN children ch ON sp.child_id = ch.id
    WHERE ts.session_date = CURRENT_DATE
        AND ts.status = 'scheduled'
        AND sp.status = 'confirmed'
        AND c.telegram_id IS NOT NULL
    
    UNION ALL
    
    -- Индивидуальные тренировки
    SELECT 
        its.client_id,
        its.child_id,
        CASE WHEN its.child_id IS NOT NULL THEN true ELSE false END as is_child,
        c.telegram_id,
        c.full_name as client_name,
        ch.full_name as child_name,
        'individual' as training_type,
        'N/A' as training_status
    FROM individual_training_sessions its
    JOIN clients c ON its.client_id = c.id
    LEFT JOIN children ch ON its.child_id = ch.id
    WHERE its.preferred_date = CURRENT_DATE
        AND c.telegram_id IS NOT NULL
)
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT client_id) as unique_clients
FROM todays_trainings;
"

echo ""
echo "Детали:"
run_sql "
WITH todays_trainings AS (
    -- Групповые тренировки
    SELECT 
        sp.client_id,
        sp.child_id,
        sp.is_child,
        c.telegram_id,
        c.full_name as client_name,
        ch.full_name as child_name,
        'group' as training_type,
        ts.status as training_status
    FROM training_sessions ts
    JOIN session_participants sp ON ts.id = sp.session_id
    JOIN clients c ON sp.client_id = c.id
    LEFT JOIN children ch ON sp.child_id = ch.id
    WHERE ts.session_date = CURRENT_DATE
        AND ts.status = 'scheduled'
        AND sp.status = 'confirmed'
        AND c.telegram_id IS NOT NULL
    
    UNION ALL
    
    -- Индивидуальные тренировки
    SELECT 
        its.client_id,
        its.child_id,
        CASE WHEN its.child_id IS NOT NULL THEN true ELSE false END as is_child,
        c.telegram_id,
        c.full_name as client_name,
        ch.full_name as child_name,
        'individual' as training_type,
        'N/A' as training_status
    FROM individual_training_sessions its
    JOIN clients c ON its.client_id = c.id
    LEFT JOIN children ch ON its.child_id = ch.id
    WHERE its.preferred_date = CURRENT_DATE
        AND c.telegram_id IS NOT NULL
)
SELECT * FROM todays_trainings
ORDER BY client_id, child_id
LIMIT 10;
"

echo ""
echo "📝 6. ПРОВЕРКА ЛОГОВ ОТПРАВКИ ОТЗЫВОВ"
echo "======================================"
run_sql "
SELECT 
    COUNT(*) as total_logs,
    COUNT(DISTINCT client_id) as unique_clients,
    MAX(sent_at) as last_sent
FROM review_notification_logs
WHERE sent_at::date = CURRENT_DATE;
"

echo ""
echo "🕐 7. ТЕКУЩЕЕ ВРЕМЯ СЕРВЕРА"
echo "==========================="
run_sql "
SELECT 
    CURRENT_TIMESTAMP as server_time,
    CURRENT_DATE as server_date,
    TO_CHAR(CURRENT_TIMESTAMP, 'HH24:MI:SS') as time_only;
"

echo ""
echo "⏰ 8. ПРОВЕРКА - КОГДА ДОЛЖНА ЗАПУСТИТЬСЯ ЗАДАЧА"
echo "================================================"
echo "Задача запускается в 21:00 по времени Екатеринбурга (Asia/Yekaterinburg)"
echo "Проверьте, что текущее время сервера соответствует часовому поясу"

echo ""
echo "🔧 9. РЕКОМЕНДАЦИИ"
echo "=================="
echo ""
echo "Проблема 1: Статус тренировки = 'scheduled'"
echo "   В коде проверяется ts.status = 'scheduled', но это означает,"
echo "   что тренировка еще НЕ ЗАВЕРШЕНА."
echo ""
echo "   РЕШЕНИЕ: Убрать проверку статуса или изменить на проверку времени:"
echo "   WHERE ts.session_date = CURRENT_DATE"
echo "   AND ts.end_time < CURRENT_TIME  -- Тренировка уже закончилась"
echo ""
echo "Проблема 2: Тренировки могут не иметь telegram_id"
echo "   РЕШЕНИЕ: Проверено в запросе - используется AND c.telegram_id IS NOT NULL"
echo ""
echo "Проблема 3: Планировщик может не запуститься в 21:00"
echo "   РЕШЕНИЕ: Проверить логи приложения и timezone сервера"
echo ""
echo "🧪 10. РУЧНОЙ ТЕСТ"
echo "=================="
echo "Для ручного запуска скрипта отправки отзывов используйте:"
echo "node src/scripts/send-review-requests.js"
echo ""
echo "Или для конкретной даты:"
echo "node src/scripts/send-review-requests.js 2025-10-19"

echo ""
echo "✅ ДИАГНОСТИКА ЗАВЕРШЕНА"
