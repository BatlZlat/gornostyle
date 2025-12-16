/**
 * Диагностический скрипт для проверки проблемы с созданием бронирований
 * 
 * Симулирует весь процесс обработки webhook'а без реальных платежей
 * Проверяет каждый этап и выявляет проблему
 */

const { pool } = require('../src/db');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';

// Тестовые данные
const TEST_DATA = {
    client_id: 91, // Используем существующего клиента
    instructor_id: 1,
    slot_id: null, // Будет создан динамически
    date: moment.tz(TIMEZONE).add(1, 'days').format('YYYY-MM-DD'),
    start_time: '12:00:00',
    end_time: '13:00:00',
    sport_type: 'ski',
    booking_type: 'individual',
    participants_count: 1,
    participants_names: ['Тестовый Клиент'],
    participants_birth_years: [1988],
    price_total: 100,
    price_per_person: 100,
    price_id: 1,
    notification_method: 'both',
    payer_rides: true,
    location: 'vorona',
    client_name: 'Тестовый Клиент',
    client_phone: '+79999999999',
    client_email: 'test@example.com',
    instructor_name: 'Тебякин Данила'
};

async function checkDatabaseLocks() {
    console.log('\n🔍 Проверка блокировок БД...');
    try {
        const result = await pool.query(`
            SELECT 
                l.locktype,
                l.relation::regclass as table_name,
                l.mode,
                l.granted,
                l.pid,
                a.query,
                a.state,
                a.wait_event_type,
                a.wait_event
            FROM pg_locks l
            LEFT JOIN pg_stat_activity a ON l.pid = a.pid
            WHERE l.relation::regclass::text IN ('kuliga_transactions', 'kuliga_bookings', 'kuliga_schedule_slots')
            ORDER BY l.granted, l.pid
        `);
        
        if (result.rows.length > 0) {
            console.log(`⚠️ Найдено ${result.rows.length} активных блокировок:`);
            result.rows.forEach((lock, idx) => {
                console.log(`  ${idx + 1}. ${lock.table_name} - ${lock.mode} (granted: ${lock.granted}, pid: ${lock.pid})`);
                if (lock.query) {
                    console.log(`     Query: ${lock.query.substring(0, 100)}...`);
                }
            });
            return true;
        } else {
            console.log('✅ Активных блокировок нет');
            return false;
        }
    } catch (error) {
        console.error('❌ Ошибка при проверке блокировок:', error.message);
        return false;
    }
}

async function checkActiveTransactions() {
    console.log('\n🔍 Проверка активных транзакций...');
    try {
        const result = await pool.query(`
            SELECT 
                pid,
                usename,
                application_name,
                state,
                wait_event_type,
                wait_event,
                query_start,
                state_change,
                query
            FROM pg_stat_activity
            WHERE state != 'idle'
              AND pid != pg_backend_pid()
            ORDER BY query_start
        `);
        
        if (result.rows.length > 0) {
            console.log(`⚠️ Найдено ${result.rows.length} активных транзакций:`);
            result.rows.forEach((tx, idx) => {
                console.log(`  ${idx + 1}. PID: ${tx.pid}, State: ${tx.state}, Wait: ${tx.wait_event_type}/${tx.wait_event}`);
                if (tx.query) {
                    console.log(`     Query: ${tx.query.substring(0, 100)}...`);
                }
            });
            return true;
        } else {
            console.log('✅ Активных транзакций нет');
            return false;
        }
    } catch (error) {
        console.error('❌ Ошибка при проверке транзакций:', error.message);
        return false;
    }
}

