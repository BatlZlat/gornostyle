const { pool } = require('../db');
const { notifyScheduleCreated } = require('../bot/admin-bot');
const moment = require('moment-timezone');

// Настройки для cron
const now = moment().tz('Asia/Yekaterinburg');
const CRON_SETTINGS = {
    day: 1,      // день
    hour: 0,     // часы
    minute: 10   // минуты
};

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

        await client.query('COMMIT');
        console.log('Расписание на следующий месяц успешно создано');

        // Отправляем уведомление через бота
        const monthName = nextMonth.locale('ru').format('MMMM');
        await notifyScheduleCreated(monthName);

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