const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { verifyKuligaInstructorToken } = require('../middleware/kuligaInstructorAuth');

// Применяем middleware авторизации ко всем роутам
router.use(verifyKuligaInstructorToken);

/**
 * GET /api/kuliga/instructor/slots
 * Получение слотов инструктора
 * Query params: date (опционально), start_date, end_date (для диапазона)
 */
router.get('/slots', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { date, start_date, end_date } = req.query;

    try {
        let query;
        let params;

        if (date) {
            // Получить слоты на конкретную дату
            query = `
                SELECT id, instructor_id, date, start_time, end_time, status, created_at, updated_at
                FROM kuliga_schedule_slots
                WHERE instructor_id = $1 AND date = $2
                ORDER BY start_time ASC
            `;
            params = [instructorId, date];
        } else if (start_date && end_date) {
            // Получить слоты в диапазоне дат
            query = `
                SELECT id, instructor_id, date, start_time, end_time, status, created_at, updated_at
                FROM kuliga_schedule_slots
                WHERE instructor_id = $1 AND date BETWEEN $2 AND $3
                ORDER BY date ASC, start_time ASC
            `;
            params = [instructorId, start_date, end_date];
        } else {
            return res.status(400).json({ error: 'Необходимо указать date или start_date+end_date' });
        }

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении слотов:', error);
        res.status(500).json({ error: 'Ошибка при получении слотов' });
    }
});

/**
 * Вспомогательная функция для проверки минимального времени (10:15)
 */
function isValidMinTime(time) {
    const [hours, minutes] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    const minMinutes = 10 * 60 + 15; // 10:15
    return totalMinutes >= minMinutes;
}

/**
 * Вспомогательная функция для вычисления разницы между временами в минутах
 */
function getTimeDifferenceInMinutes(time1, time2) {
    const [h1, m1] = time1.split(':').map(Number);
    const [h2, m2] = time2.split(':').map(Number);
    const minutes1 = h1 * 60 + m1;
    const minutes2 = h2 * 60 + m2;
    return Math.abs(minutes2 - minutes1);
}

/**
 * Вспомогательная функция для проверки минимального интервала между слотами (1.5 часа = 90 минут)
 * Учитывает, что слот длится 1 час: если слот начинается в 10:00 (заканчивается в 11:00),
 * следующий должен начинаться не раньше 11:30 (10:00 + 1 час тренировки + 30 минут перерыва)
 */
function checkMinimumInterval(times) {
    // Сортируем времена
    const sortedTimes = [...times].sort();
    
    for (let i = 0; i < sortedTimes.length - 1; i++) {
        const [h1, m1] = sortedTimes[i].split(':').map(Number);
        const [h2, m2] = sortedTimes[i + 1].split(':').map(Number);
        
        // Время начала первого слота в минутах
        const start1 = h1 * 60 + m1;
        // Время окончания первого слота (длится 1 час) в минутах
        const end1 = start1 + 60;
        // Время начала второго слота в минутах
        const start2 = h2 * 60 + m2;
        
        // Разница между окончанием первого и началом второго (перерыв)
        const breakTime = start2 - end1;
        
        // Минимальный перерыв должен быть 30 минут (1.5 часа интервал - 1 час тренировки = 30 минут)
        if (breakTime < 30) {
            return {
                valid: false,
                error: `Минимальный интервал между слотами - 1.5 часа. Между ${sortedTimes[i]} и ${sortedTimes[i + 1]} недостаточно времени (нужно минимум 30 минут перерыва после окончания предыдущей тренировки).`
            };
        }
    }
    
    return { valid: true };
}

/**
 * POST /api/kuliga/instructor/slots/create
 * Создание слотов на определенную дату
 * Body: { date, times: [] }
 */
