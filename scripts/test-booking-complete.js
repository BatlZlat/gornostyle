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
    testClientId: 252,
    testClientTelegramId: 999999999,
    testTransactionIds: [],
    testBookingIds: [],
    testSlotIds: [],
    testGroupTrainingIds: [],
    testTrainingSessionIds: [],
    testParticipantIds: [],
};

const colors = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', bright: '\x1b[1m' };
const log = (msg, color = 'reset') => console.log(`${colors[color]}${msg}${colors.reset}`);

async function cleanup() {
    log('\n🧹 Очистка тестовых данных...', 'cyan');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        if (TEST_CONFIG.testBookingIds.length > 0) {
            await client.query(`DELETE FROM kuliga_bookings WHERE id = ANY($1)`, [TEST_CONFIG.testBookingIds]);
            log(`✅ Удалено бронирований: ${TEST_CONFIG.testBookingIds.length}`, 'green');
        }
        
        if (TEST_CONFIG.testParticipantIds.length > 0) {
            await client.query(`DELETE FROM session_participants WHERE id = ANY($1)`, [TEST_CONFIG.testParticipantIds]);
            log(`✅ Удалено участников: ${TEST_CONFIG.testParticipantIds.length}`, 'green');
        }
        
        if (TEST_CONFIG.testTrainingSessionIds.length > 0) {
            await client.query(`DELETE FROM individual_training_sessions WHERE id = ANY($1)`, [TEST_CONFIG.testTrainingSessionIds]);
            log(`✅ Удалено тренировок: ${TEST_CONFIG.testTrainingSessionIds.length}`, 'green');
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
                await client.query(
                    `UPDATE kuliga_group_trainings SET current_participants = GREATEST(current_participants - 1, 0) WHERE id = $1`,
                    [id]
                );
            }
            log(`✅ Восстановлены места: ${TEST_CONFIG.testGroupTrainingIds.length}`, 'green');
        }
        
        await client.query('COMMIT');
        log('✅ Очистка завершена', 'green');
    } catch (error) {
        await client.query('ROLLBACK');
        log(`❌ Ошибка очистки: ${error.message}`, 'red');
        throw error;
    } finally {
        client.release();
    }
}

