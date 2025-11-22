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
            return res.status(400).json({ 
                error: 'Нельзя удалить слот с активным бронированием. Для отмены обратитесь к администратору.' 
            });
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

/**
 * POST /api/kuliga/instructor/group-trainings
 * Создание групповой тренировки из своего слота
 */
router.post('/group-trainings', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const {
            slot_id,
            sport_type,
            level,
            description,
            price_per_person,
            min_participants,
            max_participants
        } = req.body;

        // Валидация
        if (!slot_id || !sport_type || !level || !price_per_person || !max_participants) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Обязательные поля: slot_id, sport_type, level, price_per_person, max_participants'
            });
        }

        if (!['ski', 'snowboard'].includes(sport_type)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'sport_type должен быть "ski" или "snowboard"' });
        }

        const pricePerPersonValue = parseFloat(price_per_person);
        if (!Number.isFinite(pricePerPersonValue) || pricePerPersonValue <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Цена должна быть положительным числом' });
        }

        const maxParticipantsValue = parseInt(max_participants, 10);
        if (!Number.isInteger(maxParticipantsValue) || maxParticipantsValue < 2) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Максимум участников должен быть не менее 2' });
        }

        const minParticipantsValue = parseInt(min_participants || 2, 10);
        if (!Number.isInteger(minParticipantsValue) || minParticipantsValue < 1 || minParticipantsValue > maxParticipantsValue) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Минимум участников должен быть от 1 и не больше максимума'
            });
        }

        // Проверяем, что слот принадлежит инструктору и доступен
        const slotCheck = await client.query(
            `SELECT id, instructor_id, date, start_time, end_time, status
             FROM kuliga_schedule_slots
             WHERE id = $1 AND instructor_id = $2
             FOR UPDATE`,
            [slot_id, instructorId]
        );

        if (slotCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                error: 'Слот не найден или не принадлежит вам'
            });
        }

        const slot = slotCheck.rows[0];

        // Проверяем, что слот доступен (не занят)
        if (slot.status !== 'available') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Этот слот уже занят или заблокирован'
            });
        }

        // Проверяем, что на этот слот еще не создана групповая тренировка
        const existingTrainingCheck = await client.query(
            `SELECT id FROM kuliga_group_trainings
             WHERE slot_id = $1
               AND status IN ('open', 'confirmed')`,
            [slot_id]
        );

        if (existingTrainingCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'На этот слот уже создана групповая тренировка'
            });
        }

        // Создаем групповую тренировку (ОТКРЫТУЮ для записи через "Записаться в группу")
        const trainingResult = await client.query(
            `INSERT INTO kuliga_group_trainings (
                instructor_id, slot_id, date, start_time, end_time,
                sport_type, level, description, price_per_person,
                min_participants, max_participants, current_participants, status, is_private
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, 'open', FALSE)
            RETURNING *`,
            [
                instructorId,
                slot_id,
                slot.date,
                slot.start_time,
                slot.end_time,
                sport_type,
                level,
                description || null,
                pricePerPersonValue,
                minParticipantsValue,
                maxParticipantsValue
            ]
        );

        const training = trainingResult.rows[0];

        // Обновляем статус слота на 'group'
        await client.query(
            `UPDATE kuliga_schedule_slots
             SET status = 'group', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [slot_id]
        );

        await client.query('COMMIT');

        console.log(`✅ Инструктор ${instructorId} создал групповую тренировку: ID=${training.id}, дата=${slot.date}, время=${slot.start_time}`);

        res.status(201).json(training);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка создания групповой тренировки инструктором:', error);
        res.status(500).json({
            error: 'Ошибка создания групповой тренировки: ' + error.message
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/kuliga/instructor/me
 * Получение информации о текущем инструкторе
 */
router.get('/me', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    
    try {
        const result = await pool.query(
            'SELECT id, full_name, sport_type, admin_percentage, phone, email FROM kuliga_instructors WHERE id = $1',
            [instructorId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Инструктор не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения информации об инструкторе:', error);
        res.status(500).json({ error: 'Не удалось получить информацию об инструкторе' });
    }
});

/**
 * POST /api/kuliga/instructor/slots/delete-bulk
 * Массовое удаление слотов
 */
router.post('/slots/delete-bulk', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { fromDate, toDate, weekdays } = req.body;

    if (!fromDate || !toDate) {
        return res.status(400).json({ error: 'Укажите диапазон дат (fromDate, toDate)' });
    }

    try {
        let query = `
            DELETE FROM kuliga_schedule_slots
            WHERE instructor_id = $1
              AND date >= $2
              AND date <= $3
              AND status IN ('available', 'blocked')
        `;
        const params = [instructorId, fromDate, toDate];

        // Если указаны дни недели, фильтруем по ним
        if (weekdays && Array.isArray(weekdays) && weekdays.length > 0) {
            query += ` AND EXTRACT(DOW FROM date)::INTEGER = ANY($4)`;
            params.push(weekdays);
        }

        const result = await pool.query(query, params);

        console.log(`✅ Инструктор ${instructorId} удалил ${result.rowCount} слотов (${fromDate} - ${toDate})`);

        res.json({ success: true, deleted: result.rowCount });
    } catch (error) {
        console.error('Ошибка массового удаления слотов:', error);
        res.status(500).json({ error: 'Не удалось удалить слоты: ' + error.message });
    }
});

/**
 * GET /api/kuliga/instructor/bookings/slot/:slotId
 * Получение индивидуального бронирования по слоту
 */
router.get('/bookings/slot/:slotId', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { slotId } = req.params;

    try {
        const result = await pool.query(
            `SELECT 
                kb.*,
                c.full_name as client_name,
                c.phone as client_phone,
                kss.date,
                kss.start_time,
                kss.end_time
             FROM kuliga_bookings kb
             JOIN clients c ON kb.client_id = c.id
             JOIN kuliga_schedule_slots kss ON kb.slot_id = kss.id
             WHERE kb.slot_id = $1 
               AND kb.instructor_id = $2 
               AND kb.status IN ('pending', 'confirmed')
             ORDER BY kb.created_at DESC
             LIMIT 1`,
            [slotId, instructorId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Бронирование не найдено' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения бронирования по слоту:', error);
        res.status(500).json({ error: 'Не удалось получить информацию о бронировании' });
    }
});

/**
 * GET /api/kuliga/instructor/bookings/group/:trainingId
 * Получение списка бронирований групповой тренировки
 */
router.get('/bookings/group/:trainingId', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { trainingId } = req.params;

    try {
        // Проверяем, что тренировка принадлежит инструктору
        const trainingCheck = await pool.query(
            'SELECT id FROM kuliga_group_trainings WHERE id = $1 AND instructor_id = $2',
            [trainingId, instructorId]
        );

        if (trainingCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Групповая тренировка не найдена' });
        }

        const result = await pool.query(
            `SELECT 
                kb.*,
                c.full_name as client_name,
                c.phone as client_phone
             FROM kuliga_bookings kb
             JOIN clients c ON kb.client_id = c.id
             WHERE kb.group_training_id = $1 
               AND kb.status IN ('pending', 'confirmed')
             ORDER BY kb.created_at ASC`,
            [trainingId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка получения бронирований групповой тренировки:', error);
        res.status(500).json({ error: 'Не удалось получить список бронирований' });
    }
});

/**
 * GET /api/kuliga/instructor/group-trainings
 * Получение списка групповых тренировок инструктора
 */
router.get('/group-trainings', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { start_date, end_date } = req.query;

    try {
        let query = `
            SELECT 
                kgt.*,
                (SELECT COALESCE(SUM(kb.participants_count), 0)
                 FROM kuliga_bookings kb
                 WHERE kb.group_training_id = kgt.id 
                   AND kb.status IN ('pending', 'confirmed')) as current_participants
            FROM kuliga_group_trainings kgt
            WHERE kgt.instructor_id = $1
        `;
        const params = [instructorId];
        let paramIndex = 2;

        if (start_date) {
            query += ` AND kgt.date >= $${paramIndex}`;
            params.push(start_date);
            paramIndex++;
        }

        if (end_date) {
            query += ` AND kgt.date <= $${paramIndex}`;
            params.push(end_date);
            paramIndex++;
        }

        query += ' ORDER BY kgt.date ASC, kgt.start_time ASC';

        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Ошибка получения групповых тренировок:', error);
        res.status(500).json({ error: 'Не удалось получить список групповых тренировок' });
    }
});

/**
 * GET /api/kuliga/instructor/group-trainings/:id
 * Получение одной групповой тренировки
 */
router.get('/group-trainings/:id', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT 
                kgt.*,
                (SELECT COALESCE(SUM(kb.participants_count), 0)
                 FROM kuliga_bookings kb
                 WHERE kb.group_training_id = kgt.id 
                   AND kb.status IN ('pending', 'confirmed')) as current_participants
             FROM kuliga_group_trainings kgt
             WHERE kgt.id = $1 AND kgt.instructor_id = $2`,
            [id, instructorId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Групповая тренировка не найдена' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка получения групповой тренировки:', error);
        res.status(500).json({ error: 'Не удалось получить данные тренировки' });
    }
});

