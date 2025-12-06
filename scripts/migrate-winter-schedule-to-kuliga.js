/**
 * Миграция слотов расписания из winter_schedule в kuliga_schedule_slots
 * 
 * Дата создания: 18 ноября 2025
 * Цель: Унификация системы расписания на kuliga_schedule_slots
 * 
 * Что делает скрипт:
 * 1. Находит инструктора Тебякина Данила в kuliga_instructors
 * 2. Переносит все индивидуальные слоты из winter_schedule
 * 3. Конвертирует формат времени (добавляет end_time = start_time + 1 час)
 * 4. Маппит статусы: is_available → 'available' / 'booked'
 * 5. Избегает дублирования (проверяет существующие слоты)
 */

const { pool } = require('../src/db');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';

/**
 * Основная функция миграции
 */
async function migrateWinterScheduleToKuliga() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Начало миграции winter_schedule → kuliga_schedule_slots');
        console.log('=' .repeat(70));
        
        await client.query('BEGIN');
        
        // Шаг 1: Найти инструктора Тебякина Данила
        console.log('\n📍 Шаг 1: Поиск инструктора Тебякина Данила...');
        
        const instructorResult = await client.query(
            `SELECT id, full_name, sport_type, is_active 
             FROM kuliga_instructors 
             WHERE full_name ILIKE '%Тебякин%' 
                OR full_name ILIKE '%Данил%'
                OR full_name ILIKE '%Danil%'
             ORDER BY is_active DESC
             LIMIT 5`
        );
        
        if (instructorResult.rows.length === 0) {
            throw new Error('❌ Инструктор Тебякин Данил не найден в kuliga_instructors. Создайте запись сначала.');
        }
        
        console.log(`\n✅ Найдены инструкторы (${instructorResult.rows.length}):`);
        instructorResult.rows.forEach((inst, i) => {
            console.log(`   ${i + 1}. ${inst.full_name} (ID: ${inst.id}, ${inst.sport_type}, ${inst.is_active ? '✅ Активен' : '❌ Неактивен'})`);
        });
        
        // Выбираем первого активного инструктора
        const instructor = instructorResult.rows[0];
        const instructorId = instructor.id;
        
        console.log(`\n🎯 Выбран инструктор: ${instructor.full_name} (ID: ${instructorId})`);
        
        // Шаг 2: Получить слоты из winter_schedule
        console.log('\n📍 Шаг 2: Получение слотов из winter_schedule...');
        
        const slotsResult = await client.query(
            `SELECT 
                date, 
                time_slot,
                is_available,
                is_individual_training,
                is_group_training,
                trainer_id,
                current_participants,
                max_participants
             FROM winter_schedule
             WHERE date >= CURRENT_DATE
             ORDER BY date, time_slot`
        );
        
        console.log(`📊 Всего слотов в winter_schedule: ${slotsResult.rows.length}`);
        
        // Фильтруем только индивидуальные слоты
        const individualSlots = slotsResult.rows.filter(slot => slot.is_individual_training === true);
        console.log(`📊 Индивидуальных слотов для миграции: ${individualSlots.length}`);
        
        if (individualSlots.length === 0) {
            console.log('\n⚠️  Нет слотов для миграции. winter_schedule пуста или все слоты групповые.');
            await client.query('ROLLBACK');
            return;
        }
        
        // Шаг 3: Миграция слотов
        console.log('\n📍 Шаг 3: Миграция слотов в kuliga_schedule_slots...');
        console.log('-'.repeat(70));
        
        let migratedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        const slotsByDate = {};
        
        for (const slot of individualSlots) {
            const dateKey = slot.date.toISOString().split('T')[0];
            if (!slotsByDate[dateKey]) {
                slotsByDate[dateKey] = [];
            }
            slotsByDate[dateKey].push(slot);
        }
        
        console.log(`📅 Дат для миграции: ${Object.keys(slotsByDate).length}`);
        
        for (const [dateStr, slots] of Object.entries(slotsByDate)) {
            console.log(`\n📅 Дата: ${dateStr} (${slots.length} слотов)`);
            
            for (const slot of slots) {
                try {
                    // Форматируем время
                    const startTime = String(slot.time_slot).substring(0, 8); // HH:MM:SS
                    const endTime = moment.tz(`${dateStr}T${startTime}`, TIMEZONE)
                        .add(1, 'hour')
                        .format('HH:mm:ss');
                    
                    // Определяем статус
                    const status = slot.is_available ? 'available' : 'booked';
                    
                    // Проверяем, существует ли уже такой слот
                    const existingSlot = await client.query(
                        `SELECT id, status FROM kuliga_schedule_slots
                         WHERE instructor_id = $1 AND date = $2 AND start_time = $3`,
                        [instructorId, dateStr, startTime]
                    );
                    
                    if (existingSlot.rows.length > 0) {
                        console.log(`   ⏭️  ${startTime} - уже существует (ID: ${existingSlot.rows[0].id}, статус: ${existingSlot.rows[0].status})`);
                        skippedCount++;
                        continue;
                    }
                    
                    // Создаем слот в kuliga_schedule_slots
                    const insertResult = await client.query(
                        `INSERT INTO kuliga_schedule_slots (
                            instructor_id, date, start_time, end_time, status
                        ) VALUES ($1, $2, $3, $4, $5)
                        RETURNING id`,
                        [instructorId, dateStr, startTime, endTime, status]
                    );
                    
                    const newSlotId = insertResult.rows[0].id;
                    console.log(`   ✅ ${startTime} - ${endTime} → ${status} (ID: ${newSlotId})`);
                    migratedCount++;
                    
                } catch (error) {
                    console.error(`   ❌ Ошибка миграции слота ${slot.time_slot}:`, error.message);
                    errorCount++;
                }
            }
        }
        
        // Шаг 4: Подтверждение миграции
        console.log('\n' + '='.repeat(70));
        console.log('📊 ИТОГИ МИГРАЦИИ:');
        console.log('='.repeat(70));
        console.log(`✅ Перенесено слотов:        ${migratedCount}`);
        console.log(`⏭️  Пропущено (уже есть):    ${skippedCount}`);
        console.log(`❌ Ошибок:                   ${errorCount}`);
        console.log(`📊 Всего обработано:         ${migratedCount + skippedCount + errorCount}`);
        console.log('='.repeat(70));
        
        // Показать статистику по датам
        console.log('\n📊 Статистика по датам в kuliga_schedule_slots:');
        const statsResult = await client.query(
            `SELECT 
                date::text as date,
                COUNT(*) as total_slots,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) as booked,
                SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
                SUM(CASE WHEN status = 'group' THEN 1 ELSE 0 END) as group_slots
             FROM kuliga_schedule_slots
             WHERE instructor_id = $1
               AND date >= CURRENT_DATE
             GROUP BY date
             ORDER BY date
             LIMIT 10`,
            [instructorId]
        );
        
        if (statsResult.rows.length > 0) {
            console.log('\n┌────────────┬───────┬───────────┬────────┬──────────┬────────┐');
            console.log('│    Дата    │ Всего │ Свободно  │ Занято │ Блокиров │ Группа │');
            console.log('├────────────┼───────┼───────────┼────────┼──────────┼────────┤');
            statsResult.rows.forEach(row => {
                console.log(
                    `│ ${row.date.padEnd(10)} │ ${String(row.total_slots).padStart(5)} │ ` +
                    `${String(row.available).padStart(9)} │ ${String(row.booked).padStart(6)} │ ` +
                    `${String(row.blocked).padStart(8)} │ ${String(row.group_slots).padStart(6)} │`
                );
            });
            console.log('└────────────┴───────┴───────────┴────────┴──────────┴────────┘');
        }
        
        await client.query('COMMIT');
        
        console.log('\n✅ Миграция успешно завершена!');
        console.log('\n💡 Следующие шаги:');
        console.log('   1. Проверьте данные в kuliga_schedule_slots');
        console.log('   2. Протестируйте личный кабинет инструктора (trainer_winter.html)');
        console.log('   3. Переходите к Этапу 2: Обновление бота клиентов');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('\n💥 ОШИБКА МИГРАЦИИ:', error);
        console.error('\n❌ Транзакция откачена. Данные не изменены.');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Функция для проверки текущего состояния
 */
