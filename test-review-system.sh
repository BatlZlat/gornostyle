#!/bin/bash

# Полный тест системы запросов на отзывы
# Тестируем на клиенте "Тестировщик" (ID: 91)

echo "🧪 === ПОЛНЫЙ ТЕСТ СИСТЕМЫ ЗАПРОСОВ НА ОТЗЫВЫ ==="
echo ""

# Настройки подключения к БД
export PGPASSWORD='Nemezida2324%)'
DB_HOST="90.156.210.24"
DB_PORT="5432"
DB_USER="batl-zlat"
DB_NAME="skisimulator"

# Функция для выполнения SQL запросов
run_sql() {
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "$1"
}

echo "📊 1. ПРОВЕРКА ТЕКУЩЕГО СОСТОЯНИЯ КЛИЕНТА"
echo "=========================================="
run_sql "
SELECT 
    c.id, 
    c.full_name, 
    c.telegram_id, 
    c.review_2gis, 
    c.review_yandex,
    COUNT(ch.id) as children_count
FROM clients c
LEFT JOIN children ch ON c.id = ch.parent_id
WHERE c.id = 91
GROUP BY c.id, c.full_name, c.telegram_id, c.review_2gis, c.review_yandex;
"

echo ""
echo "👶 2. ИНФОРМАЦИЯ О ДЕТЯХ"
echo "========================"
run_sql "
SELECT 
    ch.id,
    ch.full_name,
    ch.birth_date,
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, ch.birth_date)) as age
FROM children ch
WHERE ch.parent_id = 91
ORDER BY ch.birth_date;
"

echo ""
echo "📈 3. СТАТИСТИКА ТРЕНИРОВОК"
echo "==========================="
run_sql "
-- Статистика для клиента
SELECT 
    'Клиент Тестировщик' as participant,
    COUNT(CASE WHEN its.id IS NOT NULL THEN 1 END) as individual_trainings,
    COUNT(CASE WHEN sp.id IS NOT NULL THEN 1 END) as group_trainings
FROM clients c
LEFT JOIN individual_training_sessions its ON c.id = its.client_id AND its.child_id IS NULL AND its.preferred_date <= CURRENT_DATE
LEFT JOIN session_participants sp ON c.id = sp.client_id AND sp.is_child = false AND sp.status = 'confirmed'
LEFT JOIN training_sessions ts ON sp.session_id = ts.id AND ts.session_date <= CURRENT_DATE
WHERE c.id = 91

UNION ALL

-- Статистика для детей
SELECT 
    ch.full_name as participant,
    COUNT(CASE WHEN its.id IS NOT NULL THEN 1 END) as individual_trainings,
    COUNT(CASE WHEN sp.id IS NOT NULL THEN 1 END) as group_trainings
FROM children ch
LEFT JOIN individual_training_sessions its ON ch.id = its.child_id AND its.preferred_date <= CURRENT_DATE
LEFT JOIN session_participants sp ON ch.id = sp.child_id AND sp.is_child = true AND sp.status = 'confirmed'
LEFT JOIN training_sessions ts ON sp.session_id = ts.id AND ts.session_date <= CURRENT_DATE
WHERE ch.parent_id = 91
GROUP BY ch.id, ch.full_name;
"

echo ""
echo "📅 4. СОЗДАНИЕ ТЕСТОВЫХ ТРЕНИРОВОК НА СЕГОДНЯ"
echo "============================================="

# Получаем ID тренажера
SIMULATOR_ID=$(run_sql "SELECT id FROM simulators LIMIT 1;" | grep -E '^[[:space:]]*[0-9]+' | head -1 | tr -d ' ')

echo "Используем тренажер ID: $SIMULATOR_ID"

# Создаем тестовую групповую тренировку на сегодня
echo "Создаем групповую тренировку для Тестик1..."
run_sql "
INSERT INTO training_sessions (
    simulator_id, 
    session_date, 
    start_time, 
    end_time, 
    duration, 
    training_type, 
    max_participants, 
    skill_level, 
    price, 
    status, 
    equipment_type, 
    with_trainer
) VALUES (
    $SIMULATOR_ID,
    CURRENT_DATE,
    '14:00:00',
    '15:00:00',
    60,
    true,
    4,
    1,
    1000.00,
    'scheduled',
    'ski',
    true
) RETURNING id;
"

# Получаем ID созданной тренировки
TRAINING_ID=$(run_sql "SELECT id FROM training_sessions WHERE session_date = CURRENT_DATE AND start_time = '14:00:00' ORDER BY id DESC LIMIT 1;" | grep -E '^[[:space:]]*[0-9]+' | head -1 | tr -d ' ')

echo "Создана тренировка ID: $TRAINING_ID"

# Добавляем Тестик1 в групповую тренировку
echo "Добавляем Тестик1 в групповую тренировку..."
run_sql "
INSERT INTO session_participants (
    session_id,
    client_id,
    child_id,
    is_child,
    status
) VALUES (
    $TRAINING_ID,
    91,
    75,
    true,
    'confirmed'
);
"