async function createTestSlot() {
    console.log('\n📅 Создание тестового слота...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Проверяем, есть ли свободный слот
        const slotCheck = await client.query(`
            SELECT id FROM kuliga_schedule_slots
            WHERE instructor_id = $1
              AND date = $2
              AND start_time = $3
              AND status = 'available'
            LIMIT 1
        `, [TEST_DATA.instructor_id, TEST_DATA.date, TEST_DATA.start_time]);
        
        let slotId;
        if (slotCheck.rows.length > 0) {
            slotId = slotCheck.rows[0].id;
            console.log(`✅ Используем существующий слот #${slotId}`);
        } else {
            // Создаем новый слот
            const slotResult = await client.query(`
                INSERT INTO kuliga_schedule_slots (
                    instructor_id, date, start_time, end_time, status, location
                ) VALUES ($1, $2, $3, $4, 'available', $5)
                RETURNING id
            `, [
                TEST_DATA.instructor_id,
                TEST_DATA.date,
                TEST_DATA.start_time,
                TEST_DATA.end_time,
                TEST_DATA.location
            ]);
            slotId = slotResult.rows[0].id;
            console.log(`✅ Создан новый слот #${slotId}`);
        }
        
        await client.query('COMMIT');
        return slotId;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function testTransactionCreation() {
    console.log('\n🧪 ТЕСТ 1: Создание транзакции с bookingData...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const bookingData = {
            ...TEST_DATA,
            slot_id: await createTestSlot()
        };
        
        const providerRawData = {
            bookingData: bookingData,
            paymentData: {
                Data: {
                    amount: bookingData.price_total,
                    status: 'CREATED',
                    operationId: `test-${Date.now()}`,
                    paymentLinkId: `gornostyle72-winter-test-${Date.now()}`
                }
            }
        };
        
        const jsonSize = JSON.stringify(providerRawData).length;
        console.log(`📦 Размер provider_raw_data: ${jsonSize} байт`);
        
        const txResult = await client.query(`
            INSERT INTO kuliga_transactions (
                client_id, type, amount, status, payment_provider,
                provider_order_id, provider_status, provider_raw_data
            ) VALUES ($1, 'payment', $2, 'pending', 'tochka', $3, 'CREATED', $4)
            RETURNING id
        `, [
            TEST_DATA.client_id,
            bookingData.price_total,
            `gornostyle72-winter-test-${Date.now()}`,
            JSON.stringify(providerRawData)
        ]);
        
        const transactionId = txResult.rows[0].id;
        console.log(`✅ Транзакция #${transactionId} создана`);
        
        await client.query('COMMIT');
        return { transactionId, bookingData, providerRawData };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function testBookingCreation(transactionId, bookingData) {
    console.log('\n🧪 ТЕСТ 2: Создание бронирования...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Резервируем слот
        await client.query(`
            UPDATE kuliga_schedule_slots
            SET status = 'hold',
                hold_until = NOW() + INTERVAL '5 minutes',
                hold_transaction_id = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [transactionId, bookingData.slot_id]);
        console.log(`✅ Слот #${bookingData.slot_id} заблокирован (hold)`);
        
        // Создаем бронирование
        const bookingResult = await client.query(`
            INSERT INTO kuliga_bookings (
                client_id, booking_type, instructor_id, slot_id,
                date, start_time, end_time, sport_type,
                participants_count, participants_names, participants_birth_years,
                price_total, price_per_person, price_id,
                notification_method, payer_rides, location, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'confirmed')
            RETURNING id
        `, [
            bookingData.client_id,
            bookingData.booking_type,
            bookingData.instructor_id,
            bookingData.slot_id,
            bookingData.date,
            bookingData.start_time,
            bookingData.end_time,
            bookingData.sport_type,
            bookingData.participants_count,
            bookingData.participants_names,
            bookingData.participants_birth_years,
            bookingData.price_total,
            bookingData.price_per_person,
            bookingData.price_id,
            bookingData.notification_method,
            bookingData.payer_rides,
            bookingData.location
        ]);
        
        const bookingId = bookingResult.rows[0].id;
        console.log(`✅ Бронирование #${bookingId} создано`);
        
        // Обновляем слот
        await client.query(`
            UPDATE kuliga_schedule_slots
            SET status = 'booked',
                hold_until = NULL,
                hold_transaction_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [bookingData.slot_id]);
        console.log(`✅ Слот #${bookingData.slot_id} обновлен (booked)`);
        
        await client.query('COMMIT');
        return bookingId;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function testTransactionUpdate(transactionId, bookingId, providerRawData) {
    console.log('\n🧪 ТЕСТ 3: Обновление транзакции (ПРОБЛЕМНЫЙ ЗАПРОС)...');
    const client = await pool.connect();
    
    // Проверяем блокировки перед UPDATE
    await checkDatabaseLocks();
    await checkActiveTransactions();
    
    try {
        await client.query('BEGIN');
        
        console.log(`💾 Выполняю UPDATE транзакции #${transactionId}...`);
        const jsonString = JSON.stringify(providerRawData);
        console.log(`📦 Размер provider_raw_data: ${jsonString.length} байт`);
        
        // Тест с таймаутом
        const startTime = Date.now();
        const timeout = 5000; // 5 секунд
        
        const updatePromise = client.query(`
            UPDATE kuliga_transactions
            SET provider_status = $1,
                provider_payment_id = $2,
                provider_order_id = $3,
                payment_method = COALESCE($4, payment_method),
                provider_raw_data = $5,
                booking_id = COALESCE($7, booking_id),
                status = CASE
                    WHEN $1 = 'SUCCESS' THEN 'completed'
                    WHEN $1 = 'FAILED' THEN 'failed'
                    WHEN $1 = 'REFUNDED' THEN 'cancelled'
                    WHEN $1 = 'PENDING' THEN 'pending'
                    ELSE status
                END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING id, status, booking_id
        `, [
            'SUCCESS',
            `test-payment-${Date.now()}`,
            `gornostyle72-winter-test-${Date.now()}`,
            'card',
            jsonString,
            transactionId,
            bookingId
        ]);
        
        // Таймаут для запроса
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('TIMEOUT: Запрос UPDATE завис более 5 секунд')), timeout);
        });
        
        const txUpdateResult = await Promise.race([updatePromise, timeoutPromise]);
        const duration = Date.now() - startTime;
        
        console.log(`✅ UPDATE выполнен за ${duration}ms`);
        console.log(`✅ Результат:`, {
            rows: txUpdateResult.rows.length,
            id: txUpdateResult.rows[0]?.id,
            status: txUpdateResult.rows[0]?.status,
            booking_id: txUpdateResult.rows[0]?.booking_id
        });
        
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        
        if (error.message.includes('TIMEOUT')) {
            console.error(`❌ TIMEOUT: Запрос UPDATE завис более ${timeout}ms`);
            console.error('   Это указывает на блокировку или deadlock');
            
            // Проверяем блокировки после ошибки
            await checkDatabaseLocks();
            await checkActiveTransactions();
        } else {
            console.error(`❌ Ошибка при UPDATE:`, error.message);
            console.error(`   Код:`, error.code);
            console.error(`   Детали:`, error.detail);
            console.error(`   Позиция:`, error.position);
        }
        
        throw error;
    } finally {
        client.release();
    }
}

async function testSimplifiedUpdate(transactionId, bookingId) {
    console.log('\n🧪 ТЕСТ 4: Упрощенный UPDATE (только критичные поля)...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        console.log(`💾 Выполняю упрощенный UPDATE транзакции #${transactionId}...`);
        
        const startTime = Date.now();
        const txUpdateResult = await client.query(`
            UPDATE kuliga_transactions
            SET provider_status = $1,
                status = 'completed',
                booking_id = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING id, status, booking_id
        `, ['SUCCESS', bookingId, transactionId]);
        
        const duration = Date.now() - startTime;
        console.log(`✅ Упрощенный UPDATE выполнен за ${duration}ms`);
        console.log(`✅ Результат:`, {
            rows: txUpdateResult.rows.length,
            id: txUpdateResult.rows[0]?.id,
            status: txUpdateResult.rows[0]?.status,
            booking_id: txUpdateResult.rows[0]?.booking_id
        });
        
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Ошибка при упрощенном UPDATE:`, error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function testSeparateTransactions(transactionId, bookingData, providerRawData) {
    console.log('\n🧪 ТЕСТ 5: Раздельные транзакции (Стратегия 1)...');
    
    // Транзакция 1: Создание бронирования
    let bookingId;
    try {
        const client1 = await pool.connect();
        try {
            await client1.query('BEGIN');
            
            // Резервируем слот
            await client1.query(`
                UPDATE kuliga_schedule_slots
                SET status = 'hold',
                    hold_until = NOW() + INTERVAL '30 minutes',
                    hold_transaction_id = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [transactionId, bookingData.slot_id]);
            
            // Создаем бронирование
            const bookingResult = await client1.query(`
                INSERT INTO kuliga_bookings (
                    client_id, booking_type, instructor_id, slot_id,
                    date, start_time, end_time, sport_type,
                    participants_count, participants_names, participants_birth_years,
                    price_total, price_per_person, price_id,
                    notification_method, payer_rides, location, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'confirmed')
                RETURNING id
            `, [
                bookingData.client_id,
                bookingData.booking_type,
                bookingData.instructor_id,
                bookingData.slot_id,
                bookingData.date,
                bookingData.start_time,
                bookingData.end_time,
                bookingData.sport_type,
                bookingData.participants_count,
                bookingData.participants_names,
                bookingData.participants_birth_years,
                bookingData.price_total,
                bookingData.price_per_person,
                bookingData.price_id,
                bookingData.notification_method,
                bookingData.payer_rides,
                bookingData.location
            ]);
            
            bookingId = bookingResult.rows[0].id;
            
            // Обновляем слот
            await client1.query(`
                UPDATE kuliga_schedule_slots
                SET status = 'booked',
                    hold_until = NULL,
                    hold_transaction_id = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [bookingData.slot_id]);
            
            await client1.query('COMMIT');
            console.log(`✅ Транзакция 1: Бронирование #${bookingId} создано и закоммичено`);
        } catch (error) {
            await client1.query('ROLLBACK');
            throw error;
        } finally {
            client1.release();
        }
        
        // Проверяем, что бронирование сохранилось
        const checkResult = await pool.query(
            'SELECT id, status FROM kuliga_bookings WHERE id = $1',
            [bookingId]
        );
        
        if (checkResult.rows.length > 0) {
            console.log(`✅ Бронирование #${bookingId} существует в БД (status: ${checkResult.rows[0].status})`);
        } else {
            throw new Error('Бронирование не найдено в БД после COMMIT!');
        }
        
        // Транзакция 2: Обновление транзакции
        const client2 = await pool.connect();
        try {
            await client2.query('BEGIN');
            
            const startTime = Date.now();
            const txUpdateResult = await client2.query(`
                UPDATE kuliga_transactions
                SET provider_status = $1,
                    provider_payment_id = $2,
                    provider_order_id = $3,
                    payment_method = COALESCE($4, payment_method),
                    provider_raw_data = $5,
                    booking_id = $6,
                    status = 'completed',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $7
                RETURNING id, status, booking_id
            `, [
                'SUCCESS',
                `test-payment-${Date.now()}`,
                `gornostyle72-winter-test-${Date.now()}`,
                'card',
                JSON.stringify(providerRawData),
                bookingId,
                transactionId
            ]);
            
            const duration = Date.now() - startTime;
            console.log(`✅ Транзакция 2: UPDATE выполнен за ${duration}ms`);
            console.log(`✅ Результат:`, {
                rows: txUpdateResult.rows.length,
                id: txUpdateResult.rows[0]?.id,
                status: txUpdateResult.rows[0]?.status,
                booking_id: txUpdateResult.rows[0]?.booking_id
            });
            
            await client2.query('COMMIT');
            console.log(`✅ Транзакция 2: UPDATE закоммичен`);
        } catch (error) {
            await client2.query('ROLLBACK');
            console.error(`❌ Транзакция 2: UPDATE упал, НО бронирование #${bookingId} уже сохранено!`);
            throw error;
        } finally {
            client2.release();
        }
        
        return bookingId;
    } catch (error) {
        console.error(`❌ Ошибка в тесте раздельных транзакций:`, error.message);
        throw error;
    }
}

async function cleanup(testTransactionId, testBookingId, testSlotId) {
    console.log('\n🧹 Очистка тестовых данных...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        if (testBookingId) {
            await client.query('DELETE FROM kuliga_bookings WHERE id = $1', [testBookingId]);
            console.log(`✅ Удалено бронирование #${testBookingId}`);
        }
        
        if (testTransactionId) {
            await client.query('DELETE FROM kuliga_transactions WHERE id = $1', [testTransactionId]);
            console.log(`✅ Удалена транзакция #${testTransactionId}`);
        }
        
        if (testSlotId) {
            await client.query(`
                UPDATE kuliga_schedule_slots
                SET status = 'available',
                    hold_until = NULL,
                    hold_transaction_id = NULL
                WHERE id = $1
            `, [testSlotId]);
            console.log(`✅ Слот #${testSlotId} освобожден`);
        }
        
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('⚠️ Ошибка при очистке:', error.message);
    } finally {
        client.release();
    }
}

async function runDiagnostics() {
    console.log('🔬 ДИАГНОСТИКА ПРОБЛЕМЫ С СОЗДАНИЕМ БРОНИРОВАНИЙ\n');
    console.log('=' .repeat(60));
    
    let testTransactionId = null;
    let testBookingId = null;
    let testSlotId = null;
    let bookingData = null;
    let providerRawData = null;
    
    try {
        // Проверка окружения
        console.log('\n📋 Проверка окружения...');
        const dbCheck = await pool.query('SELECT NOW() as current_time, version() as pg_version');
        console.log(`✅ Подключение к БД: OK`);
        console.log(`   Время БД: ${dbCheck.rows[0].current_time}`);
        console.log(`   PostgreSQL: ${dbCheck.rows[0].pg_version.split(' ')[0]} ${dbCheck.rows[0].pg_version.split(' ')[1]}`);
        
        // Проверка блокировок перед началом
        await checkDatabaseLocks();
        await checkActiveTransactions();
        
        // ТЕСТ 1: Создание транзакции
        const test1Result = await testTransactionCreation();
        testTransactionId = test1Result.transactionId;
        bookingData = test1Result.bookingData;
        providerRawData = test1Result.providerRawData;
        testSlotId = bookingData.slot_id;
        
        // ТЕСТ 2: Создание бронирования (в одной транзакции с UPDATE)
        console.log('\n' + '='.repeat(60));
        console.log('ТЕСТ: Полный процесс (как в webhook handler)');
        console.log('='.repeat(60));
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Создаем бронирование
            const bookingResult = await client.query(`
                INSERT INTO kuliga_bookings (
                    client_id, booking_type, instructor_id, slot_id,
                    date, start_time, end_time, sport_type,
                    participants_count, participants_names, participants_birth_years,
                    price_total, price_per_person, price_id,
                    notification_method, payer_rides, location, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'confirmed')
                RETURNING id
            `, [
                bookingData.client_id,
                bookingData.booking_type,
                bookingData.instructor_id,
                bookingData.slot_id,
                bookingData.date,
                bookingData.start_time,
                bookingData.end_time,
                bookingData.sport_type,
                bookingData.participants_count,
                bookingData.participants_names,
                bookingData.participants_birth_years,
                bookingData.price_total,
                bookingData.price_per_person,
                bookingData.price_id,
                bookingData.notification_method,
                bookingData.payer_rides,
                bookingData.location
            ]);
            
            testBookingId = bookingResult.rows[0].id;
            console.log(`✅ Бронирование #${testBookingId} создано`);
            
            // Обновляем слот
            await client.query(`
                UPDATE kuliga_schedule_slots
                SET status = 'booked',
                    hold_until = NULL,
                    hold_transaction_id = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [bookingData.slot_id]);
            console.log(`✅ Слот обновлен`);
            
            // ТЕСТ 3: Проблемный UPDATE
            console.log('\n--- ПРОБЛЕМНЫЙ ЗАПРОС ---');
            await testTransactionUpdate(testTransactionId, testBookingId, providerRawData);
            
            await client.query('COMMIT');
            console.log(`✅ COMMIT выполнен успешно`);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ ROLLBACK выполнен из-за ошибки:`, error.message);
            throw error;
        } finally {
            client.release();
        }
        
        // ТЕСТ 4: Упрощенный UPDATE
        console.log('\n' + '='.repeat(60));
        console.log('ТЕСТ: Упрощенный UPDATE');
        console.log('='.repeat(60));
        
        // Создаем новую транзакцию для теста
        const test2Result = await testTransactionCreation();
        const test2TransactionId = test2Result.transactionId;
        const test2BookingId = await testBookingCreation(test2TransactionId, test2Result.bookingData);
        
        await testSimplifiedUpdate(test2TransactionId, test2BookingId);
        
        // Очистка теста 4
        await cleanup(test2TransactionId, test2BookingId, test2Result.bookingData.slot_id);
        
        // ТЕСТ 5: Раздельные транзакции
        console.log('\n' + '='.repeat(60));
        console.log('ТЕСТ: Раздельные транзакции (Стратегия 1)');
        console.log('='.repeat(60));
        
        const test3Result = await testTransactionCreation();
        const test3BookingId = await testSeparateTransactions(
            test3Result.transactionId,
            test3Result.bookingData,
            test3Result.providerRawData
        );
        
        // Очистка теста 5
        await cleanup(test3Result.transactionId, test3BookingId, test3Result.bookingData.slot_id);
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ ДИАГНОСТИКА ЗАВЕРШЕНА');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('\n' + '='.repeat(60));
        console.error('❌ ОШИБКА В ДИАГНОСТИКЕ');
        console.error('='.repeat(60));
        console.error('Сообщение:', error.message);
        console.error('Stack:', error.stack);
        
        // Проверяем блокировки после ошибки
        await checkDatabaseLocks();
        await checkActiveTransactions();
    } finally {
        // Очистка основного теста
        if (testTransactionId || testBookingId || testSlotId) {
            await cleanup(testTransactionId, testBookingId, testSlotId);
        }
        
        await pool.end();
    }
}

// Запуск
if (require.main === module) {
    runDiagnostics().catch(console.error);
}

module.exports = { runDiagnostics };

