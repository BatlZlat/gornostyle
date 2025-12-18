#!/usr/bin/env node
/**
 * Очистка статистики тренировок для инструктора Тебякина Данила (ID: 1)
 * 
 * ВНИМАНИЕ: Этот скрипт удаляет записи из таблиц:
 * - kuliga_bookings (бронирования)
 * - kuliga_instructor_payouts (выплаты, если есть)
 * 
 * Использование:
 * node scripts/cleanup-instructor-finances.js [--dry-run] [--date-from YYYY-MM-DD] [--date-to YYYY-MM-DD]
 */

require('dotenv').config();
const { pool } = require('../src/db/index');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';
const INSTRUCTOR_ID = 1; // Тебякин Данила

// Цветной вывод
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Парсинг аргументов
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const dateFromIndex = args.indexOf('--date-from');
const dateToIndex = args.indexOf('--date-to');

let dateFrom = null;
let dateTo = null;

if (dateFromIndex !== -1 && args[dateFromIndex + 1]) {
    dateFrom = args[dateFromIndex + 1];
}

if (dateToIndex !== -1 && args[dateToIndex + 1]) {
    dateTo = args[dateToIndex + 1];
}

async function cleanupInstructorFinances() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        log('🧹 Очистка статистики для инструктора Тебякина Данила (ID: 1)', 'cyan');
        log(`Режим: ${isDryRun ? 'DRY RUN (проверка без удаления)' : 'РЕАЛЬНОЕ УДАЛЕНИЕ'}`, isDryRun ? 'yellow' : 'red');
        
        if (dateFrom || dateTo) {
            log(`Период: ${dateFrom || 'начало'} - ${dateTo || 'конец'}`, 'cyan');
        } else {
            log('Период: ВСЕ ЗАПИСИ', 'cyan');
        }
        
        // 1. Проверяем бронирования
        log('\n1. Проверка бронирований...', 'cyan');
        
        let bookingsQuery = `
            SELECT 
                kb.id,
                kb.booking_type,
                kb.date,
                kb.start_time,
                kb.end_time,
                kb.sport_type,
                kb.participants_count,
                kb.participants_names,
                kb.price_total,
                kb.status,
                c.full_name as client_name,
                COALESCE(kb.instructor_id, kgt.instructor_id) as instructor_id
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            LEFT JOIN clients c ON kb.client_id = c.id
            WHERE COALESCE(kb.instructor_id, kgt.instructor_id) = $1
        `;
        
        const bookingsParams = [INSTRUCTOR_ID];
        
        if (dateFrom) {
            bookingsQuery += ` AND kb.date >= $${bookingsParams.length + 1}::date`;
            bookingsParams.push(dateFrom);
        }
        
        if (dateTo) {
            bookingsQuery += ` AND kb.date <= $${bookingsParams.length + 1}::date`;
            bookingsParams.push(dateTo);
        }
        
        bookingsQuery += ` ORDER BY kb.date DESC, kb.start_time DESC`;
        
        const bookingsResult = await client.query(bookingsQuery, bookingsParams);
        
        log(`   Найдено бронирований: ${bookingsResult.rows.length}`, 'blue');
        
        if (bookingsResult.rows.length > 0) {
            log('\n   Список бронирований:', 'yellow');
            let totalRevenue = 0;
            bookingsResult.rows.forEach((b, index) => {
                const revenue = parseFloat(b.price_total || 0);
                totalRevenue += revenue;
                log(`   ${index + 1}. ID: ${b.id}, Дата: ${b.date}, Время: ${b.start_time}, Тип: ${b.booking_type}, Клиент: ${b.client_name || 'N/A'}, Стоимость: ${revenue.toFixed(2)} ₽, Статус: ${b.status}`, 'yellow');
            });
            log(`   Общая выручка: ${totalRevenue.toFixed(2)} ₽`, 'yellow');
        }
        
        // 2. Проверяем выплаты
        log('\n2. Проверка выплат...', 'cyan');
        
        let payoutsQuery = `
            SELECT 
                id,
                period_start,
                period_end,
                trainings_count,
                total_revenue,
                instructor_earnings,
                admin_commission,
                status
            FROM kuliga_instructor_payouts
            WHERE instructor_id = $1
        `;
        
        const payoutsParams = [INSTRUCTOR_ID];
        
        if (dateFrom) {
            payoutsQuery += ` AND period_start >= $${payoutsParams.length + 1}::date`;
            payoutsParams.push(dateFrom);
        }
        
        if (dateTo) {
            payoutsQuery += ` AND period_end <= $${payoutsParams.length + 1}::date`;
            payoutsParams.push(dateTo);
        }
        
        payoutsQuery += ` ORDER BY period_start DESC`;
        
        let payoutsResult;
        try {
            payoutsResult = await client.query(payoutsQuery, payoutsParams);
            log(`   Найдено выплат: ${payoutsResult.rows.length}`, 'blue');
            
            if (payoutsResult.rows.length > 0) {
                log('\n   Список выплат:', 'yellow');
                payoutsResult.rows.forEach((p, index) => {
                    log(`   ${index + 1}. ID: ${p.id}, Период: ${p.period_start} - ${p.period_end}, Заработок: ${parseFloat(p.instructor_earnings || 0).toFixed(2)} ₽, Статус: ${p.status}`, 'yellow');
                });
            }
        } catch (error) {
            if (error.message.includes('does not exist')) {
                log('   Таблица kuliga_instructor_payouts не существует (это нормально)', 'yellow');
                payoutsResult = { rows: [] };
            } else {
                throw error;
            }
        }
        
        // 3. Удаление (если не dry-run)
        if (!isDryRun) {
            log('\n3. Удаление записей...', 'cyan');
            
            // Удаляем бронирования
            let deleteBookingsQuery = `
                DELETE FROM kuliga_bookings
                WHERE id IN (
                    SELECT kb.id
                    FROM kuliga_bookings kb
                    LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
                    WHERE COALESCE(kb.instructor_id, kgt.instructor_id) = $1
            `;
            
            const deleteBookingsParams = [INSTRUCTOR_ID];
            
            if (dateFrom) {
                deleteBookingsQuery += ` AND kb.date >= $${deleteBookingsParams.length + 1}::date`;
                deleteBookingsParams.push(dateFrom);
            }
            
            if (dateTo) {
                deleteBookingsQuery += ` AND kb.date <= $${deleteBookingsParams.length + 1}::date`;
                deleteBookingsParams.push(dateTo);
            }
            
            deleteBookingsQuery += `)`;
            
            const deleteBookingsResult = await client.query(deleteBookingsQuery, deleteBookingsParams);
            log(`   ✅ Удалено бронирований: ${deleteBookingsResult.rowCount}`, 'green');
            
            // Удаляем выплаты (если таблица существует)
            if (payoutsResult && payoutsResult.rows.length > 0) {
                let deletePayoutsQuery = `
                    DELETE FROM kuliga_instructor_payouts
                    WHERE instructor_id = $1
                `;
                
                const deletePayoutsParams = [INSTRUCTOR_ID];
                
                if (dateFrom) {
                    deletePayoutsQuery += ` AND period_start >= $${deletePayoutsParams.length + 1}::date`;
                    deletePayoutsParams.push(dateFrom);
                }
                
                if (dateTo) {
                    deletePayoutsQuery += ` AND period_end <= $${deletePayoutsParams.length + 1}::date`;
                    deletePayoutsParams.push(dateTo);
                }
                
                try {
                    const deletePayoutsResult = await client.query(deletePayoutsQuery, deletePayoutsParams);
                    log(`   ✅ Удалено выплат: ${deletePayoutsResult.rowCount}`, 'green');
                } catch (error) {
                    if (!error.message.includes('does not exist')) {
                        throw error;
                    }
                }
            }
            
            await client.query('COMMIT');
            log('\n✅ Очистка завершена успешно!', 'green');
        } else {
            await client.query('ROLLBACK');
            log('\n⚠️  DRY RUN: Записи НЕ были удалены. Для реального удаления запустите без --dry-run', 'yellow');
        }
        
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
    cleanupInstructorFinances().catch(process.exit);
}

module.exports = { cleanupInstructorFinances };