/**
 * PUT /api/kuliga/instructor/group-trainings/:id
 * Редактирование групповой тренировки
 */
router.put('/group-trainings/:id', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { id } = req.params;
    const {
        sport_type,
        level,
        description,
        price_per_person,
        min_participants,
        max_participants
    } = req.body;

    try {
        // Валидация
        if (!sport_type || !level || !price_per_person || !max_participants) {
            return res.status(400).json({
                error: 'Обязательные поля: sport_type, level, price_per_person, max_participants'
            });
        }

        if (!['ski', 'snowboard'].includes(sport_type)) {
            return res.status(400).json({ error: 'sport_type должен быть "ski" или "snowboard"' });
        }

        const pricePerPersonValue = parseFloat(price_per_person);
        if (!Number.isFinite(pricePerPersonValue) || pricePerPersonValue <= 0) {
            return res.status(400).json({ error: 'Цена должна быть положительным числом' });
        }

        const maxParticipantsValue = parseInt(max_participants, 10);
        if (!Number.isInteger(maxParticipantsValue) || maxParticipantsValue < 2) {
            return res.status(400).json({ error: 'Максимум участников должен быть не менее 2' });
        }

        const minParticipantsValue = parseInt(min_participants || 2, 10);
        if (minParticipantsValue > maxParticipantsValue) {
            return res.status(400).json({ error: 'Минимум участников не может превышать максимум' });
        }

        // Обновляем тренировку
        const result = await pool.query(
            `UPDATE kuliga_group_trainings
             SET sport_type = $1, level = $2, description = $3, 
                 price_per_person = $4, min_participants = $5, max_participants = $6,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $7 AND instructor_id = $8
             RETURNING *`,
            [sport_type, level, description, pricePerPersonValue, minParticipantsValue, maxParticipantsValue, id, instructorId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Групповая тренировка не найдена' });
        }

        console.log(`✅ Инструктор ${instructorId} обновил групповую тренировку ${id}`);

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка редактирования групповой тренировки:', error);
        res.status(500).json({ error: 'Не удалось обновить тренировку: ' + error.message });
    }
});

