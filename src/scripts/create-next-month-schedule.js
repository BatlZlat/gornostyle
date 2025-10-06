const { pool } = require('../db');
const { notifyScheduleCreated, notifyRecurringTrainingConflict, notifyRecurringTrainingsCreated } = require('../bot/admin-notify');
const moment = require('moment-timezone');

// Настройки для cron
const now = moment().tz('Asia/Yekaterinburg');
const CRON_SETTINGS = {
    day: 1,      // день
    hour: 0,     // часы
    minute: 10   // минуты
};

/**
 * Получить все даты в диапазоне для конкретного дня недели
 * @param {moment} startDate - начальная дата
 * @param {moment} endDate - конечная дата
 * @param {number} dayOfWeek - день недели (0=ВС, 1=ПН, ..., 6=СБ)
 * @returns {Array} массив дат
 */
function getDatesForDayOfWeek(startDate, endDate, dayOfWeek) {
    const dates = [];
    let current = startDate.clone();
    
    // Находим первое вхождение нужного дня недели
    while (current.day() !== dayOfWeek && current.isSameOrBefore(endDate)) {
        current.add(1, 'days');
    }
    
    // Собираем все даты с этим днем недели
    while (current.isSameOrBefore(endDate)) {
        dates.push(current.clone());
        current.add(7, 'days');
    }
    
    return dates;
}

/**
 * Получить цену для групповой тренировки
 * @param {object} client - клиент БД
 * @param {boolean} withTrainer - с тренером или без
 * @param {number} maxParticipants - максимальное количество участников
 * @returns {number} цена
 */
async function getGroupTrainingPrice(client, withTrainer, maxParticipants) {
    try {
        const result = await client.query(
            `SELECT price FROM prices 
             WHERE type = 'group' 
             AND with_trainer = $1 
             AND participants = $2 
             AND duration = 60
             LIMIT 1`,
            [withTrainer, maxParticipants]
        );
        
        return result.rows.length > 0 ? parseFloat(result.rows[0].price) : 0;
    } catch (error) {
        console.error('Ошибка при получении цены:', error);
        return 0;
    }
}

/**
 * Создать тренировки из шаблонов постоянного расписания
 * @param {object} client - клиент БД
 * @param {moment} startDate - начальная дата
 * @param {moment} endDate - конечная дата
 * @returns {object} результаты создания
 */