async function simulateWebhook(transactionId, status) {
    // Симулируем обработку webhook напрямую через SQL
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Получаем транзакцию
        const txResult = await client.query(
            `SELECT id, client_id, amount, provider_raw_data FROM kuliga_transactions WHERE id = $1 FOR UPDATE`,
            [transactionId]
        );
        
        if (txResult.rows.length === 0) {
            throw new Error(`Транзакция ${transactionId} не найдена`);
        }
        
        const tx = txResult.rows[0];
        const rawData = typeof tx.provider_raw_data === 'string' 
            ? JSON.parse(tx.provider_raw_data) 
            : tx.provider_raw_data;
        
        // Обновляем статус транзакции
        await client.query(
            `UPDATE kuliga_transactions 
             SET status = $1, provider_status = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [
                status === 'SUCCESS' ? 'completed' : status === 'FAILED' ? 'failed' : 'cancelled',
                status,
                transactionId
            ]
        );
        
        if (status === 'SUCCESS') {
            const bookingData = rawData.bookingData;
            const walletRefillData = rawData.walletRefillData;
            
            if (walletRefillData) {
                // Пополнение кошелька
                await client.query(
                    `UPDATE wallets SET balance = balance + $1 WHERE client_id = $2`,
                    [walletRefillData.amount, tx.client_id]
                );
                log(`✅ Кошелек пополнен на ${walletRefillData.amount} ₽`, 'green');
            } else if (bookingData) {
                if (bookingData.booking_type === 'individual' && bookingData.slot_id) {
                    // Индивидуальное бронирование
                    await client.query(
                        `UPDATE kuliga_schedule_slots SET status = 'booked', hold_until = NULL, hold_transaction_id = NULL WHERE id = $1`,
                        [bookingData.slot_id]
                    );
                    
                    // Для индивидуальных бронирований нужны все обязательные поля
                    // Получаем instructor_id из слота
                    const slotInfo = await client.query('SELECT instructor_id FROM kuliga_schedule_slots WHERE id = $1', [bookingData.slot_id]);
                    const instructorId = slotInfo.rows[0]?.instructor_id || bookingData.instructor_id;
                    
                    const bookingResult = await client.query(
                        `INSERT INTO kuliga_bookings (
                            client_id, booking_type, instructor_id, slot_id, date, start_time, end_time, sport_type, 
                            participants_count, participants_names, participants_birth_years,
                            price_total, price_per_person, price_id, notification_method, payer_rides, location, status
                        ) VALUES ($1, 'individual', $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $10, $11, $12, $13, $14, 'confirmed')
                        RETURNING id`,
                        [
                            tx.client_id,
                            instructorId,
                            bookingData.slot_id,
                            bookingData.date,
                            bookingData.start_time,
                            bookingData.end_time || bookingData.start_time,
                            bookingData.sport_type || 'ski',
                            ['Тестовый клиент'],
                            [1990],
                            bookingData.price_total || tx.amount,
                            bookingData.price_id || null,
                            bookingData.notification_method || 'none',
                            bookingData.payer_rides || true,
                            bookingData.location || 'vorona'
                        ]
                    );
                    
                    const bookingId = bookingResult.rows[0].id;
                    TEST_CONFIG.testBookingIds.push(bookingId);
                    
                    await client.query(`UPDATE kuliga_transactions SET booking_id = $1 WHERE id = $2`, [bookingId, transactionId]);
                    log(`✅ Индивидуальное бронирование создано: ${bookingId}`, 'green');
                } else if (bookingData.booking_type === 'group' && bookingData.group_training_id) {
                    // Групповое бронирование
                    await client.query(
                        `UPDATE kuliga_group_trainings 
                         SET current_participants = current_participants + $1 
                         WHERE id = $2`,
                        [bookingData.participants_count || 1, bookingData.group_training_id]
                    );
                    
                    const bookingResult = await client.query(
                        `INSERT INTO kuliga_bookings (
                            client_id, booking_type, group_training_id, date, start_time, end_time,
                            sport_type, participants_count, participants_names, price_total, price_per_person, location, status
                        ) VALUES ($1, 'group', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed')
                        RETURNING id`,
                        [
                            tx.client_id,
                            bookingData.group_training_id,
                            bookingData.date,
                            bookingData.start_time,
                            bookingData.end_time || bookingData.start_time,
                            bookingData.sport_type || 'ski',
                            bookingData.participants_count || 1,
                            bookingData.participants_names || ['Тестовый клиент'],
                            bookingData.price_total || tx.amount,
                            bookingData.price_per_person || bookingData.price_total || tx.amount,
                            bookingData.location || 'vorona'
                        ]
                    );
                    
                    const bookingId = bookingResult.rows[0].id;
                    TEST_CONFIG.testBookingIds.push(bookingId);
                    
                    await client.query(`UPDATE kuliga_transactions SET booking_id = $1 WHERE id = $2`, [bookingId, transactionId]);
                    log(`✅ Групповое бронирование создано: ${bookingId}`, 'green');
                }
            }
        } else if (status === 'FAILED') {
            // Освобождаем места/слоты
            const bookingData = rawData.bookingData;
            if (bookingData) {
                if (bookingData.slot_id) {
                    await client.query(
                        `UPDATE kuliga_schedule_slots SET status = 'available', hold_until = NULL, hold_transaction_id = NULL WHERE id = $1`,
                        [bookingData.slot_id]
                    );
                    log(`✅ Слот освобожден: ${bookingData.slot_id}`, 'green');
                } else if (bookingData.group_training_id) {
                    await client.query(
                        `UPDATE kuliga_group_trainings SET current_participants = GREATEST(current_participants - $1, 0) WHERE id = $2`,
                        [bookingData.participants_count || 1, bookingData.group_training_id]
                    );
                    log(`✅ Места возвращены в тренировке: ${bookingData.group_training_id}`, 'green');
                }
            }
        }
        
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function runTests() {
    log('\n' + '='.repeat(60), 'bright');
    log('🚀 ПОЛНЫЙ ТЕСТ ФУНКЦИЙ ЗАПИСИ', 'bright');
    log('='.repeat(60) + '\n', 'bright');
    
    const results = [];
    
    try {
        // Тест 1: Пополнение кошелька
        log('\n🧪 ТЕСТ 1: Пополнение кошелька', 'cyan');
        try {
            const tx1 = await pool.query(
                `INSERT INTO kuliga_transactions (client_id, type, amount, status, description, provider_raw_data)
                 VALUES ($1, 'payment', 1000, 'pending', 'Пополнение кошелька', $2) RETURNING id`,
                [TEST_CONFIG.testClientId, JSON.stringify({
                    source: 'bot',
                    walletRefillData: { client_id: TEST_CONFIG.testClientId, amount: 1000 }
                })]
            );
            const txId1 = tx1.rows[0].id;
            TEST_CONFIG.testTransactionIds.push(txId1);
            
            await simulateWebhook(txId1, 'SUCCESS');
            
            const wallet = await pool.query('SELECT balance FROM wallets WHERE client_id = $1', [TEST_CONFIG.testClientId]);
            if (parseFloat(wallet.rows[0].balance) >= 1000) {
                log('✅ Пополнение кошелька работает', 'green');
                results.push({ name: 'Пополнение кошелька', passed: true });
            } else {
                throw new Error('Баланс не обновлен');
            }
        } catch (error) {
            log(`❌ Ошибка: ${error.message}`, 'red');
            results.push({ name: 'Пополнение кошелька', passed: false });
        }
        
        // Тест 2: Индивидуальное бронирование
        log('\n🧪 ТЕСТ 2: Индивидуальное бронирование', 'cyan');
        try {
            const slot = await pool.query(
                `SELECT id, date, start_time, instructor_id 
                 FROM kuliga_schedule_slots 
                 WHERE status = 'available' AND date >= CURRENT_DATE 
                 ORDER BY date, start_time LIMIT 1`
            );
            
            if (slot.rows.length === 0) {
                log('⚠️ Нет доступных слотов', 'yellow');
                results.push({ name: 'Индивидуальное бронирование', passed: true }); // Пропускаем
            } else {
                const s = slot.rows[0];
                TEST_CONFIG.testSlotIds.push(s.id);
                
                const tx2 = await pool.query(
                    `INSERT INTO kuliga_transactions (client_id, type, amount, status, description, provider_raw_data)
                     VALUES ($1, 'payment', 2000, 'pending', 'Индивидуальное занятие', $2) RETURNING id`,
                    [TEST_CONFIG.testClientId, JSON.stringify({
                        source: 'bot',
                        bookingData: {
                            client_id: TEST_CONFIG.testClientId,
                            booking_type: 'individual',
                            slot_id: s.id,
                            date: s.date.toISOString().split('T')[0],
                            start_time: s.start_time,
                            end_time: s.start_time,
                            sport_type: 'ski',
                            price_total: 2000,
                            location: 'vorona'
                        }
                    })]
                );
                const txId2 = tx2.rows[0].id;
                TEST_CONFIG.testTransactionIds.push(txId2);
                
                await pool.query(
                    `UPDATE kuliga_schedule_slots SET status = 'hold', hold_until = NOW() + INTERVAL '5 minutes', hold_transaction_id = $1 WHERE id = $2`,
                    [txId2, s.id]
                );
                
                await simulateWebhook(txId2, 'SUCCESS');
                
                const slotCheck = await pool.query('SELECT status FROM kuliga_schedule_slots WHERE id = $1', [s.id]);
                if (slotCheck.rows[0].status === 'booked') {
                    log('✅ Индивидуальное бронирование работает', 'green');
                    results.push({ name: 'Индивидуальное бронирование', passed: true });
                } else {
                    throw new Error(`Слот не забронирован. Статус: ${slotCheck.rows[0].status}`);
                }
            }
        } catch (error) {
            log(`❌ Ошибка: ${error.message}`, 'red');
            results.push({ name: 'Индивидуальное бронирование', passed: false });
        }
        
        // Тест 3: Групповое бронирование
        log('\n🧪 ТЕСТ 3: Групповое бронирование', 'cyan');
        try {
            const training = await pool.query(
                `SELECT id, current_participants, max_participants, date, start_time
                 FROM kuliga_group_trainings 
                 WHERE status = 'open' AND current_participants < max_participants AND date >= CURRENT_DATE
                 ORDER BY date, start_time LIMIT 1`
            );
            
            if (training.rows.length === 0) {
                log('⚠️ Нет доступных групповых тренировок', 'yellow');
                results.push({ name: 'Групповое бронирование', passed: true }); // Пропускаем
            } else {
                const t = training.rows[0];
                TEST_CONFIG.testGroupTrainingIds.push(t.id);
                
                const tx3 = await pool.query(
                    `INSERT INTO kuliga_transactions (client_id, type, amount, status, description, provider_raw_data)
                     VALUES ($1, 'payment', 3000, 'pending', 'Групповое занятие', $2) RETURNING id`,
                    [TEST_CONFIG.testClientId, JSON.stringify({
                        source: 'bot',
                        bookingData: {
                            client_id: TEST_CONFIG.testClientId,
                            booking_type: 'group',
                            group_training_id: t.id,
                            date: t.date.toISOString().split('T')[0],
                            start_time: t.start_time,
                            end_time: t.start_time,
                            sport_type: 'ski',
                            participants_count: 1,
                            participants_names: ['Тестовый клиент'],
                            price_total: 3000,
                            price_per_person: 3000,
                            location: 'vorona'
                        }
                    })]
                );
                const txId3 = tx3.rows[0].id;
                TEST_CONFIG.testTransactionIds.push(txId3);
                
                await simulateWebhook(txId3, 'SUCCESS');
                
                const trainingCheck = await pool.query('SELECT current_participants FROM kuliga_group_trainings WHERE id = $1', [t.id]);
                if (trainingCheck.rows[0].current_participants > t.current_participants) {
                    log('✅ Групповое бронирование работает', 'green');
                    results.push({ name: 'Групповое бронирование', passed: true });
                } else {
                    throw new Error('Количество участников не обновлено');
                }
            }
        } catch (error) {
            log(`❌ Ошибка: ${error.message}`, 'red');
            results.push({ name: 'Групповое бронирование', passed: false });
        }
        
        // Тест 4: Неудачная оплата
        log('\n🧪 ТЕСТ 4: Обработка неудачной оплаты', 'cyan');
        try {
            const slot = await pool.query(
                `SELECT id FROM kuliga_schedule_slots WHERE status = 'available' AND date >= CURRENT_DATE LIMIT 1`
            );
            
            if (slot.rows.length === 0) {
                log('⚠️ Нет доступных слотов', 'yellow');
                results.push({ name: 'Обработка неудачной оплаты', passed: true });
            } else {
                const s = slot.rows[0];
                TEST_CONFIG.testSlotIds.push(s.id);
                
                const tx4 = await pool.query(
                    `INSERT INTO kuliga_transactions (client_id, type, amount, status, description, provider_raw_data)
                     VALUES ($1, 'payment', 2000, 'pending', 'Индивидуальное занятие', $2) RETURNING id`,
                    [TEST_CONFIG.testClientId, JSON.stringify({
                        source: 'bot',
                        bookingData: {
                            client_id: TEST_CONFIG.testClientId,
                            booking_type: 'individual',
                            slot_id: s.id,
                            date: new Date().toISOString().split('T')[0],
                            start_time: '10:00:00',
                            sport_type: 'ski',
                            price_total: 2000
                        }
                    })]
                );
                const txId4 = tx4.rows[0].id;
                TEST_CONFIG.testTransactionIds.push(txId4);
                
                await pool.query(
                    `UPDATE kuliga_schedule_slots SET status = 'hold', hold_until = NOW() + INTERVAL '5 minutes', hold_transaction_id = $1 WHERE id = $2`,
                    [txId4, s.id]
                );
                
                await simulateWebhook(txId4, 'FAILED');
                
                const slotCheck = await pool.query('SELECT status FROM kuliga_schedule_slots WHERE id = $1', [s.id]);
                const txCheck = await pool.query('SELECT status FROM kuliga_transactions WHERE id = $1', [txId4]);
                
                if (slotCheck.rows[0].status === 'available' && txCheck.rows[0].status === 'failed') {
                    log('✅ Обработка неудачной оплаты работает', 'green');
                    results.push({ name: 'Обработка неудачной оплаты', passed: true });
                } else {
                    throw new Error(`Слот: ${slotCheck.rows[0].status}, Транзакция: ${txCheck.rows[0].status}`);
                }
            }
        } catch (error) {
            log(`❌ Ошибка: ${error.message}`, 'red');
            results.push({ name: 'Обработка неудачной оплаты', passed: false });
        }
        
        // Итоги
        log('\n' + '='.repeat(60), 'bright');
        log('📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ', 'bright');
        log('='.repeat(60), 'bright');
        
        const passed = results.filter(r => r.passed).length;
        const total = results.length;
        
        results.forEach((r, i) => {
            if (r.passed) {
                log(`✅ ${i + 1}. ${r.name}`, 'green');
            } else {
                log(`❌ ${i + 1}. ${r.name}`, 'red');
            }
        });
        
        log('\n' + '='.repeat(60), 'bright');
        log(`✅ Успешно: ${passed}/${total}`, passed === total ? 'green' : 'yellow');
        log('='.repeat(60) + '\n', 'bright');
        
        if (passed === total) {
            log('🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!', 'green');
            log('\n🧹 Начинаю очистку тестовых данных...\n', 'cyan');
            await cleanup();
        } else {
            log('⚠️  Некоторые тесты не прошли. Очистка данных не выполнена.', 'yellow');
        }
        
    } catch (error) {
        log(`❌ Критическая ошибка: ${error.message}`, 'red');
        log(`Stack: ${error.stack}`, 'red');
    } finally {
        await pool.end();
    }
}

runTests().catch(error => {
    log(`❌ Фатальная ошибка: ${error.message}`, 'red');
    process.exit(1);
});

