const { pool } = require('../db');

async function createInitialSchedule() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Получаем текущую дату и дату конца следующего месяца
        const now = new Date();
        const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0); // Последний день следующего месяца
        endDate.setHours(23, 59, 59, 999); // Устанавливаем конец дня

        // Начальное и конечное время для слотов
        const startTime = '10:00';
        const endTime = '21:00';
        const slotDuration = 30; // длительность слота в минутах

        // Создаем слоты для каждого дня
        for (let date = new Date(now); date <= endDate; date.setDate(date.getDate() + 1)) {
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
        console.log('Расписание успешно создано');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании расписания:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Запускаем создание расписания
createInitialSchedule().catch(console.error); 