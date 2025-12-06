/**
 * Скрипт для ручной генерации тренировок из программы
 * Использование: node scripts/generate-program-trainings.js <program_id>
 */

require('dotenv').config();
const { pool } = require('../src/db');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';

async function generateProgramTrainings(programId) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Получаем информацию о программе
        const programResult = await client.query(
            `SELECT * FROM kuliga_programs WHERE id = $1 AND is_active = TRUE`,
            [programId]
        );
        
        if (programResult.rows.length === 0) {
            throw new Error(`Программа ID=${programId} не найдена или неактивна`);
        }
        
        const program = programResult.rows[0];
        console.log(`📋 Программа: "${program.name}"`);
        console.log(`   Место: ${program.location}`);
        console.log(`   Дни недели: ${JSON.stringify(program.weekdays)}`);
        console.log(`   Временные слоты: ${JSON.stringify(program.time_slots)}`);
        
        // Подготавливаем параметры
        const weekdays = Array.isArray(program.weekdays) ? program.weekdays.map(Number) : [];
        const timeSlots = Array.isArray(program.time_slots) ? program.time_slots : [];
        
        if (weekdays.length === 0 || timeSlots.length === 0) {
            console.log(`⚠️ Программа ID=${programId} не имеет дней недели или временных слотов`);
            await client.query('COMMIT');
            return { created: 0, skipped: 0 };
        }
        
        // Цена в программе уже указана за человека, не нужно делить на количество участников
        const pricePerPerson = Number(program.price);
        console.log(`   Цена за человека: ${pricePerPerson.toFixed(2)} руб.`);
        
        // Генерируем тренировки на 14 дней вперед
        const now = moment().tz(TIMEZONE);
        const endDate = now.clone().add(14, 'days').endOf('day');
        
        console.log(`\n📅 Генерация тренировок с ${now.format('YYYY-MM-DD')} по ${endDate.format('YYYY-MM-DD')}`);
        
        let created = 0;
        let skipped = 0;
        
        // Проходим по каждому дню в диапазоне
        const cursor = now.clone().startOf('day');
        while (cursor.isSameOrBefore(endDate, 'day')) {
            const weekday = cursor.day(); // 0=Sunday, 1=Monday, ..., 6=Saturday
            
            // Проверяем, входит ли этот день недели в расписание программы
            if (weekdays.includes(weekday)) {
                // Создаем тренировки для каждого временного слота в этот день
                for (const timeSlot of timeSlots) {
                    // Обрабатываем разные форматы времени: "10:00:00" или "10:00"
                    const timeParts = timeSlot.split(':');
                    const hours = timeParts[0] || '00';
                    const minutes = timeParts[1] || '00';
                    
                    const startMoment = cursor.clone().hour(Number(hours)).minute(Number(minutes)).second(0);
                    const endMoment = startMoment.clone().add(program.training_duration, 'minutes');
                    
                    // Пропускаем прошедшие слоты
                    if (startMoment.isSameOrBefore(now)) {
                        console.log(`⏭️  Пропущен прошедший слот: ${startMoment.format('YYYY-MM-DD HH:mm')}`);
                        skipped++;
                        continue;
                    }
                    
                    const dateStr = startMoment.format('YYYY-MM-DD');
                    const startTimeStr = startMoment.format('HH:mm:ss');
                    const endTimeStr = endMoment.format('HH:mm:ss');
                    
                    // Проверяем, существует ли уже тренировка для этой программы в это время
                    const existingCheck = await client.query(
                        `SELECT id FROM kuliga_group_trainings
                         WHERE program_id = $1 
                           AND date = $2 
                           AND start_time = $3
                           AND status IN ('open', 'confirmed')`,
                        [programId, dateStr, startTimeStr]
                    );
                    
                    if (existingCheck.rows.length > 0) {
                        console.log(`⏭️  Тренировка уже существует: ${dateStr} ${startTimeStr}`);
                        skipped++;
                        continue;
                    }
                    
                    // Создаем тренировку БЕЗ назначенного инструктора (instructor_id = NULL)
                    // Администратор назначит инструктора позже
                    await client.query(
                        `INSERT INTO kuliga_group_trainings (
                            program_id,
                            instructor_id,
                            slot_id,
                            date,
                            start_time,
                            end_time,
                            sport_type,
                            level,
                            description,
                            price_per_person,
                            min_participants,
                            max_participants,
                            current_participants,
                            status,
                            is_private,
                            location
                        ) VALUES ($1, NULL, NULL, $2, $3, $4, $5, 'beginner', $6, $7, 2, $8, 0, 'open', FALSE, $9)`,
                        [
                            programId,
                            dateStr,
                            startTimeStr,
                            endTimeStr,
                            program.sport_type,
                            program.description || `Программа "${program.name}"`,
                            pricePerPerson,
                            program.max_participants,
                            program.location || 'kuliga'
                        ]
                    );
                    
                    console.log(`✅ Создана тренировка: ${dateStr} ${startTimeStr} - ${endTimeStr}`);
                    created++;
                }
            }
            
            cursor.add(1, 'day');
        }
        
        await client.query('COMMIT');
        
        console.log(`\n✅ Для программы ID=${programId} создано ${created} тренировок, пропущено ${skipped}`);
        
        return { created, skipped };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Ошибка генерации тренировок для программы ID=${programId}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

// Запуск скрипта
const programId = parseInt(process.argv[2], 10);

if (!programId || isNaN(programId)) {
    console.error('❌ Укажите ID программы: node scripts/generate-program-trainings.js <program_id>');
    process.exit(1);
}

(async () => {
    try {
        await generateProgramTrainings(programId);
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        await pool.end();
        process.exit(1);
    }
})();

