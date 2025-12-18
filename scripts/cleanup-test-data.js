#!/usr/bin/env node
/**
 * Очистка тестовых данных, созданных скриптами тестирования
 */

require('dotenv').config();
const { pool } = require('../src/db/index');

// Цветной вывод
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function cleanupTestData() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        log('🧹 Начинаем очистку тестовых данных...', 'cyan');
        
        // 1. Удаляем тестовые бронирования (созданные сегодня для клиента ID 91)
        log('\n1. Удаление тестовых бронирований...', 'cyan');
        const bookingsResult = await client.query(`
            DELETE FROM kuliga_bookings
            WHERE client_id = 91 
            AND date >= '2025-12-18'
            AND (
                (date = '2025-12-19' AND start_time = '14:00:00') OR
                (date = '2025-12-20' AND start_time = '15:00:00')
            )
            RETURNING id, booking_type, date, start_time
        `);
        
        log(`   Удалено бронирований: ${bookingsResult.rows.length}`, 'green');
        bookingsResult.rows.forEach(b => {
            log(`   - ID: ${b.id}, тип: ${b.booking_type}, дата: ${b.date}, время: ${b.start_time}`, 'yellow');
        });
        
        // 2. Удаляем тестовые транзакции (созданные сегодня с provider_payment_id начинающимся с 'test-')
        log('\n2. Удаление тестовых транзакций...', 'cyan');
        const transactionsResult = await client.query(`
            DELETE FROM kuliga_transactions
            WHERE client_id = 91
            AND created_at >= '2025-12-18'
            AND (
                provider_payment_id LIKE 'test-%' OR
                provider_payment_id LIKE 'test-individual-%' OR
                provider_payment_id LIKE 'test-group-%' OR
                provider_payment_id LIKE 'test-program-%'
            )
            RETURNING id, type, amount, status
        `);
        
        log(`   Удалено транзакций: ${transactionsResult.rows.length}`, 'green');
        transactionsResult.rows.forEach(t => {
            log(`   - ID: ${t.id}, тип: ${t.type}, сумма: ${t.amount}, статус: ${t.status}`, 'yellow');
        });
        
        // 3. Удаляем тестовые слоты (созданные сегодня для инструктора ID 1)
        log('\n3. Удаление тестовых слотов...', 'cyan');
        const slotsResult = await client.query(`
            DELETE FROM kuliga_schedule_slots
            WHERE instructor_id = 1
            AND date >= '2025-12-18'
            AND (
                (date = '2025-12-19' AND start_time = '14:00:00' AND location = 'vorona') OR
                (date = '2025-12-20' AND start_time = '15:00:00' AND location = 'vorona')
            )
            AND status = 'available'
            RETURNING id, date, start_time, location
        `);
        
        log(`   Удалено слотов: ${slotsResult.rows.length}`, 'green');
        slotsResult.rows.forEach(s => {
            log(`   - ID: ${s.id}, дата: ${s.date}, время: ${s.start_time}, место: ${s.location}`, 'yellow');
        });
        
        // 4. Удаляем тестовые групповые тренировки (созданные сегодня для инструктора ID 1)
        log('\n4. Удаление тестовых групповых тренировок...', 'cyan');
        const trainingsResult = await client.query(`
            DELETE FROM kuliga_group_trainings
            WHERE instructor_id = 1
            AND date >= '2025-12-18'
            AND (
                (date = '2025-12-19' AND start_time = '14:00:00') OR
                (date = '2025-12-20' AND start_time = '15:00:00')
            )
            AND status = 'open'
            AND current_participants = 0
            RETURNING id, date, start_time, location
        `);
        
        log(`   Удалено групповых тренировок: ${trainingsResult.rows.length}`, 'green');
        trainingsResult.rows.forEach(t => {
            log(`   - ID: ${t.id}, дата: ${t.date}, время: ${t.start_time}, место: ${t.location}`, 'yellow');
        });
        
        await client.query('COMMIT');
        
        log('\n✅ Очистка тестовых данных завершена успешно!', 'green');
        
    } catch (error) {
        await client.query('ROLLBACK');
        log(`\n❌ Ошибка при очистке: ${error.message}`, 'red');
        console.error(error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Запуск
if (require.main === module) {
    cleanupTestData().catch(process.exit);
}

module.exports = { cleanupTestData };