router.post('/slots/create', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { date, times } = req.body;

    if (!date || !Array.isArray(times) || times.length === 0) {
        return res.status(400).json({ error: 'Необходимо указать date и times' });
    }

    // Валидация формата времени и минимального времени (10:15)
    const validTimes = [];
    for (const time of times) {
        // Проверяем формат времени (HH:MM)
        if (!/^\d{2}:\d{2}$/.test(time)) {
            continue;
        }

        // Проверяем, что время не раньше 10:15
        if (!isValidMinTime(time)) {
            return res.status(400).json({ 
                error: `Время ${time} недопустимо. База открывается в 10:00, первая тренировка может начаться не раньше 10:15.` 
            });
        }

        validTimes.push(time);
    }

    if (validTimes.length === 0) {
        return res.status(400).json({ error: 'Не найдено ни одного валидного времени' });
    }

    // Проверяем минимальный интервал между слотами (1.5 часа)
    const intervalCheck = checkMinimumInterval(validTimes);
    if (!intervalCheck.valid) {
        return res.status(400).json({ error: intervalCheck.error });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Получаем существующие слоты на эту дату для проверки интервалов
        const existingSlotsResult = await client.query(
            `SELECT start_time FROM kuliga_schedule_slots 
             WHERE instructor_id = $1 AND date = $2 
             ORDER BY start_time ASC`,
            [instructorId, date]
        );
        const existingTimes = existingSlotsResult.rows.map(row => row.start_time);

        // Проверяем интервалы с существующими слотами
        const allTimes = [...existingTimes, ...validTimes];
        const allTimesCheck = checkMinimumInterval(allTimes);
        if (!allTimesCheck.valid) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: `Временные слоты пересекаются с существующими. ${allTimesCheck.error}` 
            });
        }

        let created = 0;

        for (const time of validTimes) {
            // Проверяем, существует ли уже такой слот
            const existingSlot = await client.query(
                `SELECT id FROM kuliga_schedule_slots 
                 WHERE instructor_id = $1 AND date = $2 AND start_time = $3`,
                [instructorId, date, time]
            );

            if (existingSlot.rows.length > 0) {
                // Слот уже существует, пропускаем
                continue;
            }

            // Вычисляем время окончания (слот длится 1 час)
            const [hours, minutes] = time.split(':').map(Number);
            const endHours = (hours + 1) % 24;
            const endTime = `${String(endHours).padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

            // Создаем новый слот
            await client.query(
                `INSERT INTO kuliga_schedule_slots 
                 (instructor_id, date, start_time, end_time, status)
                 VALUES ($1, $2, $3, $4, 'available')`,
                [instructorId, date, time, endTime]
            );

            created++;
        }

        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            created,
            message: `Создано слотов: ${created}`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании слотов:', error);
        res.status(500).json({ error: 'Ошибка при создании слотов' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/kuliga/instructor/slots/create-bulk
 * Массовое создание слотов
 * Body: { fromDate, toDate, weekdays: [], times: [] }
 */
router.post('/slots/create-bulk', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { fromDate, toDate, weekdays, times } = req.body;

    if (!fromDate || !toDate || !Array.isArray(weekdays) || !Array.isArray(times)) {
        return res.status(400).json({ error: 'Необходимо указать все параметры' });
    }

    if (weekdays.length === 0 || times.length === 0) {
        return res.status(400).json({ error: 'Необходимо выбрать хотя бы один день недели и время' });
    }

    // Валидация времен: формат и минимальное время (10:15)
    const validTimes = [];
    for (const time of times) {
        if (!/^\d{2}:\d{2}$/.test(time)) {
            continue;
        }
        if (!isValidMinTime(time)) {
            return res.status(400).json({ 
                error: `Время ${time} недопустимо. База открывается в 10:00, первая тренировка может начаться не раньше 10:15.` 
            });
        }
        validTimes.push(time);
    }

    if (validTimes.length === 0) {
        return res.status(400).json({ error: 'Не найдено ни одного валидного времени' });
    }

    // Проверяем минимальный интервал между слотами (1.5 часа)
    const intervalCheck = checkMinimumInterval(validTimes);
    if (!intervalCheck.valid) {
        return res.status(400).json({ error: intervalCheck.error });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        let created = 0;
        const startDate = new Date(fromDate);
        const endDate = new Date(toDate);

        // Проходим по всем датам в диапазоне
        for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
            const dayOfWeek = date.getDay(); // 0 = ВС, 1 = ПН, ..., 6 = СБ

            // Проверяем, входит ли этот день недели в выбранные
            if (!weekdays.includes(dayOfWeek)) {
                continue;
            }

            const dateStr = date.toISOString().split('T')[0];

            // Получаем существующие слоты на эту дату для проверки интервалов
            const existingSlotsResult = await client.query(
                `SELECT start_time FROM kuliga_schedule_slots 
                 WHERE instructor_id = $1 AND date = $2 
                 ORDER BY start_time ASC`,
                [instructorId, dateStr]
            );
            const existingTimes = existingSlotsResult.rows.map(row => row.start_time);

            // Проверяем интервалы с существующими слотами
            const allTimes = [...existingTimes, ...validTimes];
            const allTimesCheck = checkMinimumInterval(allTimes);
            if (!allTimesCheck.valid) {
                // Для массового создания просто пропускаем эту дату, не прерываем весь процесс
                continue;
            }

            // Создаем слоты для всех указанных времен
            for (const time of validTimes) {
                // Проверяем, существует ли уже такой слот
                const existingSlot = await client.query(
                    `SELECT id FROM kuliga_schedule_slots 
                     WHERE instructor_id = $1 AND date = $2 AND start_time = $3`,
                    [instructorId, dateStr, time]
                );

                if (existingSlot.rows.length > 0) {
                    // Слот уже существует, пропускаем
                    continue;
                }

                // Вычисляем время окончания (слот длится 1 час)
                const [hours, minutes] = time.split(':').map(Number);
                const endHours = (hours + 1) % 24;
                const endTime = `${String(endHours).padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

                // Создаем новый слот
                await client.query(
                    `INSERT INTO kuliga_schedule_slots 
                     (instructor_id, date, start_time, end_time, status)
                     VALUES ($1, $2, $3, $4, 'available')`,
                    [instructorId, dateStr, time, endTime]
                );

                created++;
            }
        }

        await client.query('COMMIT');
        
        res.json({ 
            success: true, 
            created,
            message: `Создано слотов: ${created}`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при массовом создании слотов:', error);
        res.status(500).json({ error: 'Ошибка при массовом создании слотов' });
    } finally {
        client.release();
    }
});

