require('dotenv').config();
const { Pool } = require('pg');
const { checkAndUseSubscription, returnSubscriptionSession, checkTrainingSubscriptionUsage } = require('./src/services/subscription-helper');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 5432,
});

async function testSubscriptionBooking() {
    console.log('\n=== ТЕСТИРОВАНИЕ СИСТЕМЫ АБОНЕМЕНТОВ ===\n');

    try {
        // 1. Найти клиента с активным абонементом
        console.log('1. Поиск клиента с активным абонементом...');
        const clientResult = await pool.query(`
            SELECT 
                c.id as client_id,
                c.full_name,
                ns.id as subscription_id,
                ns.remaining_sessions,
                st.name as subscription_name,
                st.sessions_count
            FROM clients c
            JOIN natural_slope_subscriptions ns ON c.id = ns.client_id
            JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
            WHERE ns.status = 'active'
                AND ns.remaining_sessions > 0
                AND ns.expires_at >= CURRENT_DATE
            LIMIT 1
        `);

        if (clientResult.rows.length === 0) {
            console.log('❌ Нет клиентов с активными абонементами');
            console.log('\n💡 Создайте абонемент через админ-панель и купите его через бота');
            return;
        }

        const client = clientResult.rows[0];
        console.log(`✅ Найден клиент: ${client.full_name} (ID: ${client.client_id})`);
        console.log(`   Абонемент: ${client.subscription_name}`);
        console.log(`   Осталось занятий: ${client.remaining_sessions}/${client.sessions_count}`);

        // 2. Найти групповую зимнюю тренировку
        console.log('\n2. Поиск доступной групповой зимней тренировки...');
        const trainingResult = await pool.query(`
            SELECT 
                ts.id,
                ts.session_date,
                ts.start_time,
                g.name as group_name,
                ts.price,
                ts.max_participants,
                COUNT(sp.id) FILTER (WHERE sp.status = 'confirmed') as current_participants
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id
            WHERE ts.training_type = true
                AND ts.slope_type = 'natural_slope'
                AND ts.winter_training_type = 'group'
                AND ts.status = 'scheduled'
                AND ts.session_date >= CURRENT_DATE
            GROUP BY ts.id, ts.session_date, ts.start_time, g.name, ts.price, ts.max_participants
            HAVING COUNT(sp.id) FILTER (WHERE sp.status = 'confirmed') < ts.max_participants
            ORDER BY ts.session_date, ts.start_time
            LIMIT 1
        `);

        if (trainingResult.rows.length === 0) {
            console.log('❌ Нет доступных групповых зимних тренировок');
            console.log('\n💡 Создайте групповую тренировку в админ-панели');
            return;
        }

        const training = trainingResult.rows[0];
        console.log(`✅ Найдена тренировка: ${training.group_name}`);
        console.log(`   Дата: ${training.session_date.toISOString().split('T')[0]}`);
        console.log(`   Время: ${training.start_time}`);
        console.log(`   Участников: ${training.current_participants}/${training.max_participants}`);
        console.log(`   Цена: ${training.price} руб.`);

        // 3. Проверить текущий статус абонемента
        console.log('\n3. Текущий статус абонемента:');
        const beforeResult = await pool.query(
            'SELECT remaining_sessions, status FROM natural_slope_subscriptions WHERE id = $1',
            [client.subscription_id]
        );
        console.log(`   Занятий до использования: ${beforeResult.rows[0].remaining_sessions}`);
        console.log(`   Статус: ${beforeResult.rows[0].status}`);

        // 4. Использовать абонемент (симуляция записи)
        console.log('\n4. Симуляция записи на тренировку с использованием абонемента...');
        
        // Создаем запись участника
        const participantResult = await pool.query(`
            INSERT INTO session_participants (session_id, client_id, status)
            VALUES ($1, $2, 'confirmed')
            RETURNING id
        `, [training.id, client.client_id]);
        
        console.log(`   Создана запись участника ID: ${participantResult.rows[0].id}`);

        // Используем helper для списания абонемента
        const useResult = await checkAndUseSubscription(client.client_id, training.id);
        
        if (useResult.useSubscription) {
            console.log(`✅ Абонемент успешно использован!`);
            console.log(`   Осталось занятий: ${useResult.subscription.remaining_sessions}/${client.sessions_count}`);
            console.log(`   Новый статус: ${useResult.subscription.remaining_sessions === 0 ? 'used' : 'active'}`);
        } else {
            console.log('❌ Не удалось использовать абонемент');
        }

        // 5. Проверить запись использования
        console.log('\n5. Проверка записи использования абонемента...');
        const usageCheck = await checkTrainingSubscriptionUsage(training.id);
        if (usageCheck.usedSubscription) {
            console.log(`✅ Запись использования найдена`);
            console.log(`   ID использования: ${usageCheck.subscriptionInfo.id}`);
            console.log(`   Оригинальная цена: ${usageCheck.subscriptionInfo.original_price} руб.`);
            console.log(`   Цена по абонементу: ${usageCheck.subscriptionInfo.subscription_price} руб.`);
            console.log(`   Экономия: ${usageCheck.subscriptionInfo.savings} руб.`);
        }

        // 6. Отменить запись (симуляция)
        console.log('\n6. Симуляция отмены тренировки...');
        const returnResult = await returnSubscriptionSession(training.id);
        
        if (returnResult) {
            console.log(`✅ Занятие успешно возвращено в абонемент!`);
            
            const afterReturnResult = await pool.query(
                'SELECT remaining_sessions, status FROM natural_slope_subscriptions WHERE id = $1',
                [client.subscription_id]
            );
            console.log(`   Занятий после возврата: ${afterReturnResult.rows[0].remaining_sessions}`);
            console.log(`   Статус: ${afterReturnResult.rows[0].status}`);
        } else {
            console.log('❌ Не удалось вернуть занятие');
        }

        // 7. Очистка - удалить запись участника
        console.log('\n7. Очистка тестовых данных...');
        await pool.query('DELETE FROM session_participants WHERE id = $1', [participantResult.rows[0].id]);
        console.log('✅ Тестовые данные удалены');

        console.log('\n=== ТЕСТ ЗАВЕРШЕН УСПЕШНО ===\n');

    } catch (error) {
        console.error('\n❌ ОШИБКА ПРИ ТЕСТИРОВАНИИ:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

// Запуск теста
testSubscriptionBooking();