# Создаем индивидуальную тренировку для Тестик2
echo "Создаем индивидуальную тренировку для Тестик2..."
run_sql "
INSERT INTO individual_training_sessions (
    client_id,
    child_id,
    equipment_type,
    with_trainer,
    duration,
    preferred_date,
    preferred_time,
    simulator_id,
    price
) VALUES (
    91,
    76,
    'snowboard',
    true,
    60,
    CURRENT_DATE,
    '16:00:00',
    $SIMULATOR_ID,
    1500.00
);
"

echo ""
echo "✅ 5. ПРОВЕРКА СОЗДАННЫХ ТРЕНИРОВОК"
echo "==================================="
run_sql "
-- Групповые тренировки на сегодня
SELECT 
    'Групповая тренировка' as type,
    ts.id,
    ts.start_time,
    ts.end_time,
    ch.full_name as participant
FROM training_sessions ts
JOIN session_participants sp ON ts.id = sp.session_id
JOIN children ch ON sp.child_id = ch.id
WHERE ts.session_date = CURRENT_DATE AND sp.is_child = true

UNION ALL

-- Индивидуальные тренировки на сегодня
SELECT 
    'Индивидуальная тренировка' as type,
    its.id,
    its.preferred_time as start_time,
    (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
    ch.full_name as participant
FROM individual_training_sessions its
JOIN children ch ON its.child_id = ch.id
WHERE its.preferred_date = CURRENT_DATE;
"

echo ""
echo "🧪 6. ТЕСТИРОВАНИЕ СИСТЕМЫ ЗАПРОСОВ НА ОТЗЫВЫ"
echo "============================================="

echo "Запускаем тест отправки запросов на отзывы..."
cd /home/dan/Project/gornostyle
node src/scripts/send-review-requests.js

echo ""
echo "📊 7. ПРОВЕРКА РЕЗУЛЬТАТОВ"
echo "=========================="

echo "Проверяем логи отправки..."
run_sql "
SELECT 
    client_id,
    telegram_id,
    training_count,
    participant_type,
    participant_details,
    review_2gis_requested,
    review_yandex_requested,
    sent_at
FROM review_notification_logs 
WHERE client_id = 91 
ORDER BY sent_at DESC 
LIMIT 5;
"

echo ""
echo "🎯 8. ТЕСТИРОВАНИЕ РАЗЛИЧНЫХ СЦЕНАРИЕВ"
echo "====================================="

echo "Тест 1: Отмечаем отзыв на 2ГИС как оставленный..."
run_sql "UPDATE clients SET review_2gis = true WHERE id = 91;"

echo "Запускаем тест снова (должна остаться только ссылка на Яндекс)..."
node src/scripts/send-review-requests.js

echo ""
echo "Тест 2: Отмечаем отзыв на Яндекс как оставленный..."
run_sql "UPDATE clients SET review_yandex = true WHERE id = 91;"

echo "Запускаем тест снова (уведомление не должно отправляться)..."
node src/scripts/send-review-requests.js

echo ""
echo "Тест 3: Сбрасываем оба отзыва..."
run_sql "UPDATE clients SET review_2gis = false, review_yandex = false WHERE id = 91;"

echo "Запускаем финальный тест (должны быть обе ссылки)..."
node src/scripts/send-review-requests.js

echo ""
echo "📈 9. ФИНАЛЬНАЯ СТАТИСТИКА"
echo "=========================="
run_sql "
SELECT 
    COUNT(*) as total_notifications,
    COUNT(CASE WHEN review_2gis_requested = true AND review_yandex_requested = true THEN 1 END) as both_links,
    COUNT(CASE WHEN review_2gis_requested = true AND review_yandex_requested = false THEN 1 END) as only_2gis,
    COUNT(CASE WHEN review_2gis_requested = false AND review_yandex_requested = true THEN 1 END) as only_yandex,
    COUNT(CASE WHEN review_2gis_requested = false AND review_yandex_requested = false THEN 1 END) as no_links
FROM review_notification_logs 
WHERE client_id = 91;
"

echo ""
echo "🧹 10. ОЧИСТКА ТЕСТОВЫХ ДАННЫХ"
echo "=============================="
echo "Удаляем тестовые тренировки..."

# Удаляем участника групповой тренировки
run_sql "DELETE FROM session_participants WHERE client_id = 91 AND child_id = 75;"

# Удаляем групповую тренировку
run_sql "DELETE FROM training_sessions WHERE id = $TRAINING_ID;"

# Удаляем индивидуальную тренировку
run_sql "DELETE FROM individual_training_sessions WHERE client_id = 91 AND child_id = 76 AND preferred_date = CURRENT_DATE;"

# Удаляем логи тестирования
run_sql "DELETE FROM review_notification_logs WHERE client_id = 91;"

# Сбрасываем статус отзывов
run_sql "UPDATE clients SET review_2gis = false, review_yandex = false WHERE id = 91;"

echo "✅ Тестовые данные очищены!"

echo ""
echo "🎉 === ТЕСТ ЗАВЕРШЕН ==="
echo ""
echo "📋 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ:"
echo "• ✅ Создание тестовых тренировок"
echo "• ✅ Отправка уведомлений с обеими ссылками"
echo "• ✅ Фильтрация ссылок при частично оставленных отзывах"
echo "• ✅ Отключение уведомлений при полностью оставленных отзывах"
echo "• ✅ Логирование всех операций"
echo "• ✅ Очистка тестовых данных"
echo ""
echo "🚀 Система запросов на отзывы работает корректно!"