/**
 * PATCH /api/kuliga/instructor/slots/:id
 * Изменение статуса слота
 * Body: { status }
 */
router.patch('/slots/:id', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const slotId = req.params.id;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ error: 'Необходимо указать status' });
    }

    // Разрешаем изменять только между available и blocked
    if (!['available', 'blocked'].includes(status)) {
        return res.status(400).json({ error: 'Недопустимый статус. Разрешены: available, blocked' });
    }

    try {
        // Проверяем, что слот принадлежит инструктору
        const checkResult = await pool.query(
            'SELECT id, status FROM kuliga_schedule_slots WHERE id = $1 AND instructor_id = $2',
            [slotId, instructorId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Слот не найден' });
        }

        const currentStatus = checkResult.rows[0].status;

        // Нельзя изменять забронированные слоты
        if (currentStatus === 'booked') {
            return res.status(400).json({ error: 'Нельзя изменить статус забронированного слота' });
        }

        // Обновляем статус
        await pool.query(
            'UPDATE kuliga_schedule_slots SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, slotId]
        );

        res.json({ 
            success: true, 
            message: 'Статус слота обновлен'
        });
    } catch (error) {
        console.error('Ошибка при изменении статуса слота:', error);
        res.status(500).json({ error: 'Ошибка при изменении статуса слота' });
    }
});

/**
 * DELETE /api/kuliga/instructor/slots/:id
 * Удаление слота
 */
router.delete('/slots/:id', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const slotId = req.params.id;

    try {
        // Проверяем, что слот принадлежит инструктору
        const checkResult = await pool.query(
            'SELECT id, status FROM kuliga_schedule_slots WHERE id = $1 AND instructor_id = $2',
            [slotId, instructorId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Слот не найден' });
        }

        const status = checkResult.rows[0].status;

        // Нельзя удалять забронированные слоты
        if (status === 'booked') {
            return res.status(400).json({ error: 'Нельзя удалить забронированный слот' });
        }

        // Удаляем слот
        await pool.query(
            'DELETE FROM kuliga_schedule_slots WHERE id = $1',
            [slotId]
        );

        res.json({ 
            success: true, 
            message: 'Слот успешно удален'
        });
    } catch (error) {
        console.error('Ошибка при удалении слота:', error);
        res.status(500).json({ error: 'Ошибка при удалении слота' });
    }
});

/**
 * GET /api/kuliga/instructor/bot-info
 * Получение информации о Telegram боте для инструктора
 */
router.get('/bot-info', async (req, res) => {
    try {
        // Получаем username из переменной окружения, убираем символ @ если есть, и приводим к нижнему регистру
        let botUsername = process.env.BOT_INSTRUKTORS_KULIGA || 'kuliga_instruktor_bot';
        // Убираем @ если есть
        botUsername = botUsername.replace(/^@/, '').trim();
        // Приводим к нижнему регистру (username в Telegram всегда в нижнем регистре)
        botUsername = botUsername.toLowerCase();
        
        res.json({ botUsername });
    } catch (error) {
        console.error('Ошибка при получении информации о боте:', error);
        res.status(500).json({ error: 'Ошибка при получении информации о боте' });
    }
});

module.exports = router;

