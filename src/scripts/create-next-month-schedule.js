const { pool } = require('../db');

// Настройки для cron
const CRON_SETTINGS = {
    day: 1, // День месяца
    hour: 0, // Час
    minute: 10 // Минута
};

async function createNextMonthSchedule() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Получаем первый и последний день следующего месяца
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const lastDayOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

        // Начальное и конечное время для слотов
        const startTime = '10:00';
        const endTime = '21:00';
        const slotDuration = 30; // длительность слота в минутах

        // Создаем слоты для каждого дня следующего месяца
        for (let date = new Date(nextMonth); date <= lastDayOfNextMonth; date.setDate(date.getDate() + 1)) {
            const dateStr = date.toISOString().split('T')[0];
            
            // Создаем слоты для каждого тренажера
            for (let simulatorId = 1; simulatorId <= 2; simulatorId++) {
                // Создаем слоты с шагом в 30 минут
                let currentTime = new Date(`2000-01-01T${startTime}`);
                const endTimeDate = new Date(`2000-01-01T${endTime}`);

                while (currentTime < endTimeDate) {
                    const slotStart = currentTime.toTimeString().slice(0, 5);
                    currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
                    const slotEnd = currentTime.toTimeString().slice(0, 5);

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
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании расписания на следующий месяц:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Если скрипт запущен напрямую, а не через cron
if (require.main === module) {
    createNextMonthSchedule().catch(console.error);
}

module.exports = { createNextMonthSchedule, CRON_SETTINGS }; 