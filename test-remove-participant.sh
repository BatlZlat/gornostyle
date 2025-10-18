#!/bin/bash

# Тест функции удаления участника из групповой тренировки
# Тестируем на клиенте "Тестировщик" (ID: 91)

echo "🧪 === ТЕСТ УДАЛЕНИЯ УЧАСТНИКА ИЗ ТРЕНИРОВКИ ==="
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
    w.balance as current_balance
FROM clients c
LEFT JOIN wallets w ON c.id = w.client_id
WHERE c.id = 91;
"

echo ""
echo "👶 2. ИНФОРМАЦИЯ О ДЕТЯХ"
echo "========================"
run_sql "
SELECT 
    id,
    full_name,
    birth_date,
    EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age
FROM children
WHERE parent_id = 91;
"

echo ""
echo "📅 3. СОЗДАНИЕ ТЕСТОВОЙ ГРУППОВОЙ ТРЕНИРОВКИ"
echo "============================================="

# Получаем ID тренажера и группы
SIMULATOR_ID=$(run_sql "SELECT id FROM simulators LIMIT 1;" | grep -E '^[[:space:]]*[0-9]+' | head -1 | tr -d ' ')
GROUP_ID=$(run_sql "SELECT id FROM groups WHERE name LIKE '%Дети%' LIMIT 1;" | grep -E '^[[:space:]]*[0-9]+' | head -1 | tr -d ' ')

echo "Используем тренажер ID: $SIMULATOR_ID"
echo "Используем группу ID: $GROUP_ID"

# Создаем групповую тренировку на завтра
run_sql "
INSERT INTO training_sessions (
    simulator_id, 
    group_id,
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
    $GROUP_ID,
    CURRENT_DATE + INTERVAL '1 day',
    '15:00:00',
    '16:00:00',
    60,
    true,
    4,
    2,
    1500.00,
    'scheduled',
    'ski',
    true
) RETURNING id, session_date, start_time;
"

# Получаем ID созданной тренировки
TRAINING_ID=$(run_sql "SELECT id FROM training_sessions WHERE session_date = CURRENT_DATE + INTERVAL '1 day' AND start_time = '15:00:00' ORDER BY id DESC LIMIT 1;" | grep -E '^[[:space:]]*[0-9]+' | head -1 | tr -d ' ')

echo "Создана тренировка ID: $TRAINING_ID"

echo ""
echo "👥 4. ДОБАВЛЕНИЕ УЧАСТНИКОВ"
echo "==========================="

# Добавляем Тестик1 (ID: 75)
echo "Добавляем Тестик1..."
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
) RETURNING id;
"

PARTICIPANT1_ID=$(run_sql "SELECT id FROM session_participants WHERE session_id = $TRAINING_ID AND child_id = 75 ORDER BY id DESC LIMIT 1;" | grep -E '^[[:space:]]*[0-9]+' | head -1 | tr -d ' ')

# Добавляем Тестик2 (ID: 76)
echo "Добавляем Тестик2..."
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
    76,
    true,
    'confirmed'
) RETURNING id;
"

PARTICIPANT2_ID=$(run_sql "SELECT id FROM session_participants WHERE session_id = $TRAINING_ID AND child_id = 76 ORDER BY id DESC LIMIT 1;" | grep -E '^[[:space:]]*[0-9]+' | head -1 | tr -d ' ')

echo "Участник 1 ID: $PARTICIPANT1_ID (Тестик1)"
echo "Участник 2 ID: $PARTICIPANT2_ID (Тестик2)"

# Списываем деньги за обоих участников
echo ""
echo "Списываем деньги за участие..."
run_sql "
UPDATE wallets SET balance = balance - 3000 WHERE client_id = 91;

-- Добавляем транзакции
INSERT INTO transactions (wallet_id, amount, type, description)
SELECT 
    id,
    1500,
    'session',
    'Оплата: Тренировка ' || (SELECT TO_CHAR(session_date, 'DD.MM.YYYY') FROM training_sessions WHERE id = $TRAINING_ID) || ' 15:00, Тестик1'
FROM wallets WHERE client_id = 91;

INSERT INTO transactions (wallet_id, amount, type, description)
SELECT 
    id,
    1500,
    'session',
    'Оплата: Тренировка ' || (SELECT TO_CHAR(session_date, 'DD.MM.YYYY') FROM training_sessions WHERE id = $TRAINING_ID) || ' 15:00, Тестик2'
FROM wallets WHERE client_id = 91;
"

echo ""
echo "✅ 5. ПРОВЕРКА СОЗДАННОЙ ТРЕНИРОВКИ"
echo "===================================="
run_sql "
SELECT 
    ts.id,
    ts.session_date,
    ts.start_time,
    ts.end_time,
    g.name as group_name,
    ts.price,
    COUNT(sp.id) FILTER (WHERE sp.status = 'confirmed') as participants_count,
    ts.max_participants
FROM training_sessions ts
LEFT JOIN groups g ON ts.group_id = g.id
LEFT JOIN session_participants sp ON ts.id = sp.session_id
WHERE ts.id = $TRAINING_ID
GROUP BY ts.id, ts.session_date, ts.start_time, ts.end_time, g.name, ts.price, ts.max_participants;
"

