/**
 * Скрипт для проверки данных аналитики
 */

require('dotenv').config();
const { pool } = require('../src/db');
const moment = require('moment-timezone');

const TIMEZONE = 'Europe/Moscow';

async function checkAnalyticsData() {
    console.log('\n=== ПРОВЕРКА ДАННЫХ ДЛЯ АНАЛИТИКИ ===\n');
    
    try {
        // 1. Проверяем таблицы
        console.log('1️⃣ Проверка наличия таблиц...');
        const tablesQuery = `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('training_sessions', 'kuliga_bookings', 'kuliga_group_trainings', 'referral_transactions')
            ORDER BY table_name
        `;
        const tablesResult = await pool.query(tablesQuery);
        console.log('Найденные таблицы:', tablesResult.rows.map(r => r.table_name).join(', '));
        
        // 2. Проверяем данные в training_sessions
        console.log('\n2️⃣ Проверка training_sessions...');
        const tsQuery = `
            SELECT 
                status,
                COUNT(*) as count,
                MIN(session_date) as first_date,
                MAX(session_date) as last_date
            FROM training_sessions
            GROUP BY status
            ORDER BY status
        `;
        const tsResult = await pool.query(tsQuery);
        console.log('training_sessions по статусам:');
        tsResult.rows.forEach(row => {
            console.log(`  ${row.status}: ${row.count} записей (${row.first_date} - ${row.last_date})`);
        });
        
        // 3. Проверяем данные в kuliga_bookings
        console.log('\n3️⃣ Проверка kuliga_bookings...');
        const kbQuery = `
            SELECT 
                status,
                booking_type,
                COUNT(*) as count,
                MIN(date) as first_date,
                MAX(date) as last_date
            FROM kuliga_bookings
            GROUP BY status, booking_type
            ORDER BY status, booking_type
        `;
        const kbResult = await pool.query(kbQuery);
        console.log('kuliga_bookings по статусам и типам:');
        kbResult.rows.forEach(row => {
            console.log(`  ${row.status} (${row.booking_type}): ${row.count} записей (${row.first_date} - ${row.last_date})`);
        });
        
        // 4. Проверяем данные в referral_transactions
        console.log('\n4️⃣ Проверка referral_transactions...');
        const rtQuery = `
            SELECT 
                status,
                COUNT(*) as count,
                MIN(created_at) as first_date,
                MAX(created_at) as last_date
            FROM referral_transactions
            GROUP BY status
            ORDER BY status
        `;
        const rtResult = await pool.query(rtQuery);
        if (rtResult.rows.length > 0) {
            console.log('referral_transactions по статусам:');
            rtResult.rows.forEach(row => {
                console.log(`  ${row.status}: ${row.count} записей (${row.first_date} - ${row.last_date})`);
            });
        } else {
            console.log('referral_transactions: таблица пуста');
        }
        
        // 5. Тестируем запрос посещаемости для текущего месяца
        console.log('\n5️⃣ Тестирование запроса посещаемости (текущий месяц)...');
        const startOfMonth = moment().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
        const endOfMonth = moment().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
        console.log(`Период: ${startOfMonth} - ${endOfMonth}`);
        
        const attendanceQuery = `
            SELECT 
                DATE(session_date) as date,
                COUNT(DISTINCT CASE WHEN booking_type = 'group' THEN group_training_id ELSE id END) as trainings_count,
                COUNT(DISTINCT client_id) as unique_clients,
                COUNT(DISTINCT CASE WHEN child_id IS NOT NULL THEN child_id END) as children_count
            FROM (
                -- Тренировки на тренажере
                SELECT 
                    ts.session_date,
                    ts.id,
                    NULL as group_training_id,
                    'individual' as booking_type,
                    ts.client_id,
                    ts.child_id
                FROM training_sessions ts
                WHERE ts.status = 'completed'
                AND ts.session_date >= $1 AND ts.session_date <= $2
                
                UNION ALL
                
                -- Групповые тренировки на тренажере
                SELECT 
                    ts.session_date,
                    NULL as id,
                    ts.id as group_training_id,
                    'group' as booking_type,
                    tsp.client_id,
                    tsp.child_id
                FROM training_sessions ts
                JOIN training_session_participants tsp ON ts.id = tsp.training_session_id
                WHERE ts.status = 'completed'
                AND ts.session_date >= $1 AND ts.session_date <= $2
                
                UNION ALL
                
                -- Индивидуальные зимние тренировки (Кулига)
                SELECT 
                    kb.date as session_date,
                    kb.id,
                    NULL as group_training_id,
                    'individual' as booking_type,
                    kb.client_id,
                    kb.child_id
                FROM kuliga_bookings kb
                WHERE kb.status = 'completed'
                AND kb.date >= $1 AND kb.date <= $2
                
                UNION ALL
                
                -- Групповые зимние тренировки (Кулига)
                SELECT 
                    kb.date as session_date,
                    NULL as id,
                    kb.group_training_id,
                    'group' as booking_type,
                    kb.client_id,
                    kb.child_id
                FROM kuliga_bookings kb
                WHERE kb.status = 'completed'
                  AND kb.group_training_id IS NOT NULL
                AND kb.date >= $1 AND kb.date <= $2
            ) all_trainings
            GROUP BY DATE(session_date)
            ORDER BY date ASC
        `;
        
        const attendanceResult = await pool.query(attendanceQuery, [startOfMonth, endOfMonth]);
        console.log(`Найдено дней с тренировками: ${attendanceResult.rows.length}`);
        if (attendanceResult.rows.length > 0) {
            console.log('Первые 5 дней:');
            attendanceResult.rows.slice(0, 5).forEach(row => {
                console.log(`  ${row.date}: ${row.trainings_count} тренировок, ${row.unique_clients} клиентов, ${row.children_count} детей`);
            });
        } else {
            console.log('❌ Нет данных за текущий месяц');
        }
        
        // 6. Тестируем запрос для всего времени
        console.log('\n6️⃣ Тестирование запроса посещаемости (все время)...');
        const attendanceAllTimeQuery = `
            SELECT 
                COUNT(DISTINCT CASE WHEN booking_type = 'group' THEN group_training_id ELSE id END) as total_trainings,
                COUNT(DISTINCT client_id) as total_unique_clients,
                COUNT(DISTINCT CASE WHEN child_id IS NOT NULL THEN child_id END) as total_children
            FROM (
                SELECT 
                    ts.id,
                    NULL as group_training_id,
                    'individual' as booking_type,
                    ts.client_id,
                    ts.child_id
                FROM training_sessions ts
                WHERE ts.status = 'completed'
                
                UNION ALL
                
                SELECT 
                    NULL as id,
                    ts.id as group_training_id,
                    'group' as booking_type,
                    tsp.client_id,
                    tsp.child_id
                FROM training_sessions ts
                JOIN training_session_participants tsp ON ts.id = tsp.training_session_id
                WHERE ts.status = 'completed'
                
                UNION ALL
                
                SELECT 
                    kb.id,
                    NULL as group_training_id,
                    'individual' as booking_type,
                    kb.client_id,
                    kb.child_id
                FROM kuliga_bookings kb
                WHERE kb.status = 'completed'
                
                UNION ALL
                
                SELECT 
                    NULL as id,
                    kb.group_training_id,
                    'group' as booking_type,
                    kb.client_id,
                    kb.child_id
                FROM kuliga_bookings kb
                WHERE kb.status = 'completed'
                  AND kb.group_training_id IS NOT NULL
            ) all_trainings
        `;
        
        const allTimeResult = await pool.query(attendanceAllTimeQuery);
        console.log('Всего данных:');
        console.log(`  Тренировок: ${allTimeResult.rows[0].total_trainings}`);
        console.log(`  Уникальных клиентов: ${allTimeResult.rows[0].total_unique_clients}`);
        console.log(`  Детей: ${allTimeResult.rows[0].total_children}`);
        
        // 7. Проверяем тренеров
        console.log('\n7️⃣ Проверка тренеров тренажера...');
        const trainersQuery = `
            SELECT 
                t.id,
                t.full_name,
                COUNT(DISTINCT ts.id) as total_trainings
            FROM trainers t
            LEFT JOIN training_sessions ts ON t.id = ts.trainer_id AND ts.status = 'completed'
            GROUP BY t.id, t.full_name
            ORDER BY total_trainings DESC
            LIMIT 5
        `;
        const trainersResult = await pool.query(trainersQuery);
        console.log(`Тренеры (топ 5):`);
        trainersResult.rows.forEach(row => {
            console.log(`  ${row.full_name}: ${row.total_trainings} тренировок`);
        });
        
        // 8. Проверяем инструкторов Кулиги
        console.log('\n8️⃣ Проверка инструкторов Кулиги...');
        const instructorsQuery = `
            SELECT 
                ki.id,
                ki.full_name,
                ki.location,
                COUNT(DISTINCT kb.id) as total_bookings
            FROM kuliga_instructors ki
            LEFT JOIN kuliga_bookings kb ON kb.instructor_id = ki.id AND kb.status = 'completed'
            GROUP BY ki.id, ki.full_name, ki.location
            ORDER BY total_bookings DESC
            LIMIT 5
        `;
        const instructorsResult = await pool.query(instructorsQuery);
        console.log(`Инструкторы Кулиги (топ 5):`);
        instructorsResult.rows.forEach(row => {
            const locationName = row.location === 'vorona' ? 'Воронинские горки' : 'Кулига';
            console.log(`  ${row.full_name} (${locationName}): ${row.total_bookings} бронирований`);
        });
        
        console.log('\n✅ Проверка завершена!');
        console.log('\n💡 ВЫВОДЫ:');
        console.log('Аналитика работает с таблицами:');
        console.log('  - training_sessions (тренировки на тренажере) - статус должен быть "completed"');
        console.log('  - kuliga_bookings (бронирования Кулиги) - статус должен быть "completed"');
        console.log('  - kuliga_group_trainings (групповые тренировки Кулиги)');
        console.log('  - referral_transactions (реферальная программа)');
        console.log('\nЕсли данных нет - убедитесь что:');
        console.log('  1. Есть тренировки со статусом "completed"');
        console.log('  2. Период фильтра захватывает даты тренировок');
        console.log('  3. В браузере открыта консоль для просмотра логов');
        
    } catch (error) {
        console.error('❌ Ошибка при проверке данных:', error);
    } finally {
        await pool.end();
    }
}

checkAnalyticsData();

