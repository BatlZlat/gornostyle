/**
 * Сервис для автоматической генерации тренировок из программ
 * Проверяет все активные программы и создает недостающие тренировки на 14 дней вперед
 */

const { pool } = require('../db');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';

/**
 * Генерирует тренировки для всех активных программ
 * Проверяет каждую программу и создает недостающие тренировки на 14 дней вперед
 */
async function generateTrainingsForAllPrograms() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Получаем все активные программы
        const programsResult = await client.query(
            `SELECT * FROM kuliga_programs WHERE is_active = TRUE`
        );
        
        if (programsResult.rows.length === 0) {
            console.log('[Program Generator] Нет активных программ для генерации тренировок');
            await client.query('COMMIT');
            return {
                programsProcessed: 0,
                totalCreated: 0,
                totalSkipped: 0,
                errors: []
            };
        }
        
        const programs = programsResult.rows;
        const now = moment().tz(TIMEZONE);
        const endDate = now.clone().add(14, 'days').endOf('day');
        
        let totalCreated = 0;
        let totalSkipped = 0;
        const errors = [];
        
        // Обрабатываем каждую программу
        for (const program of programs) {
            try {
                const weekdays = Array.isArray(program.weekdays) ? program.weekdays.map(Number) : [];
                const timeSlots = Array.isArray(program.time_slots) ? program.time_slots : [];
                
                if (weekdays.length === 0 || timeSlots.length === 0) {
                    console.log(`[Program Generator] Программа ID=${program.id} "${program.name}" не имеет дней недели или временных слотов, пропускаем`);
                    continue;
                }
                
                // Цена в программе уже указана за человека, не нужно делить на количество участников
                const pricePerPerson = Number(program.price);
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
                            const [hours = '00', minutes = '00'] = timeSlot.split(':');
                            const startMoment = cursor.clone().hour(Number(hours)).minute(Number(minutes)).second(0);
                            const endMoment = startMoment.clone().add(program.training_duration, 'minutes');
                            
                            // Пропускаем прошедшие слоты
                            if (startMoment.isSameOrBefore(now)) {
                                skipped++;
                                continue;
                            }
                            
                            const dateStr = startMoment.format('YYYY-MM-DD');
                            const startTimeStr = startMoment.format('HH:mm:ss');
                            const endTimeStr = endMoment.format('HH:mm:ss');
                            
                            // Проверяем, существует ли уже тренировка для этой программы в это время
                            const existingCheck = await client.query(
                                `SELECT id, price_per_person FROM kuliga_group_trainings
                                 WHERE program_id = $1 
                                   AND date = $2 
                                   AND start_time = $3
                                   AND status IN ('open', 'confirmed')`,
                                [program.id, dateStr, startTimeStr]
                            );
                            
                            if (existingCheck.rows.length > 0) {
                                // Если тренировка существует, обновляем цену, если она изменилась в программе
                                const existingTraining = existingCheck.rows[0];
                                if (Number(existingTraining.price_per_person) !== pricePerPerson) {
                                    await client.query(
                                        `UPDATE kuliga_group_trainings
                                         SET price_per_person = $1, updated_at = CURRENT_TIMESTAMP
                                         WHERE id = $2`,
                                        [pricePerPerson, existingTraining.id]
                                    );
                                    console.log(`[Program Generator] Обновлена цена для тренировки ID=${existingTraining.id}: ${existingTraining.price_per_person} → ${pricePerPerson}`);
                                }
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
                                    program.id,
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
                            
                            created++;
                        }
                    }
                    
                    cursor.add(1, 'day');
                }
                
                totalCreated += created;
                totalSkipped += skipped;
                
                if (created > 0) {
                    console.log(`[Program Generator] Программа ID=${program.id} "${program.name}": создано ${created} тренировок, пропущено ${skipped}`);
                }
                
            } catch (error) {
                console.error(`[Program Generator] Ошибка при обработке программы ID=${program.id} "${program.name}":`, error);
                errors.push({
                    program_id: program.id,
                    program_name: program.name,
                    error: error.message
                });
            }
        }
        
        await client.query('COMMIT');
        
        console.log(`[Program Generator] Обработано программ: ${programs.length}, создано тренировок: ${totalCreated}, пропущено: ${totalSkipped}, ошибок: ${errors.length}`);
        
        return {
            programsProcessed: programs.length,
            totalCreated,
            totalSkipped,
            errors
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Program Generator] Критическая ошибка при генерации тренировок:', error);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    generateTrainingsForAllPrograms
};