async function checkCurrentState() {
    const client = await pool.connect();
    
    try {
        console.log('\n🔍 Проверка текущего состояния базы данных...\n');
        
        // Проверка winter_schedule
        const winterResult = await client.query(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_individual_training THEN 1 ELSE 0 END) as individual,
                SUM(CASE WHEN is_group_training THEN 1 ELSE 0 END) as group_training,
                MIN(date) as earliest_date,
                MAX(date) as latest_date
             FROM winter_schedule
             WHERE date >= CURRENT_DATE`
        );
        
        console.log('📊 winter_schedule:');
        if (winterResult.rows[0].total > 0) {
            const ws = winterResult.rows[0];
            console.log(`   Всего слотов: ${ws.total}`);
            console.log(`   Индивидуальных: ${ws.individual}`);
            console.log(`   Групповых: ${ws.group_training}`);
            console.log(`   Диапазон дат: ${ws.earliest_date?.toISOString().split('T')[0]} - ${ws.latest_date?.toISOString().split('T')[0]}`);
        } else {
            console.log('   ⚠️  Нет слотов (или все в прошлом)');
        }
        
        // Проверка kuliga_schedule_slots
        const kuligaResult = await client.query(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) as booked,
                SUM(CASE WHEN status = 'group' THEN 1 ELSE 0 END) as group_slots,
                MIN(date) as earliest_date,
                MAX(date) as latest_date
             FROM kuliga_schedule_slots
             WHERE date >= CURRENT_DATE`
        );
        
        console.log('\n📊 kuliga_schedule_slots:');
        if (kuligaResult.rows[0].total > 0) {
            const ks = kuligaResult.rows[0];
            console.log(`   Всего слотов: ${ks.total}`);
            console.log(`   Свободно: ${ks.available}`);
            console.log(`   Занято: ${ks.booked}`);
            console.log(`   Групповых: ${ks.group_slots}`);
            console.log(`   Диапазон дат: ${ks.earliest_date?.toISOString().split('T')[0]} - ${ks.latest_date?.toISOString().split('T')[0]}`);
        } else {
            console.log('   ⚠️  Нет слотов');
        }
        
        // Проверка инструкторов
        const instructorsResult = await client.query(
            `SELECT id, full_name, sport_type, is_active 
             FROM kuliga_instructors 
             WHERE is_active = true`
        );
        
        console.log('\n📊 kuliga_instructors (активные):');
        if (instructorsResult.rows.length > 0) {
            instructorsResult.rows.forEach(inst => {
                console.log(`   • ${inst.full_name} (ID: ${inst.id}, ${inst.sport_type})`);
            });
        } else {
            console.log('   ⚠️  Нет активных инструкторов');
        }
        
        console.log('\n' + '='.repeat(70));
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Запуск скрипта
if (require.main === module) {
    // Проверка текущего состояния (опционально)
    const args = process.argv.slice(2);
    if (args.includes('--check') || args.includes('-c')) {
        checkCurrentState()
            .then(() => process.exit(0))
            .catch(error => {
                console.error('Ошибка проверки:', error);
                process.exit(1);
            });
    } else {
        // Основная миграция
        migrateWinterScheduleToKuliga()
            .then(() => {
                console.log('\n🎉 Миграция успешно завершена!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Миграция провалилась:', error);
                process.exit(1);
            });
    }
}

module.exports = { migrateWinterScheduleToKuliga, checkCurrentState };