/**
 * DELETE /api/kuliga/instructor/group-trainings/:id
 * Удаление групповой тренировки
 */
router.delete('/group-trainings/:id', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Получаем информацию о групповой тренировке
        const trainingResult = await client.query(
            `SELECT * FROM kuliga_group_trainings 
             WHERE id = $1 AND instructor_id = $2`,
            [id, instructorId]
        );

        if (trainingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Групповая тренировка не найдена' });
        }

        const training = trainingResult.rows[0];

        // Получаем все активные бронирования для этой тренировки
        const bookingsResult = await client.query(
            `SELECT kb.*, c.full_name as client_name, c.phone as client_phone, c.telegram_id
             FROM kuliga_bookings kb
             JOIN clients c ON kb.client_id = c.id
             WHERE kb.group_training_id = $1 AND kb.status IN ('pending', 'confirmed')`,
            [id]
        );

        // Запрещаем удаление, если есть активные бронирования
        if (bookingsResult.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Нельзя удалить групповую тренировку с активными бронированиями. Для удаления обратитесь к администратору.' 
            });
        }

        // Отменяем все бронирования и возвращаем деньги (этот код не выполнится, так как выше проверка)
        for (const booking of bookingsResult.rows) {
            await client.query(
                'UPDATE kuliga_bookings SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
                ['cancelled', booking.id]
            );

            // Возврат средств
            const priceTotal = parseFloat(booking.price_total || 0);
            if (priceTotal > 0) {
                await client.query(
                    `UPDATE wallets SET balance = balance + $1 WHERE client_id = $2`,
                    [priceTotal, booking.client_id]
                );

                await client.query(
                    `INSERT INTO transactions (wallet_id, amount, type, description, created_at)
                     SELECT id, $1, 'refund', $2, CURRENT_TIMESTAMP
                     FROM wallets WHERE client_id = $3`,
                    [priceTotal, `Возврат за отмену групповой тренировки ${training.date}`, booking.client_id]
                );
            }
        }

        // Обновляем статус тренировки на cancelled
        await client.query(
            `UPDATE kuliga_group_trainings 
             SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [id]
        );

        // Освобождаем слот
        if (training.slot_id) {
            await client.query(
                `UPDATE kuliga_schedule_slots 
                 SET status = 'available', updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [training.slot_id]
            );
        }

        await client.query('COMMIT');

        console.log(`✅ Инструктор ${instructorId} удалил групповую тренировку ${id}, отменено бронирований: ${bookingsResult.rows.length}`);

        // Получаем информацию об инструкторе для уведомлений
        const instructorInfo = await pool.query(
            'SELECT full_name FROM kuliga_instructors WHERE id = $1',
            [instructorId]
        );
        const instructorName = instructorInfo.rows[0]?.full_name || 'Инструктор';

        // Отправляем уведомления клиентам
        const { bot } = require('../bot/client-bot');
        for (const booking of bookingsResult.rows) {
            if (booking.telegram_id) {
                try {
                    const moment = require('moment-timezone');
                    const dateObj = moment(training.date).tz('Asia/Yekaterinburg');
                    const formattedDate = dateObj.format('DD.MM.YYYY');
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.day()];
                    
                    await bot.sendMessage(
                        booking.telegram_id,
                        `❌ Групповая тренировка отменена\n\n` +
                        `📅 Дата: ${formattedDate} (${dayOfWeek})\n` +
                        `⏰ Время: ${training.start_time.substring(0, 5)}\n` +
                        `👨‍🏫 Инструктор: ${instructorName}\n` +
                        `💰 Возврат: ${parseFloat(booking.price_total).toFixed(2)} ₽\n\n` +
                        `Средства возвращены на ваш баланс.`
                    );
                } catch (error) {
                    console.error(`Ошибка отправки уведомления клиенту ${booking.telegram_id}:`, error);
                }
            }
        }

        // Отправляем уведомление администратору
        const { notifyAdminGroupTrainingDeletedByInstructor } = require('../bot/admin-notify');
        try {
            await notifyAdminGroupTrainingDeletedByInstructor({
                training,
                instructorName,
                bookingsCount: bookingsResult.rows.length
            });
        } catch (error) {
            console.error('Ошибка отправки уведомления администратору:', error);
        }

        res.json({ success: true, message: 'Групповая тренировка удалена', refunded: bookingsResult.rows.length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка удаления групповой тренировки:', error);
        res.status(500).json({ error: 'Не удалось удалить групповую тренировку: ' + error.message });
    } finally {
        client.release();
    }
});

module.exports = router;

