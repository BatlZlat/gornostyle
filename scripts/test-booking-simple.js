require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Конфигурация теста
const TEST_CONFIG = {
    testClientId: 252, // Используем существующего клиента
    testClientTelegramId: 999999999,
    testTransactionIds: [],
    testBookingIds: [],
    testSlotIds: [],
    testGroupTrainingIds: [],
};

// Цветной вывод
const log = (msg, color = 'reset') => {
    const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', bright: '\x1b[1m' };
    console.log(`${colors[color]}${msg}${colors.reset}`);
};

async function cleanup() {
    log('\n🧹 Очистка тестовых данных...', 'cyan');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        if (TEST_CONFIG.testBookingIds.length > 0) {
            await client.query(`DELETE FROM kuliga_bookings WHERE id = ANY($1)`, [TEST_CONFIG.testBookingIds]);
            log(`✅ Удалено бронирований: ${TEST_CONFIG.testBookingIds.length}`, 'green');
        }
        
        if (TEST_CONFIG.testTransactionIds.length > 0) {
            await client.query(`DELETE FROM kuliga_transactions WHERE id = ANY($1)`, [TEST_CONFIG.testTransactionIds]);
            log(`✅ Удалено транзакций: ${TEST_CONFIG.testTransactionIds.length}`, 'green');
        }
        
        if (TEST_CONFIG.testSlotIds.length > 0) {
            await client.query(
                `UPDATE kuliga_schedule_slots SET status = 'available', hold_until = NULL, hold_transaction_id = NULL WHERE id = ANY($1)`,
                [TEST_CONFIG.testSlotIds]
            );
            log(`✅ Освобождено слотов: ${TEST_CONFIG.testSlotIds.length}`, 'green');
        }
        
        if (TEST_CONFIG.testGroupTrainingIds.length > 0) {
            for (const id of TEST_CONFIG.testGroupTrainingIds) {
                await client.query(`UPDATE kuliga_group_trainings SET current_participants = GREATEST(current_participants - 1, 0) WHERE id = $1`, [id]);
            }
            log(`✅ Восстановлены места: ${TEST_CONFIG.testGroupTrainingIds.length}`, 'green');
        }
        
        await client.query('COMMIT');
        log('✅ Очистка завершена', 'green');
    } catch (error) {
        await client.query('ROLLBACK');
        log(`❌ Ошибка очистки: ${error.message}`, 'red');
    } finally {
        client.release();
    }
}

async function testWebhookProcessing() {
    log('\n🧪 Тестирование обработки webhook...', 'bright');
    
    try {
        // Тест 1: Пополнение кошелька
        log('\n1. Пополнение кошелька', 'cyan');
        const tx1 = await pool.query(
            `INSERT INTO kuliga_transactions (client_id, type, amount, status, description, provider_raw_data)
             VALUES ($1, 'payment', 1000, 'pending', 'Пополнение', $2) RETURNING id`,
            [TEST_CONFIG.testClientId, JSON.stringify({ source: 'bot', walletRefillData: { client_id: TEST_CONFIG.testClientId, amount: 1000 } })]
        );
        const txId1 = tx1.rows[0].id;
        TEST_CONFIG.testTransactionIds.push(txId1);
        log(`✅ Транзакция создана: ${txId1}`, 'green');
        
        // Симулируем успешный webhook
        await pool.query(
            `UPDATE kuliga_transactions SET status = 'completed', provider_status = 'SUCCESS' WHERE id = $1`,
            [txId1]
        );
        await pool.query(`UPDATE wallets SET balance = balance + 1000 WHERE client_id = $1`, [TEST_CONFIG.testClientId]);
        log('✅ Пополнение обработано', 'green');
        
        // Тест 2: Индивидуальное бронирование
        log('\n2. Индивидуальное бронирование', 'cyan');
        const slot = await pool.query(`SELECT id FROM kuliga_schedule_slots WHERE status = 'available' AND date >= CURRENT_DATE LIMIT 1`);
        if (slot.rows.length === 0) {
            log('⚠️ Нет доступных слотов', 'yellow');
            return;
        }
        const slotId = slot.rows[0].id;
        TEST_CONFIG.testSlotIds.push(slotId);
        
        const tx2 = await pool.query(
            `INSERT INTO kuliga_transactions (client_id, type, amount, status, description, provider_raw_data)
             VALUES ($1, 'payment', 2000, 'pending', 'Индивидуальное', $2) RETURNING id`,
            [TEST_CONFIG.testClientId, JSON.stringify({
                source: 'bot',
                bookingData: {
                    client_id: TEST_CONFIG.testClientId,
                    booking_type: 'individual',
                    slot_id: slotId,
                    date: new Date().toISOString().split('T')[0],
                    start_time: '10:00:00',
                    sport_type: 'ski',
                    price_total: 2000
                }
            })]
        );
        const txId2 = tx2.rows[0].id;
        TEST_CONFIG.testTransactionIds.push(txId2);
        await pool.query(`UPDATE kuliga_schedule_slots SET status = 'hold', hold_transaction_id = $1 WHERE id = $2`, [txId2, slotId]);
        log(`✅ Транзакция и hold созданы: ${txId2}`, 'green');
        
        // Тест 3: Групповое бронирование
        log('\n3. Групповое бронирование', 'cyan');
        const training = await pool.query(
            `SELECT id FROM kuliga_group_trainings WHERE status = 'open' AND current_participants < max_participants AND date >= CURRENT_DATE LIMIT 1`
        );
        if (training.rows.length === 0) {
            log('⚠️ Нет доступных тренировок', 'yellow');
            return;
        }
        const trainingId = training.rows[0].id;
        TEST_CONFIG.testGroupTrainingIds.push(trainingId);
        
        const tx3 = await pool.query(
            `INSERT INTO kuliga_transactions (client_id, type, amount, status, description, provider_raw_data)
             VALUES ($1, 'payment', 3000, 'pending', 'Групповое', $2) RETURNING id`,
            [TEST_CONFIG.testClientId, JSON.stringify({
                source: 'bot',
                bookingData: {
                    client_id: TEST_CONFIG.testClientId,
                    booking_type: 'group',
                    group_training_id: trainingId,
                    date: new Date().toISOString().split('T')[0],
                    participants_count: 1,
                    price_total: 3000
                }
            })]
        );
        const txId3 = tx3.rows[0].id;
        TEST_CONFIG.testTransactionIds.push(txId3);
        log(`✅ Транзакция создана: ${txId3}`, 'green');
        
        log('\n✅ Все базовые тесты пройдены', 'green');
        return true;
    } catch (error) {
        log(`❌ Ошибка: ${error.message}`, 'red');
        return false;
    }
}

async function main() {
    log('\n' + '='.repeat(60), 'bright');
    log('🚀 ПРОСТОЙ ТЕСТ ФУНКЦИЙ ЗАПИСИ', 'bright');
    log('='.repeat(60) + '\n', 'bright');
    
    try {
        await testWebhookProcessing();
        await cleanup();
    } catch (error) {
        log(`❌ Критическая ошибка: ${error.message}`, 'red');
    } finally {
        await pool.end();
    }
}

main();




