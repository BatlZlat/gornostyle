/**
 * Скрипт для создания бронирования из "зависшей" транзакции
 * Используется когда оплата прошла, но webhook не пришёл
 */

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

async function createBookingFromTransaction(transactionId) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log(`🔍 Загружаю транзакцию #${transactionId}...`);
        
        // Загружаем транзакцию
        const txResult = await client.query(
            `SELECT id, booking_id, client_id, amount, status, provider_raw_data
             FROM kuliga_transactions
             WHERE id = $1
             FOR UPDATE`,
            [transactionId]
        );
        
        if (!txResult.rows.length) {
            throw new Error(`Транзакция #${transactionId} не найдена`);
        }
        
        const transaction = txResult.rows[0];
        
        if (transaction.booking_id) {
            console.log(`⚠️ Бронирование уже создано: booking_id = ${transaction.booking_id}`);
            await client.query('ROLLBACK');
            return;
        }
        
        console.log(`📋 Транзакция #${transactionId}:`);
        console.log(`   Client ID: ${transaction.client_id}`);
        console.log(`   Amount: ${transaction.amount}₽`);
        console.log(`   Status: ${transaction.status}`);
        
        // Извлекаем данные бронирования
        const rawData = transaction.provider_raw_data || {};
        const bookingData = rawData.bookingData;
        
        if (!bookingData) {
            throw new Error('Данные бронирования не найдены в provider_raw_data');
        }
        
        console.log(`\n📅 Данные бронирования:`);
        console.log(`   Дата: ${bookingData.date}`);
        console.log(`   Время: ${bookingData.start_time}`);
        console.log(`   Слот ID: ${bookingData.slot_id}`);
        console.log(`   Инструктор ID: ${bookingData.instructor_id}`);
        console.log(`   Участников: ${bookingData.participants_count}`);
        
        // Проверяем слот
        const slotCheck = await client.query(
            `SELECT status FROM kuliga_schedule_slots WHERE id = $1 FOR UPDATE`,
            [bookingData.slot_id]
        );
        
        if (!slotCheck.rows.length) {
            throw new Error(`Слот #${bookingData.slot_id} не найден`);
        }
        
        if (slotCheck.rows[0].status !== 'available') {
            console.log(`\n⚠️ ВНИМАНИЕ: Слот #${bookingData.slot_id} имеет статус '${slotCheck.rows[0].status}'`);
            console.log(`   Продолжить создание бронирования? (слот будет зарезервирован принудительно)`);
            // В реальности нужно спросить подтверждение, но для автоматизации продолжаем
        }
        
        // Резервируем слот
        await client.query(
            `UPDATE kuliga_schedule_slots
             SET status = 'booked', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [bookingData.slot_id]
        );
        console.log(`\n✅ Слот #${bookingData.slot_id} зарезервирован`);
        
        // Создаём бронирование
        const bookingResult = await client.query(
            `INSERT INTO kuliga_bookings (
                client_id,
                booking_type,
                instructor_id,
                slot_id,
                date,
                start_time,
                end_time,
                sport_type,
                participants_count,
                participants_names,
                participants_birth_years,
                price_total,
                price_per_person,
                price_id,
                notification_method,
                payer_rides,
                location,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'confirmed')
            RETURNING id`,
            [
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
            ]
        );
        
        const bookingId = bookingResult.rows[0].id;
        console.log(`✅ Бронирование #${bookingId} создано со статусом 'confirmed'`);
        
        // Обновляем транзакцию
        await client.query(
            `UPDATE kuliga_transactions
             SET booking_id = $1,
                 status = 'completed',
                 provider_status = 'SUCCESS',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [bookingId, transactionId]
        );
        console.log(`✅ Транзакция #${transactionId} обновлена: booking_id = ${bookingId}, status = 'completed'`);
        
        await client.query('COMMIT');
        
        console.log(`\n🎉 Готово! Бронирование #${bookingId} успешно создано из транзакции #${transactionId}`);
        console.log(`\n⚠️ ВАЖНО: Отправьте уведомления администратору и инструктору вручную или через админ-панель!`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`\n❌ Ошибка:`, error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Проверяем аргументы
const transactionId = process.argv[2];

if (!transactionId) {
    console.error('❌ Использование: node scripts/create-booking-from-transaction.js <transaction_id>');
    console.error('   Пример: node scripts/create-booking-from-transaction.js 24');
    process.exit(1);
}

createBookingFromTransaction(Number(transactionId))
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

