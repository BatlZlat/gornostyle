const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { verifyKuligaInstructorToken } = require('../middleware/kuligaInstructorAuth');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Yekaterinburg';

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
            // ВАЖНО: Используем ::date для явного приведения типа, чтобы избежать проблем с часовыми поясами
            query = `
                SELECT id, instructor_id, date, start_time, end_time, status, created_at, updated_at
                FROM kuliga_schedule_slots
                WHERE instructor_id = $1 AND date >= $2::date AND date <= $3::date
                ORDER BY date ASC, start_time ASC
            `;
            params = [instructorId, start_date, end_date];
            console.log(`📅 Запрос слотов для инструктора ${instructorId}: ${start_date} - ${end_date}`);
        } else {
            return res.status(400).json({ error: 'Необходимо указать date или start_date+end_date' });
        }

        const result = await pool.query(query, params);
        
        console.log(`📅 Запрос слотов: instructorId=${instructorId}, ${start_date ? `start_date=${start_date}` : ''} ${end_date ? `end_date=${end_date}` : ''} ${date ? `date=${date}` : ''}`);
        console.log(`📅 Найдено слотов: ${result.rows.length}`);
        if (result.rows.length > 0) {
            console.log(`📅 Первые 3 слота:`, result.rows.slice(0, 3).map(r => ({ id: r.id, date: r.date, start_time: r.start_time, status: r.status })));
        }
        
        // ВАЖНО: Убрана автоматическая разблокировка слотов
        // Инструктор должен вручную блокировать/разблокировать слоты
        // Если администратор удалит групповую тренировку, он сам установит статус слота
        
            // Добавляем информацию о наличии групповых тренировок для слотов
            // (тренировки удаляются полностью, не помечаются как cancelled)
        if (result.rows.length > 0) {
            const allSlotIds = result.rows.map(row => row.id);
            const trainingsInfo = await pool.query(
                `SELECT slot_id FROM kuliga_group_trainings 
                 WHERE slot_id = ANY($1)`,
                [allSlotIds]
            );
            const slotsWithTrainings = new Set(trainingsInfo.rows.map(row => row.slot_id));
            
            // Добавляем флаг has_group_training к каждому слоту
            result.rows.forEach(slot => {
                slot.has_group_training = slotsWithTrainings.has(slot.id);
            });
        }
        
        // Преобразуем даты в строки YYYY-MM-DD, чтобы избежать проблем с часовыми поясами
        const formattedRows = result.rows.map(row => ({
            ...row,
            date: row.date instanceof Date 
                ? moment.tz(row.date, TIMEZONE).format('YYYY-MM-DD')
                : (typeof row.date === 'string' ? row.date.split('T')[0] : row.date)
        }));
        
        res.json(formattedRows);
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
             WHERE instructor_id = $1 AND date = $2::date 
             ORDER BY start_time ASC`,
            [instructorId, date]
        );
        // Нормализуем формат времени: PostgreSQL TIME возвращает "HH:MM:SS", нужно "HH:MM"
        const existingTimes = existingSlotsResult.rows.map(row => {
            const timeStr = String(row.start_time);
            // Если формат "HH:MM:SS", обрезаем до "HH:MM"
            return timeStr.substring(0, 5);
        });

        // Проверяем интервалы с существующими слотами
        // Убираем дубликаты из существующих времен перед объединением
        const uniqueExistingTimes = [...new Set(existingTimes)];
        const allTimes = [...uniqueExistingTimes, ...validTimes];
        // Убираем дубликаты и из общего массива (на случай, если пытаемся создать уже существующий слот)
        const uniqueAllTimes = [...new Set(allTimes)].sort();
        const allTimesCheck = checkMinimumInterval(uniqueAllTimes);
        if (!allTimesCheck.valid) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: `Временные слоты пересекаются с существующими. ${allTimesCheck.error}` 
            });
        }

        let created = 0;
        let skipped = 0;

        // Фильтруем времена, убирая те, что уже существуют (с учетом нормализации формата)
        const newTimes = validTimes.filter(t => !uniqueExistingTimes.includes(t));
        
        // Подсчитываем пропущенные слоты
        skipped = validTimes.length - newTimes.length;
        
        if (skipped > 0) {
            console.log(`   ⚠️ Пропущено ${skipped} слотов, которые уже существуют`);
        }
        
        // Если не осталось новых времен (все уже существуют), возвращаем ошибку с деталями
        if (newTimes.length === 0) {
            await client.query('ROLLBACK');
            
            // Получаем детальную информацию о существующих слотах для лучшего сообщения об ошибке
            const detailedSlotsResult = await client.query(
                `SELECT start_time, status 
                 FROM kuliga_schedule_slots 
                 WHERE instructor_id = $1 AND date = $2::date 
                   AND start_time::text LIKE ANY(ARRAY[${validTimes.map((_, i) => `$${i + 3} || '%'`).join(', ')}])
                 ORDER BY start_time ASC`,
                [instructorId, date, ...validTimes]
            );
            
            const statusMessages = {
                'available': 'свободный',
                'booked': 'забронированный',
                'blocked': 'заблокированный',
                'group': 'занятый групповой тренировкой'
            };
            
            const existingDetails = detailedSlotsResult.rows.map(row => {
                const timeStr = String(row.start_time).substring(0, 5);
                const statusMsg = statusMessages[row.status] || row.status;
                return `${timeStr} (${statusMsg})`;
            }).join(', ');
            
            return res.status(400).json({ 
                error: `Все указанные временные слоты уже существуют на эту дату. Существующие слоты: ${existingDetails}. Если слот занят групповой тренировкой, удалите или отредактируйте тренировку через администратора.` 
            });
        }

        for (const time of newTimes) {
            // Проверяем, существует ли уже такой слот (дополнительная проверка для надежности)
            const existingSlot = await client.query(
                `SELECT id, status FROM kuliga_schedule_slots 
                 WHERE instructor_id = $1 AND date = $2::date AND start_time::text LIKE $3 || '%'`,
                [instructorId, date, time]
            );

            if (existingSlot.rows.length > 0) {
                // Слот уже существует, пропускаем
                // ВАЖНО: skipped уже подсчитан выше, здесь только логируем
                const existing = existingSlot.rows[0];
                console.log(`   ⚠️ Слот на ${time} уже существует (id=${existing.id}, status=${existing.status}), пропускаем`);
                continue;
            }

            // Вычисляем время окончания (слот длится 1 час)
            const [hours, minutes] = time.split(':').map(Number);
            const endHours = (hours + 1) % 24;
            const endTime = `${String(endHours).padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

            // Создаем новый слот
            // ВАЖНО: Используем date::date для явного приведения типа
            // Получаем location инструктора для наследования
            const instructorLocationResult = await client.query(
                'SELECT location FROM kuliga_instructors WHERE id = $1',
                [instructorId]
            );
            const instructorLocation = instructorLocationResult.rows[0]?.location || 'kuliga';
            
            console.log(`   💾 Создание слота: instructorId=${instructorId}, date=${date}, time=${time}, endTime=${endTime}, location=${instructorLocation}`);
            await client.query(
                `INSERT INTO kuliga_schedule_slots 
                 (instructor_id, date, start_time, end_time, status, location)
                 VALUES ($1, $2::date, $3, $4, 'available', $5)`,
                [instructorId, date, time, endTime, instructorLocation]
            );

            created++;
        }

        await client.query('COMMIT');
        
        console.log(`   ✅ Создано слотов: ${created}, пропущено: ${skipped}`);
        
        res.json({ 
            success: true, 
            created,
            skipped: skipped || 0,
            message: `Создано слотов: ${created}${skipped > 0 ? `, пропущено (уже существуют): ${skipped}` : ''}`
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
        
        // Используем moment-timezone для правильной работы с часовым поясом
        // Парсим строку даты как локальную дату в часовом поясе Екатеринбурга
        // ВАЖНО: Создаем момент явно из частей даты, чтобы избежать проблем с UTC
        const [startYear, startMonth, startDay] = fromDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = toDate.split('-').map(Number);
        
        // Создаем моменты в часовом поясе Екатеринбурга
        const startMoment = moment.tz([startYear, startMonth - 1, startDay], TIMEZONE).startOf('day');
        const endMoment = moment.tz([endYear, endMonth - 1, endDay], TIMEZONE).endOf('day');
        
        // Преобразуем массив weekdays в числа для корректного сравнения (делаем это один раз)
        const weekdaysNumbers = weekdays.map(w => typeof w === 'string' ? parseInt(w, 10) : w);

        // Проходим по всем датам в диапазоне
        let currentMoment = startMoment.clone();
        while (currentMoment.isSameOrBefore(endMoment)) {
            const dayOfWeek = currentMoment.day(); // 0 = ВС, 1 = ПН, ..., 6 = СБ

            // Проверяем, входит ли этот день недели в выбранные
            if (!weekdaysNumbers.includes(dayOfWeek)) {
                currentMoment.add(1, 'day');
                continue;
            }

            const dateStr = currentMoment.format('YYYY-MM-DD');
            
            // Логируем для отладки
            const dayNames = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
            console.log(`📅 Обработка даты: ${dateStr} (${dayNames[dayOfWeek]}) - день недели: ${dayOfWeek}, выбрано: [${weekdaysNumbers.join(', ')}]`);

            // Получаем существующие слоты на эту дату для проверки интервалов
            // ВАЖНО: Используем dateStr::date для явного приведения типа
            const existingSlotsResult = await client.query(
                `SELECT start_time FROM kuliga_schedule_slots 
                 WHERE instructor_id = $1 AND date = $2::date
                 ORDER BY start_time ASC`,
                [instructorId, dateStr]
            );
            // Нормализуем формат времени: PostgreSQL TIME возвращает "HH:MM:SS", нужно "HH:MM"
            const existingTimes = existingSlotsResult.rows.map(row => {
                const timeStr = String(row.start_time);
                // Если формат "HH:MM:SS", обрезаем до "HH:MM"
                return timeStr.substring(0, 5);
            });

            // Проверяем интервалы с существующими слотами
            // Убираем дубликаты из существующих времен перед объединением
            const uniqueExistingTimes = [...new Set(existingTimes)];
            // Также фильтруем новые времена, убирая те, что уже существуют
            const newTimes = validTimes.filter(t => !uniqueExistingTimes.includes(t));
            
            // Если не осталось новых времен (все уже существуют), пропускаем эту дату
            if (newTimes.length === 0) {
                currentMoment.add(1, 'day');
                continue;
            }
            
            const allTimes = [...uniqueExistingTimes, ...newTimes];
            // Убираем дубликаты и сортируем перед проверкой интервалов
            const uniqueAllTimes = [...new Set(allTimes)].sort();
            const allTimesCheck = checkMinimumInterval(uniqueAllTimes);
            if (!allTimesCheck.valid) {
                // Для массового создания просто пропускаем эту дату, не прерываем весь процесс
                continue;
            }

            // Создаем слоты только для новых времен (не существующих)
            for (const time of newTimes) {
                // Дополнительная проверка на существование слота (для надежности)
                // ВАЖНО: Используем dateStr::date для явного приведения типа и LIKE для сравнения форматов
                const existingSlot = await client.query(
                    `SELECT id FROM kuliga_schedule_slots 
                     WHERE instructor_id = $1 AND date = $2::date AND start_time::text LIKE $3 || '%'`,
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
                // ВАЖНО: Используем dateStr::date для явного приведения типа, чтобы PostgreSQL правильно интерпретировал дату
                // Получаем location инструктора для наследования
                const instructorLocationResult = await client.query(
                    'SELECT location FROM kuliga_instructors WHERE id = $1',
                    [instructorId]
                );
                const instructorLocation = instructorLocationResult.rows[0]?.location || 'kuliga';
                
                console.log(`   💾 Сохранение слота: date=${dateStr}, time=${time}, endTime=${endTime}, location=${instructorLocation}`);
                await client.query(
                    `INSERT INTO kuliga_schedule_slots 
                     (instructor_id, date, start_time, end_time, status, location)
                     VALUES ($1, $2::date, $3, $4, 'available', $5)`,
                    [instructorId, dateStr, time, endTime, instructorLocation]
                );

                created++;
            }
            
            currentMoment.add(1, 'day');
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

        // Проверяем, есть ли на слоте групповая тренировка
        const trainingCheck = await pool.query(
            'SELECT id FROM kuliga_group_trainings WHERE slot_id = $1',
            [slotId]
        );

        if (trainingCheck.rows.length > 0) {
            return res.status(400).json({ 
                error: 'Нельзя изменить статус слота с групповой тренировкой. Удалите или отредактируйте тренировку через администратора.' 
            });
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

        // Проверяем, есть ли на слоте групповая тренировка (даже без участников)
        // (тренировки удаляются полностью, не помечаются как cancelled)
        const trainingCheck = await pool.query(
            `SELECT id FROM kuliga_group_trainings 
             WHERE slot_id = $1`,
            [slotId]
        );

        if (trainingCheck.rows.length > 0) {
            // Проверяем, есть ли участники на этой тренировке
            const bookingsCheck = await pool.query(
                `SELECT COUNT(*) as count 
                 FROM kuliga_bookings 
                 WHERE group_training_id = $1 
                 AND status IN ('pending', 'confirmed')`,
                [trainingCheck.rows[0].id]
            );

            const hasParticipants = parseInt(bookingsCheck.rows[0].count) > 0;

            if (hasParticipants) {
                return res.status(400).json({ 
                    error: 'Нельзя удалить слот с групповой тренировкой, на которую записаны клиенты. Для удаления обратитесь к администратору.' 
                });
            } else {
                return res.status(400).json({ 
                    error: 'Нельзя удалить слот с групповой тренировкой. Сначала удалите групповую тренировку через администратора.' 
                });
            }
        }

        // Удаляем слот только если на нем нет групповой тренировки
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

        // Преобразуем дату в строку YYYY-MM-DD
        if (training.date instanceof Date) {
            training.date = moment.tz(training.date, TIMEZONE).format('YYYY-MM-DD');
        } else if (typeof training.date === 'string') {
            training.date = training.date.split('T')[0].split(' ')[0];
        }

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
            'SELECT id, full_name, sport_type, admin_percentage, phone, email, location FROM kuliga_instructors WHERE id = $1',
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

    const client = await pool.connect();
    let deletedCount = 0;
    let skippedWithTraining = 0;

    try {
        await client.query('BEGIN');

        // Получаем все слоты в диапазоне для инструктора
        let query = `
            SELECT id, status
            FROM kuliga_schedule_slots
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

        const slotsResult = await client.query(query, params);

        // Для каждого слота проверяем наличие групповой тренировки
        for (const slot of slotsResult.rows) {
            // Проверяем, есть ли на слоте групповая тренировка
            // (тренировки удаляются полностью, не помечаются как cancelled)
            const trainingCheck = await client.query(
                `SELECT id FROM kuliga_group_trainings 
                 WHERE slot_id = $1`,
                [slot.id]
            );

            if (trainingCheck.rows.length > 0) {
                // Пропускаем слоты с групповыми тренировками
                skippedWithTraining++;
                continue;
            }

            // Удаляем слот только если на нем нет групповой тренировки
            await client.query(
                'DELETE FROM kuliga_schedule_slots WHERE id = $1',
                [slot.id]
            );
            deletedCount++;
        }

        await client.query('COMMIT');

        console.log(`✅ Инструктор ${instructorId} удалил ${deletedCount} слотов, пропущено ${skippedWithTraining} (${fromDate} - ${toDate})`);

        res.json({ 
            success: true, 
            deleted: deletedCount,
            skipped: skippedWithTraining,
            message: `Удалено слотов: ${deletedCount}${skippedWithTraining > 0 ? `, пропущено (с групповыми тренировками): ${skippedWithTraining}` : ''}`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка массового удаления слотов:', error);
        res.status(500).json({ error: 'Не удалось удалить слоты: ' + error.message });
    } finally {
        client.release();
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

        // Преобразуем даты в строки YYYY-MM-DD
        const formattedRows = result.rows.map(row => {
            const formattedRow = { ...row };
            if (row.date instanceof Date) {
                formattedRow.date = moment.tz(row.date, TIMEZONE).format('YYYY-MM-DD');
            } else if (typeof row.date === 'string') {
                formattedRow.date = row.date.split('T')[0].split(' ')[0];
            }
            return formattedRow;
        });

        res.json(formattedRows);
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
        
        console.log(`📅 Найдено групповых тренировок для инструктора ${instructorId}: ${rows.length}`);
        
        // Преобразуем даты в строки YYYY-MM-DD, чтобы избежать проблем с часовыми поясами
        // ВАЖНО: PostgreSQL DATE колонка возвращается как объект Date в JavaScript
        // Нужно преобразовать его в строку, используя правильный часовой пояс
        const formattedRows = rows.map(row => {
            let dateStr = row.date;
            if (dateStr instanceof Date) {
                // Если это объект Date, преобразуем его в момент в нужном часовом поясе
                // и форматируем как строку YYYY-MM-DD
                dateStr = moment.tz(dateStr, TIMEZONE).format('YYYY-MM-DD');
            } else if (typeof dateStr === 'string') {
                // Если это строка, убираем время если есть
                dateStr = dateStr.split('T')[0].split(' ')[0];
            }
            return {
                ...row,
                date: dateStr
            };
        });
        
        res.json(formattedRows);
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

        // Преобразуем дату в строку YYYY-MM-DD
        const row = result.rows[0];
        if (row.date instanceof Date) {
            row.date = moment.tz(row.date, TIMEZONE).format('YYYY-MM-DD');
        } else if (typeof row.date === 'string') {
            row.date = row.date.split('T')[0].split(' ')[0];
        }

        res.json(row);
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

        // Проверяем, есть ли записи на тренировку
        const bookingsCheck = await pool.query(
            `SELECT COUNT(*) as count 
             FROM kuliga_bookings 
             WHERE group_training_id = $1 
               AND status IN ('pending', 'confirmed')`,
            [id]
        );
        
        const hasBookings = parseInt(bookingsCheck.rows[0].count) > 0;
        
        // Если есть записи, проверяем, не пытаются ли изменить количество участников
        if (hasBookings) {
            const currentTraining = await pool.query(
                `SELECT min_participants, max_participants 
                 FROM kuliga_group_trainings 
                 WHERE id = $1 AND instructor_id = $2`,
                [id, instructorId]
            );
            
            if (currentTraining.rows.length === 0) {
                return res.status(404).json({ error: 'Групповая тренировка не найдена' });
            }
            
            const current = currentTraining.rows[0];
            if (current.min_participants !== minParticipantsValue || current.max_participants !== maxParticipantsValue) {
                return res.status(400).json({ 
                    error: 'Нельзя изменить количество участников, так как на тренировку есть записи. Обратитесь к администратору.' 
                });
            }
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

        // Преобразуем дату в строку YYYY-MM-DD
        const row = result.rows[0];
        if (row.date instanceof Date) {
            row.date = moment.tz(row.date, TIMEZONE).format('YYYY-MM-DD');
        } else if (typeof row.date === 'string') {
            row.date = row.date.split('T')[0].split(' ')[0];
        }

        res.json(row);
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

        // Удаляем групповую тренировку
        await client.query(
            'DELETE FROM kuliga_group_trainings WHERE id = $1',
            [id]
        );

        // Освобождаем слот (меняем статус с blocked на available)
        await client.query(
            `UPDATE kuliga_schedule_slots 
             SET status = 'available' 
             WHERE id = $1 AND status = 'blocked'`,
            [training.slot_id]
        );

        await client.query('COMMIT');
        
        console.log(`✅ Инструктор ${instructorId} удалил групповую тренировку ${id} и освободил слот ${training.slot_id}`);

        res.json({ 
            success: true, 
            message: 'Групповая тренировка успешно удалена, слот освобожден' 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка удаления групповой тренировки:', error);
        res.status(500).json({ error: 'Не удалось удалить групповую тренировку: ' + error.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/kuliga/instructor/regular-group-trainings
 * Создание регулярных групповых тренировок
 * Body: { fromDate, toDate, weekdays[], time, sportType, level, description, minParticipants, maxParticipants }
 */
router.post('/regular-group-trainings', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { 
        fromDate, 
        toDate, 
        weekdays, 
        time, 
        sportType, 
        level, 
        description, 
        minParticipants, 
        maxParticipants 
    } = req.body;

    // Валидация
    if (!fromDate || !toDate || !Array.isArray(weekdays) || !time || !sportType || !level) {
        return res.status(400).json({ error: 'Необходимо указать все обязательные поля' });
    }

    if (weekdays.length === 0) {
        return res.status(400).json({ error: 'Необходимо выбрать хотя бы один день недели' });
    }

    if (minParticipants > maxParticipants) {
        return res.status(400).json({ error: 'Минимум участников не может быть больше максимума' });
    }

    // Проверяем время (не раньше 10:15)
    const [hours, minutes] = time.split(':').map(Number);
    if (hours < 10 || (hours === 10 && minutes < 15)) {
        return res.status(400).json({ error: 'Первая тренировка может начаться не раньше 10:15' });
    }

    const client = await pool.connect();
    let createdSlots = 0;
    let createdTrainings = 0;

    try {
        await client.query('BEGIN');

        // Получаем цену из прайса
        const priceResult = await client.query(
            `SELECT price FROM winter_prices 
             WHERE type = 'group' 
             AND participants = $1 
             AND duration = 60 
             AND is_active = TRUE
             LIMIT 1`,
            [maxParticipants]
        );

        if (priceResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: `Цена для ${maxParticipants} участников не найдена в прайсе` 
            });
        }

        const totalPrice = parseFloat(priceResult.rows[0].price);
        const pricePerPerson = totalPrice / maxParticipants;

        // Генерируем даты в диапазоне с учетом часового пояса Екатеринбурга
        // ВАЖНО: Создаем момент явно из частей даты, чтобы избежать проблем с UTC
        const dates = [];
        const [startYear, startMonth, startDay] = fromDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = toDate.split('-').map(Number);
        
        // Создаем моменты в часовом поясе Екатеринбурга
        const startMoment = moment.tz([startYear, startMonth - 1, startDay], TIMEZONE).startOf('day');
        const endMoment = moment.tz([endYear, endMonth - 1, endDay], TIMEZONE).endOf('day');
        
        // Преобразуем массив weekdays в числа для корректного сравнения (делаем это один раз)
        const weekdaysNumbers = weekdays.map(w => typeof w === 'string' ? parseInt(w, 10) : w);
        
        let currentMoment = startMoment.clone();
        while (currentMoment.isSameOrBefore(endMoment)) {
            const dayOfWeek = currentMoment.day(); // 0=ВС, 1=ПН, ..., 6=СБ
            
            if (weekdaysNumbers.includes(dayOfWeek)) {
                const dateStr = currentMoment.format('YYYY-MM-DD');
                dates.push(dateStr);
                
                // Логируем для отладки
                const dayNames = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
                console.log(`📅 Добавлена дата: ${dateStr} (${dayNames[dayOfWeek]}) - день недели: ${dayOfWeek}`);
            }
            
            currentMoment.add(1, 'day');
        }
        
        console.log(`📅 Сгенерировано ${dates.length} дат для дней недели [${weekdaysNumbers.join(', ')}] (часовой пояс: ${TIMEZONE}):`, dates);

        // Вычисляем end_time для тренировки (start_time + 60 минут)
        const endTime = `${String(hours + 1).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

        // Для каждой даты создаем слот и групповую тренировку
        for (const dateStr of dates) {

            // Проверяем, не существует ли уже слот на это время
            // ВАЖНО: Используем dateStr::date для явного приведения типа
            const existingSlot = await client.query(
                `SELECT id FROM kuliga_schedule_slots 
                 WHERE instructor_id = $1 AND date = $2::date AND start_time = $3`,
                [instructorId, dateStr, time]
            );

            let slotId;

            if (existingSlot.rows.length > 0) {
                // Слот уже существует
                slotId = existingSlot.rows[0].id;

                // Проверяем статус слота
                const slotStatus = await client.query(
                    `SELECT status FROM kuliga_schedule_slots WHERE id = $1`,
                    [slotId]
                );

                if (slotStatus.rows[0].status !== 'available') {
                    // Слот занят, пропускаем
                    continue;
                }
            } else {
                // Создаем новый слот
                // ВАЖНО: Используем dateStr::date для явного приведения типа
                // Получаем location инструктора для наследования
                const instructorLocationResult = await client.query(
                    'SELECT location FROM kuliga_instructors WHERE id = $1',
                    [instructorId]
                );
                const instructorLocation = instructorLocationResult.rows[0]?.location || 'kuliga';
                
                console.log(`   💾 Создание слота для регулярной тренировки: date=${dateStr}, time=${time}, endTime=${endTime}, location=${instructorLocation}`);
                const slotResult = await client.query(
                    `INSERT INTO kuliga_schedule_slots 
                     (instructor_id, date, start_time, end_time, status, location)
                     VALUES ($1, $2::date, $3, $4, 'blocked', $5)
                     RETURNING id`,
                    [instructorId, dateStr, time, endTime, instructorLocation]
                );

                slotId = slotResult.rows[0].id;
                createdSlots++;
            }

            // Обновляем статус слота на blocked
            await client.query(
                `UPDATE kuliga_schedule_slots SET status = 'blocked' WHERE id = $1`,
                [slotId]
            );

            // Создаем групповую тренировку
            // ВАЖНО: Используем dateStr::date для явного приведения типа
            await client.query(
                `INSERT INTO kuliga_group_trainings 
                 (slot_id, instructor_id, sport_type, level, description, 
                  min_participants, max_participants, current_participants, 
                  price_per_person, date, start_time, end_time, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9::date, $10, $11, 'open')`,
                [slotId, instructorId, sportType, level, description || null, 
                 minParticipants, maxParticipants, pricePerPerson, dateStr, time, endTime]
            );

            createdTrainings++;
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            created: createdSlots, 
            trainings: createdTrainings,
            message: `Создано ${createdSlots} новых слотов и ${createdTrainings} групповых тренировок`
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании регулярных тренировок:', error);
        res.status(500).json({ error: error.message || 'Ошибка при создании регулярных тренировок' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/kuliga/instructor/group-trainings/delete-bulk
 * Массовое удаление групповых тренировок
 * Body: { fromDate, toDate, weekdays[] (опционально), time (опционально) }
 */
router.post('/group-trainings/delete-bulk', async (req, res) => {
    const instructorId = req.kuligaInstructor.id;
    const { fromDate, toDate, weekdays, time } = req.body;

    if (!fromDate || !toDate) {
        return res.status(400).json({ error: 'Необходимо указать диапазон дат' });
    }

    const client = await pool.connect();
    let deletedTrainings = 0;
    let skippedWithBookings = 0;
    let freedSlots = 0;

    try {
        await client.query('BEGIN');

        // Формируем запрос для поиска групповых тренировок
        let query = `
            SELECT id, slot_id, date, start_time
            FROM kuliga_group_trainings
            WHERE instructor_id = $1 
            AND date BETWEEN $2 AND $3
        `;
        const params = [instructorId, fromDate, toDate];
        let paramIndex = 4;

        // Фильтр по дням недели
        if (weekdays && Array.isArray(weekdays) && weekdays.length > 0) {
            query += ` AND EXTRACT(DOW FROM date)::INTEGER = ANY($${paramIndex})`;
            params.push(weekdays);
            paramIndex++;
        }

        // Фильтр по времени начала
        if (time) {
            query += ` AND start_time = $${paramIndex}`;
            params.push(time);
            paramIndex++;
        }

        query += ' ORDER BY date, start_time';

        const trainingsResult = await client.query(query, params);

        // Для каждой тренировки проверяем наличие активных бронирований и удаляем
        for (const training of trainingsResult.rows) {
            // Проверяем наличие активных бронирований
            const bookingsCheck = await client.query(
                `SELECT COUNT(*) as count 
                 FROM kuliga_bookings 
                 WHERE group_training_id = $1 
                 AND status IN ('pending', 'confirmed')`,
                [training.id]
            );

            const hasActiveBookings = parseInt(bookingsCheck.rows[0].count) > 0;

            if (hasActiveBookings) {
                // Пропускаем тренировки с активными бронированиями
                skippedWithBookings++;
                continue;
            }

            // Удаляем тренировку
            await client.query(
                'DELETE FROM kuliga_group_trainings WHERE id = $1',
                [training.id]
            );

            // Освобождаем слот (устанавливаем статус available независимо от текущего статуса)
            if (training.slot_id) {
                const slotUpdateResult = await client.query(
                    `UPDATE kuliga_schedule_slots 
                     SET status = 'available', updated_at = CURRENT_TIMESTAMP 
                     WHERE id = $1 AND instructor_id = $2`,
                    [training.slot_id, instructorId]
                );

                if (slotUpdateResult.rowCount > 0) {
                    freedSlots++;
                }
            }

            deletedTrainings++;
        }

        await client.query('COMMIT');

        let message = `Удалено тренировок: ${deletedTrainings}`;
        if (skippedWithBookings > 0) {
            message += `, пропущено (с бронированиями): ${skippedWithBookings}`;
        }
        if (freedSlots > 0) {
            message += `, освобождено слотов: ${freedSlots}`;
        }

        res.json({
            success: true,
            deleted: deletedTrainings,
            skipped: skippedWithBookings,
            freedSlots: freedSlots,
            message: message
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка массового удаления групповых тренировок:', error);
        res.status(500).json({ error: 'Ошибка при удалении тренировок: ' + error.message });
    } finally {
        client.release();
    }
});

module.exports = router;

