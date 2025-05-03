const { Pool } = require('pg');

const pool = new Pool({
    host: '90.156.210.24',
    port: 5432,
    database: 'skisimulator',
    user: 'batl-zlat',
    password: 'Nemezida2324%)'
});

async function createInitialSchedule() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Создаем тренажеры, если их еще нет
        const simulators = [
            { name: 'Тренажер 1' },
            { name: 'Тренажер 2' }
        ];

        for (const simulator of simulators) {
            try {
                await client.query(
                    'INSERT INTO simulators (name) VALUES ($1) ON CONFLICT DO NOTHING',
                    [simulator.name]
                );
            } catch (error) {
                console.error('Ошибка при создании тренажера:', error);
                throw error;
            }
        }

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
            // Пропускаем воскресенье (0) и субботу (6)
            if (date.getDay() === 0 || date.getDay() === 6) {
                continue;
            }

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

                    try {
                        await client.query(
                            `INSERT INTO schedule (simulator_id, date, start_time, end_time)
                             VALUES ($1, $2, $3, $4)`,
                            [simulatorId, dateStr, slotStart, slotEnd]
                        );
                    } catch (error) {
                        if (error.code === '23505') { // Ошибка уникального ограничения
                            console.log(`Слот уже существует: ${dateStr} ${slotStart}-${slotEnd} для тренажера ${simulatorId}`);
                            continue;
                        }
                        throw error;
                    }
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
        await pool.end();
    }
}

// Запускаем создание расписания
createInitialSchedule().catch(console.error); 