async function createTrainingsFromTemplates(client, startDate, endDate) {
    let successCount = 0;
    let conflictCount = 0;
    const conflicts = [];

    try {
        // 1. Загружаем все активные шаблоны
        const templatesResult = await client.query(
            `SELECT t.*, 
                    g.name as group_name, 
                    tr.full_name as trainer_name,
                    s.name as simulator_name
             FROM recurring_training_templates t
             LEFT JOIN groups g ON t.group_id = g.id
             LEFT JOIN trainers tr ON t.trainer_id = tr.id
             LEFT JOIN simulators s ON t.simulator_id = s.id
             WHERE t.is_active = TRUE
             ORDER BY t.day_of_week, t.start_time`
        );

        const templates = templatesResult.rows;
        console.log(`Найдено активных шаблонов: ${templates.length}`);

        // 2. Для каждого шаблона создаем тренировки
        for (const template of templates) {
            console.log(`\nОбработка шаблона: ${template.name} (${template.day_of_week}, ${template.start_time})`);
            
            // Получаем все даты для этого дня недели в месяце
            const dates = getDatesForDayOfWeek(startDate, endDate, template.day_of_week);
            console.log(`Найдено дат: ${dates.length}`);
            
            // Вычисляем end_time (start_time + 60 минут)
            const startTimeMoment = moment(template.start_time, 'HH:mm:ss');
            const endTimeMoment = startTimeMoment.clone().add(60, 'minutes');
            const endTime = endTimeMoment.format('HH:mm:ss');
            
            // Получаем цену
            const price = await getGroupTrainingPrice(
                client, 
                template.trainer_id !== null, 
                template.max_participants
            );
            
            // Для каждой даты создаем тренировку
            for (const date of dates) {
                const dateStr = date.format('YYYY-MM-DD');
                
                try {
                    // Проверяем, не занят ли этот слот
                    const conflictCheck = await client.query(
                        `SELECT ts.id, ts.start_time, ts.end_time, g.name as group_name
                         FROM training_sessions ts
                         LEFT JOIN groups g ON ts.group_id = g.id
                         WHERE ts.simulator_id = $1 
                         AND ts.session_date = $2 
                         AND ts.start_time < $3 
                         AND ts.end_time > $4
                         AND ts.status != 'cancelled'`,
                        [template.simulator_id, dateStr, endTime, template.start_time]
                    );
                    
                    if (conflictCheck.rows.length > 0) {
                        // Конфликт! Пропускаем и логируем
                        const existingTraining = conflictCheck.rows[0];
                        const conflictInfo = {
                            template_name: template.name,
                            date: dateStr,
                            time: template.start_time,
                            simulator: template.simulator_name,
                            conflict_with: existingTraining.group_name || 'Другая тренировка'
                        };
                        conflicts.push(conflictInfo);
                        conflictCount++;
                        console.log(`⚠️ Конфликт: ${dateStr} ${template.start_time} - слот занят`);
                        continue;
                    }
                    
                    // Создаем тренировку
                    await client.query(
                        `INSERT INTO training_sessions (
                            simulator_id, trainer_id, group_id, session_date, 
                            start_time, end_time, duration,
                            training_type, max_participants, skill_level, 
                            price, equipment_type, template_id, with_trainer, status
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                        [
                            template.simulator_id,
                            template.trainer_id,
                            template.group_id,
                            dateStr,
                            template.start_time,
                            endTime,
                            60, // длительность
                            true, // training_type = группо вая
                            template.max_participants,
                            template.skill_level || 1,
                            price,
                            template.equipment_type,
                            template.id, // template_id
                            template.trainer_id !== null, // with_trainer
                            'scheduled'
                        ]
                    );
                    
                    successCount++;
                    console.log(`✅ Создана тренировка: ${dateStr} ${template.start_time}`);
                    
                } catch (error) {
                    console.error(`Ошибка при создании тренировки для ${dateStr}:`, error.message);
                    conflicts.push({
                        template_name: template.name,
                        date: dateStr,
                        time: template.start_time,
                        simulator: template.simulator_name,
                        error: error.message
                    });
                    conflictCount++;
                }
            }
        }
        
    } catch (error) {
        console.error('Ошибка при создании тренировок из шаблонов:', error);
        throw error;
    }
    
    return { successCount, conflictCount, conflicts };
}

async function createNextMonthSchedule() {
    console.log('\n=== Проверка времени запуска ===');
    const now = moment().tz('Asia/Yekaterinburg');
    console.log('Текущее время:', now.format('YYYY-MM-DD HH:mm:ss'));
    console.log('Ожидаемое время запуска:', `${CRON_SETTINGS.day}-е число, ${CRON_SETTINGS.hour}:${CRON_SETTINGS.minute}`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Устанавливаем часовой пояс Екатеринбурга
        const timezone = 'Asia/Yekaterinburg';
        
        // Получаем первый день следующего месяца
        const nextMonth = now.clone().add(1, 'months').startOf('month');
        // Получаем последний день следующего месяца
        const lastDayOfNextMonth = now.clone().add(1, 'months').endOf('month');

        console.log('Создание расписания с', nextMonth.format('YYYY-MM-DD'), 'по', lastDayOfNextMonth.format('YYYY-MM-DD'));

        // Начальное и конечное время для слотов
        const startTime = '10:00';
        const endTime = '21:00';
        const slotDuration = 30; // длительность слота в минутах

        // Создаем слоты для каждого дня следующего месяца
        for (let date = nextMonth.clone(); date <= lastDayOfNextMonth; date.add(1, 'days')) {
            const dateStr = date.format('YYYY-MM-DD');
            
            // Создаем слоты для каждого тренажера
            for (let simulatorId = 1; simulatorId <= 2; simulatorId++) {
                // Создаем слоты с шагом в 30 минут
                let currentTime = moment(startTime, 'HH:mm');
                const endTimeDate = moment(endTime, 'HH:mm');

                while (currentTime.isBefore(endTimeDate)) {
                    const slotStart = currentTime.format('HH:mm');
                    currentTime.add(slotDuration, 'minutes');
                    const slotEnd = currentTime.format('HH:mm');

                    await client.query(
                        `INSERT INTO schedule (simulator_id, date, start_time, end_time)
                         VALUES ($1, $2, $3, $4)`,
                        [simulatorId, dateStr, slotStart, slotEnd]
                    );
                }
            }
        }

        // После создания слотов создаем тренировки из шаблонов
        console.log('\n=== Создание тренировок из шаблонов постоянного расписания ===');
        const { successCount, conflictCount, conflicts } = await createTrainingsFromTemplates(
            client, 
            nextMonth, 
            lastDayOfNextMonth
        );
        
        console.log(`Создано тренировок: ${successCount}`);
        console.log(`Конфликтов: ${conflictCount}`);

        await client.query('COMMIT');
        console.log('Расписание на следующий месяц успешно создано');

        // Отправляем уведомления через бота
        const monthName = nextMonth.locale('ru').format('MMMM');
        await notifyScheduleCreated(monthName);
        
        // Уведомляем о созданных тренировках из шаблонов
        if (successCount > 0) {
            await notifyRecurringTrainingsCreated(monthName, successCount);
        }
        
        // Уведомляем о конфликтах
        if (conflictCount > 0) {
            await notifyRecurringTrainingConflict(conflicts);
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании расписания на следующий месяц:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Убираем автоматический запуск при импорте
// if (require.main === module) {
//     createNextMonthSchedule().catch(console.error);
// }

module.exports = { createNextMonthSchedule, CRON_SETTINGS }; 