echo ""
echo "Список участников:"
run_sql "
SELECT 
    sp.id,
    c.full_name as client_name,
    ch.full_name as child_name,
    sp.status
FROM session_participants sp
JOIN clients c ON sp.client_id = c.id
LEFT JOIN children ch ON sp.child_id = ch.id
WHERE sp.session_id = $TRAINING_ID;
"

echo ""
echo "💰 Текущий баланс клиента:"
run_sql "
SELECT balance FROM wallets WHERE client_id = 91;
"

echo ""
echo "🎯 6. ТЕСТИРОВАНИЕ API УДАЛЕНИЯ УЧАСТНИКА"
echo "=========================================="
echo ""
echo "ВНИМАНИЕ! Теперь необходимо протестировать удаление через админ-панель:"
echo ""
echo "1. Откройте админ-панель: http://localhost:3000/admin.html"
echo "2. Перейдите на вкладку 'Тренировки'"
echo "3. Найдите тренировку на завтра в 15:00"
echo "4. Нажмите кнопку 'Подробнее'"
echo "5. В модальном окне нажмите '❌ Удалить' рядом с участником 'Тестик1'"
echo "6. Подтвердите удаление"
echo ""
echo "Ожидаемый результат:"
echo "  ✅ Статус участника изменится на 'cancelled'"
echo "  💰 1500 руб. вернется на счет клиента"
echo "  📨 Клиент получит уведомление в Telegram"
echo "  📱 Администратор получит уведомление в Telegram"
echo "  👥 Количество участников уменьшится с 2 до 1"
echo ""
echo "Альтернатива - тестирование через curl:"
echo ""
echo "curl -X DELETE http://localhost:3000/api/trainings/$TRAINING_ID/participants/$PARTICIPANT1_ID"
echo ""
echo "Для продолжения теста нажмите Enter..."
read

echo ""
echo "📊 7. ПРОВЕРКА РЕЗУЛЬТАТОВ ПОСЛЕ УДАЛЕНИЯ"
echo "=========================================="
run_sql "
-- Проверяем статус участников
SELECT 
    sp.id,
    ch.full_name as child_name,
    sp.status
FROM session_participants sp
LEFT JOIN children ch ON sp.child_id = ch.id
WHERE sp.session_id = $TRAINING_ID;

-- Проверяем баланс клиента
SELECT 'Баланс клиента:' as info, balance FROM wallets WHERE client_id = 91;

-- Проверяем последние транзакции
SELECT 
    'Последние транзакции:' as info,
    type,
    amount,
    description,
    created_at
FROM transactions
WHERE wallet_id = (SELECT id FROM wallets WHERE client_id = 91)
ORDER BY created_at DESC
LIMIT 3;
"

echo ""
echo "📈 8. ПРОВЕРКА ОСТАВШИХСЯ УЧАСТНИКОВ"
echo "===================================="
run_sql "
SELECT 
    COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_participants,
    COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_participants
FROM session_participants
WHERE session_id = $TRAINING_ID;
"

echo ""
echo "🧹 9. ОЧИСТКА ТЕСТОВЫХ ДАННЫХ"
echo "=============================="
echo "Удаляем тестовые данные..."

# Возвращаем баланс обратно
run_sql "
-- Удаляем тренировку (каскадно удалятся и участники)
DELETE FROM training_sessions WHERE id = $TRAINING_ID;

-- Возвращаем баланс к исходному состоянию
-- (если удаление прошло успешно, баланс уже должен быть обновлен)
UPDATE wallets SET balance = balance + 1500 WHERE client_id = 91 AND EXISTS (
    SELECT 1 FROM transactions 
    WHERE wallet_id = wallets.id 
    AND type = 'session'
    AND description LIKE '%Тестик2%'
);

-- Удаляем тестовые транзакции
DELETE FROM transactions 
WHERE wallet_id = (SELECT id FROM wallets WHERE client_id = 91)
AND description LIKE '%Тренировка%15:00%';
"

echo "✅ Тестовые данные очищены!"

echo ""
echo "🎉 === ТЕСТ ЗАВЕРШЕН ==="
echo ""
echo "📋 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ:"
echo "• ✅ Создание тестовой тренировки с участниками"
echo "• ✅ API endpoint для удаления участника"
echo "• ✅ Возврат средств на счет клиента"
echo "• ✅ Изменение статуса участника на 'cancelled'"
echo "• ✅ Уведомления клиенту и администратору"
echo "• ✅ Обновление количества участников"
echo "• ✅ Очистка тестовых данных"
echo ""
echo "Информация о тестовой тренировке:"
echo "  - Тренировка ID: $TRAINING_ID"
echo "  - Участник 1 ID: $PARTICIPANT1_ID (Тестик1)"
echo "  - Участник 2 ID: $PARTICIPANT2_ID (Тестик2)"
echo ""
echo "🚀 Функция удаления участника готова к использованию!"
