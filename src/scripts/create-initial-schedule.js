const { pool } = require('../db');
const moment = require('moment-timezone');

async function createInitialSchedule() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Получаем текущую дату в часовом поясе Екатеринбурга
        const now = moment().tz('Asia/Yekaterinburg');
        const startDate = now.startOf('day');
        
        // Получаем последний день следующего месяца
        const endDate = moment().tz('Asia/Yekaterinburg')
            .add(1, 'month')
            .endOf('month')
            .endOf('day');

        // Начальное и конечное время для слотов
        const startTime = '10:00';
        const endTime = '21:00';
        const slotDuration = 30; // длительность слота в минутах

        console.log(`Создание расписания с ${startDate.format('YYYY-MM-DD')} по ${endDate.format('YYYY-MM-DD')}`);

        // Создаем слоты для каждого дня
        let currentDate = moment(startDate);
        while (currentDate.isSameOrBefore(endDate)) {
            const dateStr = currentDate.format('YYYY-MM-DD');
            console.log(`Создание слотов для даты: ${dateStr}`);
            
            // Создаем слоты для каждого тренажера
            for (let simulatorId = 1; simulatorId <= 2; simulatorId++) {
                // Создаем слоты с шагом в 30 минут
                let currentTime = moment(`2000-01-01 ${startTime}`, 'YYYY-MM-DD HH:mm');
                const endTimeMoment = moment(`2000-01-01 ${endTime}`, 'YYYY-MM-DD HH:mm');

                while (currentTime.isBefore(endTimeMoment)) {
                    const slotStart = currentTime.format('HH:mm');
                    currentTime.add(slotDuration, 'minutes');
                    const slotEnd = currentTime.format('HH:mm');

                    try {
                        await client.query(
                            `INSERT INTO schedule (simulator_id, date, start_time, end_time, is_holiday, is_booked)
                             VALUES ($1, $2, $3, $4, false, false)`,
                            [simulatorId, dateStr, slotStart, slotEnd]
                        );
                        console.log(`Создан слот: ${dateStr} ${slotStart}-${slotEnd} для тренажера ${simulatorId}`);
                    } catch (error) {
                        if (error.code === '23505') { // Ошибка уникального ограничения
                            console.log(`Слот уже существует: ${dateStr} ${slotStart}-${slotEnd} для тренажера ${simulatorId}`);
                            continue;
                        }
                        throw error;
                    }
                }
            }
            
            // Переходим к следующему дню
            currentDate.add(1, 'day');
        }

        await client.query('COMMIT');
        console.log('Расписание успешно создано');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании расписания:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Запускаем создание расписания
createInitialSchedule().catch(console.error); 