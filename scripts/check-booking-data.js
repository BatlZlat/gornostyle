#!/usr/bin/env node
/**
 * Диагностический скрипт для проверки bookingData в транзакциях
 * Использование: node scripts/check-booking-data.js [transactionId]
 */

require('dotenv').config();
const { pool } = require('../src/db');

async function checkTransaction(transactionId) {
    try {
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`  Проверка транзакции #${transactionId}`);
        console.log('═══════════════════════════════════════════════════════════\n');

        const result = await pool.query(
            `SELECT 
                id, 
                client_id, 
                booking_id, 
                status, 
                provider_raw_data,
                provider_status,
                created_at,
                updated_at
             FROM kuliga_transactions 
             WHERE id = $1`,
            [transactionId]
        );

        if (result.rows.length === 0) {
            console.log(`❌ Транзакция #${transactionId} не найдена`);
            return;
        }

        const tx = result.rows[0];
        console.log(`📋 Основная информация:`);
        console.log(`   - ID: ${tx.id}`);
        console.log(`   - client_id: ${tx.client_id}`);
        console.log(`   - booking_id: ${tx.booking_id || 'NULL'}`);
        console.log(`   - status: ${tx.status}`);
        console.log(`   - provider_status: ${tx.provider_status || 'NULL'}`);
        console.log(`   - created_at: ${tx.created_at}`);
        console.log(`   - updated_at: ${tx.updated_at}`);
        console.log('');

        // Проверяем provider_raw_data
        console.log(`📦 provider_raw_data:`);
        console.log(`   - Тип: ${typeof tx.provider_raw_data}`);
        console.log(`   - Значение: ${tx.provider_raw_data ? 'есть' : 'NULL'}`);
        
        if (tx.provider_raw_data) {
            let rawData = {};
            try {
                if (typeof tx.provider_raw_data === 'string') {
                    rawData = JSON.parse(tx.provider_raw_data);
                } else {
                    rawData = tx.provider_raw_data;
                }
                
                console.log(`   - Ключи: ${Object.keys(rawData).join(', ')}`);
                console.log('');
                
                if (rawData.bookingData) {
                    console.log(`✅ bookingData найден:`);
                    console.log(`   - client_id: ${rawData.bookingData.client_id || 'ОТСУТСТВУЕТ'}`);
                    console.log(`   - client_email: ${rawData.bookingData.client_email || 'ОТСУТСТВУЕТ'}`);
                    console.log(`   - client_name: ${rawData.bookingData.client_name || 'ОТСУТСТВУЕТ'}`);
                    console.log(`   - booking_type: ${rawData.bookingData.booking_type || 'ОТСУТСТВУЕТ'}`);
                    console.log(`   - date: ${rawData.bookingData.date || 'ОТСУТСТВУЕТ'}`);
                    console.log(`   - start_time: ${rawData.bookingData.start_time || 'ОТСУТСТВУЕТ'}`);
                } else {
                    console.log(`❌ bookingData отсутствует!`);
                    console.log(`   Содержимое provider_raw_data:`);
                    console.log(JSON.stringify(rawData, null, 2).substring(0, 1000));
                }
            } catch (parseError) {
                console.error(`❌ Ошибка парсинга provider_raw_data:`, parseError.message);
                console.log(`   Сырые данные (первые 500 символов):`, 
                    typeof tx.provider_raw_data === 'string' 
                        ? tx.provider_raw_data.substring(0, 500)
                        : JSON.stringify(tx.provider_raw_data).substring(0, 500));
            }
        } else {
            console.log(`❌ provider_raw_data пустой!`);
        }

        // Проверяем клиента
        if (tx.client_id) {
            console.log('');
            console.log(`👤 Информация о клиенте (client_id=${tx.client_id}):`);
            const clientResult = await pool.query(
                `SELECT id, full_name, phone, email, telegram_id, telegram_username 
                 FROM clients 
                 WHERE id = $1`,
                [tx.client_id]
            );
            
            if (clientResult.rows.length > 0) {
                const client = clientResult.rows[0];
                console.log(`   - full_name: ${client.full_name || 'ОТСУТСТВУЕТ'}`);
                console.log(`   - phone: ${client.phone || 'ОТСУТСТВУЕТ'}`);
                console.log(`   - email: ${client.email || 'ОТСУТСТВУЕТ'}`);
                console.log(`   - telegram_id: ${client.telegram_id || 'ОТСУТСТВУЕТ'}`);
                console.log(`   - telegram_username: ${client.telegram_username || 'ОТСУТСТВУЕТ'}`);
            } else {
                console.log(`   ❌ Клиент не найден в БД!`);
            }
        }

        // Проверяем бронирование
        if (tx.booking_id) {
            console.log('');
            console.log(`📅 Информация о бронировании (booking_id=${tx.booking_id}):`);
            const bookingResult = await pool.query(
                `SELECT id, client_id, booking_type, date, start_time, status 
                 FROM kuliga_bookings 
                 WHERE id = $1`,
                [tx.booking_id]
            );
            
            if (bookingResult.rows.length > 0) {
                const booking = bookingResult.rows[0];
                console.log(`   - client_id: ${booking.client_id}`);
                console.log(`   - booking_type: ${booking.booking_type}`);
                console.log(`   - date: ${booking.date}`);
                console.log(`   - start_time: ${booking.start_time}`);
                console.log(`   - status: ${booking.status}`);
            } else {
                console.log(`   ❌ Бронирование не найдено в БД!`);
            }
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');

    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

async function listRecentTransactions() {
    try {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  Последние 10 транзакций');
        console.log('═══════════════════════════════════════════════════════════\n');

        const result = await pool.query(
            `SELECT 
                id, 
                client_id, 
                booking_id, 
                status, 
                provider_status,
                created_at
             FROM kuliga_transactions 
             ORDER BY id DESC 
             LIMIT 10`
        );

        if (result.rows.length === 0) {
            console.log('Транзакции не найдены');
            return;
        }

        console.log('ID\t| client_id\t| booking_id\t| status\t\t| provider_status');
        console.log('─'.repeat(80));
        for (const row of result.rows) {
            console.log(`${row.id}\t| ${row.client_id || 'NULL'}\t| ${row.booking_id || 'NULL'}\t| ${row.status}\t| ${row.provider_status || 'NULL'}`);
        }

        console.log('');
        console.log('Используйте: node scripts/check-booking-data.js <transactionId> для детальной проверки');

    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

// Главная функция
async function main() {
    const transactionId = process.argv[2];
    
    if (transactionId) {
        await checkTransaction(parseInt(transactionId));
    } else {
        await listRecentTransactions();
    }
}

main().catch(console.error);

