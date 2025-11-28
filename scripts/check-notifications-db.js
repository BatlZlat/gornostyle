#!/usr/bin/env node

/**
 * Скрипт для диагностики проблемы с уведомлениями инструкторам
 * Проверяет состояние базы данных после миграции 038
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

async function checkDatabase() {
    console.log('🔍 Начинаем диагностику базы данных...\n');
    
    try {
        // 1. Проверяем инструкторов
        console.log('1️⃣ Проверка инструкторов:');
        const instructorsResult = await pool.query(`
            SELECT 
                id, 
                full_name, 
                telegram_id, 
                location,
                is_active,
                CASE 
                    WHEN telegram_id IS NULL THEN '❌ Нет Telegram ID'
                    WHEN location IS NULL THEN '⚠️ Нет location'
                    ELSE '✅ OK'
                END as status
            FROM kuliga_instructors
            ORDER BY id
        `);
        
        console.log(`   Найдено инструкторов: ${instructorsResult.rows.length}`);
        instructorsResult.rows.forEach(instructor => {
            console.log(`   - ${instructor.full_name} (ID: ${instructor.id}):`);
            console.log(`     Telegram ID: ${instructor.telegram_id || 'НЕ УКАЗАН ❌'}`);
            console.log(`     Location: ${instructor.location || 'НЕ УКАЗАН ⚠️'}`);
            console.log(`     Активен: ${instructor.is_active ? 'Да' : 'Нет'}`);
        });
        
        // 2. Проверяем бронирования за последние 2 дня
        console.log('\n2️⃣ Проверка бронирований за последние 2 дня:');
        const bookingsResult = await pool.query(`
            SELECT 
                kb.id,
                kb.date,
                kb.start_time,
                kb.booking_type,
                kb.status,
                kb.location,
                COALESCE(ki_direct.full_name, ki_group.full_name) as instructor_name,
                COALESCE(ki_direct.telegram_id, ki_group.telegram_id) as instructor_telegram_id,
                COALESCE(ki_direct.location, ki_group.location) as instructor_location,
                kb.created_at,
                CASE 
                    WHEN kb.location IS NULL THEN '⚠️ Нет location'
                    WHEN COALESCE(ki_direct.telegram_id, ki_group.telegram_id) IS NULL THEN '❌ У инструктора нет Telegram ID'
                    ELSE '✅ OK'
                END as notification_status
            FROM kuliga_bookings kb
            -- JOIN для индивидуальных бронирований (через instructor_id)
            LEFT JOIN kuliga_instructors ki_direct ON kb.instructor_id = ki_direct.id AND kb.booking_type = 'individual'
            -- JOIN для групповых бронирований (через group_training_id -> kuliga_group_trainings -> instructor_id)
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id AND kb.booking_type = 'group'
            LEFT JOIN kuliga_instructors ki_group ON kgt.instructor_id = ki_group.id AND kb.booking_type = 'group'
            WHERE kb.date >= CURRENT_DATE - INTERVAL '2 days'
            ORDER BY kb.created_at DESC
            LIMIT 20
        `);
        
        console.log(`   Найдено бронирований: ${bookingsResult.rows.length}`);
        bookingsResult.rows.forEach(booking => {
            console.log(`   - Бронирование ID: ${booking.id} (${booking.date} ${booking.start_time})`);
            console.log(`     Тип: ${booking.booking_type}, Статус: ${booking.status}`);
            console.log(`     Инструктор: ${booking.instructor_name || 'Не указан'}`);
            console.log(`     Location бронирования: ${booking.location || 'НЕ УКАЗАН ⚠️'}`);
            console.log(`     Location инструктора: ${booking.instructor_location || 'НЕ УКАЗАН ⚠️'}`);
            console.log(`     Telegram ID инструктора: ${booking.instructor_telegram_id || 'НЕ УКАЗАН ❌'}`);
            console.log(`     Статус уведомления: ${booking.notification_status}`);
        });
        
        // 3. Проверяем слоты
        console.log('\n3️⃣ Проверка слотов за последние 2 дня:');
        const slotsResult = await pool.query(`
            SELECT 
                COUNT(*) as total_slots,
                COUNT(CASE WHEN location IS NULL THEN 1 END) as slots_without_location,
                COUNT(CASE WHEN status = 'booked' THEN 1 END) as booked_slots,
                COUNT(CASE WHEN status = 'group' THEN 1 END) as group_slots
            FROM kuliga_schedule_slots
            WHERE date >= CURRENT_DATE - INTERVAL '2 days'
        `);
        
        const slots = slotsResult.rows[0];
        console.log(`   Всего слотов: ${slots.total_slots}`);
        console.log(`   Слотов без location: ${slots.slots_without_location}`);
        console.log(`   Занятых слотов: ${slots.booked_slots}`);
        console.log(`   Групповых слотов: ${slots.group_slots}`);
        
        // 4. Проверяем групповые тренировки
        console.log('\n4️⃣ Проверка групповых тренировок за последние 2 дня:');
        const groupTrainingsResult = await pool.query(`
            SELECT 
                kgt.id,
                kgt.date,
                kgt.location,
                ki.full_name as instructor_name,
                ki.telegram_id as instructor_telegram_id,
                kgt.status
            FROM kuliga_group_trainings kgt
            LEFT JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
            WHERE kgt.date >= CURRENT_DATE - INTERVAL '2 days'
            ORDER BY kgt.date DESC, kgt.created_at DESC
            LIMIT 10
        `);
        
        console.log(`   Найдено групповых тренировок: ${groupTrainingsResult.rows.length}`);
        groupTrainingsResult.rows.forEach(gt => {
            console.log(`   - Групповая тренировка ID: ${gt.id} (${gt.date})`);
            console.log(`     Инструктор: ${gt.instructor_name || 'Не указан'}`);
            console.log(`     Location: ${gt.location || 'НЕ УКАЗАН ⚠️'}`);
            console.log(`     Telegram ID инструктора: ${gt.instructor_telegram_id || 'НЕ УКАЗАН ❌'}`);
        });
        
        // 5. Проверка групповых тренировок с инструкторами без telegram_id
        console.log('\n5️⃣ Проверка групповых тренировок с инструкторами без Telegram ID:');
        const groupTrainingsWithoutTelegram = await pool.query(`
            SELECT 
                kgt.id,
                kgt.date,
                kgt.start_time,
                ki.full_name as instructor_name,
                ki.id as instructor_id,
                ki.telegram_id,
                COUNT(kb.id) as bookings_count
            FROM kuliga_group_trainings kgt
            JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
            LEFT JOIN kuliga_bookings kb ON kgt.id = kb.group_training_id 
                AND kb.status IN ('pending', 'confirmed')
            WHERE kgt.date >= CURRENT_DATE - INTERVAL '2 days'
              AND ki.telegram_id IS NULL
            GROUP BY kgt.id, kgt.date, kgt.start_time, ki.full_name, ki.id, ki.telegram_id
            ORDER BY kgt.date DESC
        `);
        
        if (groupTrainingsWithoutTelegram.rows.length > 0) {
            console.log(`   ⚠️ Найдено ${groupTrainingsWithoutTelegram.rows.length} групповых тренировок с инструкторами без Telegram ID:`);
            groupTrainingsWithoutTelegram.rows.forEach(gt => {
                console.log(`   - Тренировка ID: ${gt.id} (${gt.date} ${gt.start_time})`);
                console.log(`     Инструктор: ${gt.instructor_name} (ID: ${gt.instructor_id})`);
                console.log(`     Активных бронирований: ${gt.bookings_count}`);
            });
        } else {
            console.log(`   ✅ Все групповые тренировки имеют инструкторов с Telegram ID`);
        }
        
        // 6. Сводка проблем
        console.log('\n📊 СВОДКА ПРОБЛЕМ:');
        const problemsResult = await pool.query(`
            SELECT 
                'Инструкторы без Telegram ID' as problem_type,
                COUNT(*) as count
            FROM kuliga_instructors
            WHERE telegram_id IS NULL AND is_active = true
            
            UNION ALL
            
            SELECT 
                'Инструкторы без location' as problem_type,
                COUNT(*) as count
            FROM kuliga_instructors
            WHERE location IS NULL
            
            UNION ALL
            
            SELECT 
                'Бронирования без location' as problem_type,
                COUNT(*) as count
            FROM kuliga_bookings
            WHERE location IS NULL AND date >= CURRENT_DATE - INTERVAL '2 days'
            
            UNION ALL
            
            SELECT 
                'Слоты без location' as problem_type,
                COUNT(*) as count
            FROM kuliga_schedule_slots
            WHERE location IS NULL AND date >= CURRENT_DATE - INTERVAL '2 days'
        `);
        
        const hasProblems = problemsResult.rows.some(p => p.count > 0);
        if (hasProblems) {
            problemsResult.rows.forEach(problem => {
                if (problem.count > 0) {
                    console.log(`   ⚠️ ${problem.problem_type}: ${problem.count}`);
                }
            });
        } else {
            console.log(`   ✅ Критических проблем не обнаружено`);
        }
        
        console.log('\n✅ Диагностика завершена');
        
    } catch (error) {
        console.error('❌ Ошибка при диагностике:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    checkDatabase().catch(err => {
        console.error('Критическая ошибка:', err);
        process.exit(1);
    });
}

module.exports = { checkDatabase };

