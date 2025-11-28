const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');
const { notifyAdminWinterGroupTrainingCreatedByAdmin } = require('../bot/admin-notify');

/**
 * API для управления зимними тренировками (естественный склон)
 */

/**
 * POST /api/winter-trainings
 * Создание новой зимней тренировки
 */
router.post('/', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const {
            training_type,
            group_id,
            session_date,
            start_time,
            end_time,
            duration,
            trainer_id,
            skill_level,
            max_participants,
            slope_type,
            winter_training_type,
            price
        } = req.body;
        
        // Валидация
        if (!session_date || !start_time || !end_time || !duration) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Обязательные поля: session_date, start_time, end_time, duration' 
            });
        }
        
        if (!slope_type || slope_type !== 'natural_slope') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'slope_type должен быть natural_slope' 
            });
        }
        
        // Определяем булево значение training_type
        const isGroupTraining = training_type === true;
        
        // Проверяем наличие расписания на эту дату (хотя бы один слот)
        const anySlotsForDate = await client.query(
            'SELECT 1 FROM winter_schedule WHERE date = $1 LIMIT 1',
            [session_date]
        );
        if (anySlotsForDate.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'На выбранную дату нет расписания. Сначала создайте слоты в winter_schedule.'
            });
        }

        // Создаем тренировку в таблице training_sessions
        const result = await client.query(`
            INSERT INTO training_sessions (
                session_date,
                start_time,
                end_time,
                duration,
                training_type,
                group_id,
                max_participants,
                price,
                skill_level,
                trainer_id,
                slope_type,
                winter_training_type,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            session_date,
            start_time,
            end_time,
            duration,
            isGroupTraining,
            group_id || null,
            max_participants || 1,
            price || 0,
            skill_level || null,
            trainer_id || null,
            slope_type,
            winter_training_type,
            'scheduled'
        ]);
        
        const newTraining = result.rows[0];
        
        // Если это групповая тренировка, резервируем существующий слот в winter_schedule
        if (isGroupTraining && winter_training_type === 'group') {
            const timeSlot = start_time.substring(0, 5);
            const slotResult = await client.query(
                `SELECT id, is_available FROM winter_schedule 
                 WHERE date = $1 AND time_slot = $2::time LIMIT 1`,
                [session_date, timeSlot]
            );
            if (slotResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: 'На выбранное время нет свободного слота в расписании' 
                });
            }
            const slot = slotResult.rows[0];
            if (slot.is_available === false) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Слот уже занят' });
            }
            await client.query(
                `UPDATE winter_schedule 
                 SET is_group_training = true,
                     is_individual_training = false,
                     group_id = $1,
                     trainer_id = $2,
                     max_participants = $3,
                     is_available = false,
                     updated_at = NOW()
                 WHERE id = $4`,
                [group_id || null, trainer_id || null, max_participants || 1, slot.id]
            );
        }
        
        await client.query('COMMIT');
        
        console.log(`✅ Создана зимняя тренировка: ID=${newTraining.id}, тип=${winter_training_type}, дата=${session_date}, время=${start_time}`);
        
        // Уведомление администратору (асинхронно)
        if (isGroupTraining && winter_training_type === 'group') {
            (async () => {
                try {
                    const info = await pool.query(
                        `SELECT 
                            ts.session_date, ts.start_time, ts.max_participants, ts.price,
                            g.name as group_name,
                            t.full_name as trainer_name
                         FROM training_sessions ts
                         LEFT JOIN groups g ON ts.group_id = g.id
                         LEFT JOIN trainers t ON ts.trainer_id = t.id
                         WHERE ts.id = $1`,
                        [newTraining.id]
                    );
                    if (info.rows[0]) {
                        await notifyAdminWinterGroupTrainingCreatedByAdmin(info.rows[0]);
                    }
                } catch (err) {
                    console.error('Ошибка уведомления администратору о зимней групповой тренировке:', err);
                }
            })();
        }

        res.status(201).json(newTraining);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании зимней тренировки:', error);
        console.error('Полная информация об ошибке:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail,
            hint: error.hint
        });
        res.status(500).json({ 
            error: 'Ошибка при создании тренировки: ' + error.message,
            detail: error.detail || null,
            hint: error.hint || null
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/winter-trainings
 * Получение списка зимних тренировок
 */
router.get('/', async (req, res) => {
    try {
        const { date, type, status } = req.query;
        
        let query = `
            SELECT ts.*, 
                   g.name as group_name,
                   t.full_name as trainer_name
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            WHERE ts.slope_type = 'natural_slope'
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (date) {
            query += ` AND ts.session_date = $${paramIndex}`;
            params.push(date);
            paramIndex++;
        }
        
        if (type) {
            query += ` AND ts.winter_training_type = $${paramIndex}`;
            params.push(type);
            paramIndex++;
        }
        
        if (status) {
            query += ` AND ts.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        query += ' ORDER BY ts.session_date, ts.start_time';
        
        const result = await pool.query(query, params);
        res.json({ trainings: result.rows });
    } catch (error) {
        console.error('Ошибка при получении зимних тренировок:', error);
        res.status(500).json({ error: 'Ошибка при получении тренировок' });
    }
});

/**
 * GET /api/winter-trainings/archive
 * Получение архива зимних тренировок (прошедших тренировок)
 * ВАЖНО: Этот роут должен быть ПЕРЕД /:id, иначе /archive будет обрабатываться как /:id
 * Включает тренировки из training_sessions и тренировки Кулиги (индивидуальные и групповые)
 */
router.get('/archive', async (req, res) => {
    try {
        const { date_from, date_to, trainer_id } = req.query;
        const moment = require('moment-timezone');
        const TIMEZONE = 'Asia/Yekaterinburg';
        
        // Получаем текущее время в часовом поясе для фильтрации прошедших тренировок
        const nowInTimezone = moment().tz(TIMEZONE);
        const currentDateStr = nowInTimezone.format('YYYY-MM-DD');
        const currentTimeStr = nowInTimezone.format('HH:mm:ss');
        
        // По умолчанию показываем за текущий месяц
        let defaultDateFrom, defaultDateTo;
        if (!date_from || !date_to) {
            const startOfMonth = nowInTimezone.clone().startOf('month');
            const endOfMonth = nowInTimezone.clone().endOf('month');
            defaultDateFrom = startOfMonth.format('YYYY-MM-DD');
            defaultDateTo = endOfMonth.format('YYYY-MM-DD');
        }
        
        const params = [];
        let paramIndex = 1;
        
        // UNION запрос для объединения всех типов тренировок
        let query = `
            WITH archive_trainings AS (
                -- Старые тренировки из training_sessions (групповые)
                SELECT 
                    ts.id,
                    ts.session_date as date,
                    ts.start_time,
                    ts.end_time,
                    ts.duration,
                    FALSE as is_individual,
                    ts.winter_training_type,
                    ts.trainer_id,
                    t.full_name as trainer_name,
                    ts.group_id,
                    g.name as group_name,
                    ts.max_participants,
                    ts.skill_level,
                    ts.price,
                    ts.status,
                    COUNT(sp.id) as current_participants,
                    ts.slope_type,
                    COALESCE(STRING_AGG(DISTINCT COALESCE(ch.full_name, c.full_name), ', ') FILTER (WHERE sp.id IS NOT NULL), '') as participant_names,
                    NULL::TEXT as training_source,
                    NULL::TEXT as kuliga_type
                FROM training_sessions ts
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                    AND sp.status = 'confirmed'
                LEFT JOIN clients c ON sp.client_id = c.id
                LEFT JOIN children ch ON sp.child_id = ch.id
                WHERE ts.slope_type = 'natural_slope'
                    AND ts.training_type = TRUE
                    AND (
                        ts.session_date < '${currentDateStr}'::date 
                        OR (ts.session_date = '${currentDateStr}'::date AND ts.end_time < '${currentTimeStr}'::time)
                    )
                GROUP BY ts.id, ts.session_date, ts.start_time, ts.end_time, ts.duration, 
                         ts.training_type, ts.winter_training_type, ts.trainer_id, t.full_name,
                         ts.group_id, g.name, ts.max_participants, 
                         ts.skill_level, ts.price, ts.status, ts.slope_type
                
                UNION ALL
                
                -- Старые тренировки из training_sessions (индивидуальные)
                SELECT 
                    ts.id,
                    ts.session_date as date,
                    ts.start_time,
                    ts.end_time,
                    ts.duration,
                    TRUE as is_individual,
                    ts.winter_training_type,
                    ts.trainer_id,
                    t.full_name as trainer_name,
                    ts.group_id,
                    NULL::TEXT as group_name,
                    ts.max_participants,
                    ts.skill_level,
                    ts.price,
                    ts.status,
                    COUNT(sp.id) as current_participants,
                    ts.slope_type,
                    COALESCE(STRING_AGG(DISTINCT COALESCE(ch.full_name, c.full_name), ', ') FILTER (WHERE sp.id IS NOT NULL), '') as participant_names,
                    NULL::TEXT as training_source,
                    NULL::TEXT as kuliga_type
                FROM training_sessions ts
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                    AND sp.status = 'confirmed'
                LEFT JOIN clients c ON sp.client_id = c.id AND NOT sp.is_child
                LEFT JOIN children ch ON sp.child_id = ch.id AND sp.is_child
                WHERE ts.slope_type = 'natural_slope'
                    AND ts.training_type = FALSE
                    AND (
                        ts.session_date < '${currentDateStr}'::date 
                        OR (ts.session_date = '${currentDateStr}'::date AND ts.end_time < '${currentTimeStr}'::time)
                    )
                GROUP BY ts.id, ts.session_date, ts.start_time, ts.end_time, ts.duration, 
                         ts.training_type, ts.winter_training_type, ts.trainer_id, t.full_name,
                         ts.group_id, ts.max_participants, 
                         ts.skill_level, ts.price, ts.status, ts.slope_type
                
                UNION ALL
                
                -- Групповые тренировки Кулиги (прошедшие)
                SELECT 
                    kgt.id,
                    kgt.date,
                    kgt.start_time,
                    kgt.end_time,
                    EXTRACT(EPOCH FROM (kgt.end_time::time - kgt.start_time::time))/60 as duration,
                    FALSE as is_individual,
                    'group' as winter_training_type,
                    kgt.instructor_id as trainer_id,
                    ki.full_name as trainer_name,
                    NULL::INTEGER as group_id,
                    CASE kgt.sport_type
                        WHEN 'ski' THEN 'Групповая тренировка (Горные лыжи)'
                        WHEN 'snowboard' THEN 'Групповая тренировка (Сноуборд)'
                        ELSE CONCAT('Групповая тренировка (', kgt.sport_type, ')')
                    END as group_name,
                    kgt.max_participants,
                    CASE 
                        WHEN kgt.level ~ '^[0-9]+$' THEN kgt.level::INTEGER
                        WHEN kgt.level = 'beginner' THEN 1
                        WHEN kgt.level = 'intermediate' THEN 2
                        WHEN kgt.level = 'advanced' THEN 3
                        ELSE NULL
                    END::INTEGER as skill_level,
                    kgt.price_per_person * kgt.max_participants as price,
                    kgt.status,
                    COALESCE(SUM(kb.participants_count) FILTER (WHERE kb.status IN ('pending', 'confirmed')), 0)::INTEGER as current_participants,
                    'natural_slope' as slope_type,
                    COALESCE(
                        STRING_AGG(
                            DISTINCT array_to_string(kb.participants_names, ', '), 
                            ', '
                        ) FILTER (WHERE kb.status IN ('pending', 'confirmed') AND kb.participants_names IS NOT NULL),
                        ''
                    ) as participant_names,
                    'kuliga' as training_source,
                    'group' as kuliga_type
                FROM kuliga_group_trainings kgt
                LEFT JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
                LEFT JOIN kuliga_bookings kb ON kgt.id = kb.group_training_id
                    AND kb.status IN ('pending', 'confirmed', 'cancelled', 'refunded')
                WHERE (
                    kgt.date < '${currentDateStr}'::date 
                    OR (kgt.date = '${currentDateStr}'::date AND kgt.end_time < '${currentTimeStr}'::time)
                )
                GROUP BY kgt.id, kgt.date, kgt.start_time, kgt.end_time, kgt.instructor_id, 
                         kgt.max_participants, kgt.level, kgt.price_per_person,
                         kgt.sport_type, kgt.status, ki.full_name
                
                UNION ALL
                
                -- Индивидуальные тренировки Кулиги (прошедшие)
                SELECT 
                    kb.id,
                    kb.date,
                    kb.start_time,
                    kb.end_time,
                    EXTRACT(EPOCH FROM (kb.end_time::time - kb.start_time::time))/60 as duration,
                    TRUE as is_individual,
                    'individual' as winter_training_type,
                    kb.instructor_id as trainer_id,
                    ki.full_name as trainer_name,
                    NULL::INTEGER as group_id,
                    NULL::TEXT as group_name,
                    1 as max_participants,
                    NULL::INTEGER as skill_level,
                    kb.price_total as price,
                    kb.status,
                    kb.participants_count as current_participants,
                    'natural_slope' as slope_type,
                    COALESCE(array_to_string(kb.participants_names, ', '), '') as participant_names,
                    'kuliga' as training_source,
                    'individual' as kuliga_type
                FROM kuliga_bookings kb
                LEFT JOIN kuliga_instructors ki ON kb.instructor_id = ki.id
                WHERE kb.booking_type = 'individual'
                    AND (
                        kb.date < '${currentDateStr}'::date 
                        OR (kb.date = '${currentDateStr}'::date AND kb.end_time < '${currentTimeStr}'::time)
                    )
            )
            SELECT * FROM archive_trainings WHERE 1=1
        `;
        
        // Применяем фильтры
        if (date_from) {
            query += ` AND date >= $${paramIndex}`;
            params.push(date_from);
            paramIndex++;
        } else if (defaultDateFrom) {
            query += ` AND date >= $${paramIndex}`;
            params.push(defaultDateFrom);
            paramIndex++;
        }
        
        if (date_to) {
            query += ` AND date <= $${paramIndex}`;
            params.push(date_to);
            paramIndex++;
        } else if (defaultDateTo) {
            query += ` AND date <= $${paramIndex}`;
            params.push(defaultDateTo);
            paramIndex++;
        }
        
        if (trainer_id) {
            query += ` AND trainer_id = $${paramIndex}`;
            params.push(trainer_id);
            paramIndex++;
        }
        
        query += ` ORDER BY date DESC, start_time DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении архива зимних тренировок:', error);
        console.error('Детали ошибки:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail,
            hint: error.hint
        });
        res.status(500).json({ 
            error: 'Ошибка при получении архива тренировок',
            detail: error.message
        });
    }
});

/**
 * GET /api/winter-trainings/:id
 * Получение конкретной зимней тренировки
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            SELECT 
                ts.id,
                ts.session_date::text as session_date,
                ts.start_time,
                ts.end_time,
                ts.duration,
                ts.training_type,
                ts.winter_training_type,
                ts.trainer_id,
                ts.group_id,
                ts.max_participants,
                ts.skill_level,
                ts.price,
                ts.status,
                ts.slope_type,
                ts.equipment_type,
                ts.with_trainer,
                ts.simulator_id,
                ts.created_at,
                ts.updated_at,
                g.name as group_name,
                t.full_name as trainer_name,
                COUNT(sp.id) as current_participants
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id AND sp.status = 'confirmed'
            WHERE ts.id = $1 AND ts.slope_type = 'natural_slope'
            GROUP BY ts.id, ts.session_date, ts.start_time, ts.end_time, ts.duration,
                     ts.training_type, ts.winter_training_type, ts.trainer_id, ts.group_id, ts.max_participants,
                     ts.skill_level, ts.price, ts.status, ts.slope_type, ts.equipment_type, ts.with_trainer,
                     ts.simulator_id, ts.created_at, ts.updated_at, g.name, t.full_name
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }
        
        // Дата уже должна быть строкой благодаря ::text в SQL запросе
        const training = result.rows[0];
        // Убеждаемся, что дата в формате YYYY-MM-DD (без времени)
        if (training.session_date) {
            training.session_date = String(training.session_date).split('T')[0].split(' ')[0];
        }
        
        // Получаем участников тренировки
        // Для детей берем телефон родителя, для взрослых - их собственный телефон
        const participantsResult = await pool.query(`
            SELECT 
                sp.id,
                sp.client_id,
                sp.child_id,
                sp.is_child,
                sp.status,
                COALESCE(c.full_name, ch.full_name) as full_name,
                COALESCE(c.birth_date, ch.birth_date) as birth_date,
                CASE 
                    WHEN sp.is_child = true THEN parent.phone
                    ELSE c.phone
                END as phone,
                COALESCE(c.skill_level, ch.skill_level) as skill_level,
                c.telegram_id
            FROM session_participants sp
            LEFT JOIN clients c ON sp.client_id = c.id AND NOT sp.is_child
            LEFT JOIN children ch ON sp.child_id = ch.id AND sp.is_child
            LEFT JOIN clients parent ON ch.parent_id = parent.id
            WHERE sp.session_id = $1 AND sp.status = 'confirmed'
            ORDER BY sp.created_at ASC
        `, [id]);
        
        training.participants = participantsResult.rows;
        
        console.log('GET /api/winter-trainings/:id - возвращаемая дата:', {
            id: training.id,
            session_date: training.session_date,
            type: typeof training.session_date
        });
        
        res.json(training);
    } catch (error) {
        console.error('Ошибка при получении зимней тренировки:', error);
        res.status(500).json({ error: 'Ошибка при получении тренировки' });
    }
});

/**
 * PUT /api/winter-trainings/:id
 * Обновление зимней тренировки
 */
router.put('/:id', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { id } = req.params;
        const {
            session_date,
            start_time,
            end_time,
            duration,
            trainer_id,
            group_id,
            skill_level,
            max_participants,
            price
        } = req.body;
        
        // Получаем текущую тренировку для проверки
        const currentTraining = await client.query(
            'SELECT * FROM training_sessions WHERE id = $1 AND slope_type = $2',
            [id, 'natural_slope']
        );
        
        if (currentTraining.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }
        
        const training = currentTraining.rows[0];
        
        // Новая валидация: если меняются дата/время, должен существовать слот в winter_schedule
        const newDate = session_date || training.session_date;
        const newStart = start_time || training.start_time;
        if (newDate && newStart) {
            const timeSlot = String(newStart).substring(0, 5);
            const slotCheck = await client.query(
                `SELECT 1 FROM winter_schedule WHERE date = $1 AND time_slot = $2::time LIMIT 1`,
                [newDate, timeSlot]
            );
            if (slotCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'На новую дату/время нет слота в расписании' });
            }
        }
        
        // Обновляем тренировку в training_sessions
        // Для trainer_id и group_id: если передано значение - обновляем, если null - сохраняем старое
        // Явно приводим типы параметров для избежания ошибок
        const updateResult = await client.query(`
            UPDATE training_sessions SET
                session_date = COALESCE($1::date, session_date),
                start_time = COALESCE($2::time, start_time),
                end_time = COALESCE($3::time, end_time),
                duration = COALESCE($4::integer, duration),
                trainer_id = CASE WHEN $5::integer IS NULL THEN trainer_id ELSE $5::integer END,
                group_id = CASE WHEN $6::integer IS NULL THEN group_id ELSE $6::integer END,
                skill_level = CASE WHEN $7::integer IS NULL THEN skill_level ELSE $7::integer END,
                max_participants = COALESCE($8::integer, max_participants),
                price = COALESCE($9::decimal, price),
                updated_at = NOW()
            WHERE id = $10::integer AND slope_type = 'natural_slope'
            RETURNING *
        `, [
            session_date || null,
            start_time || null,
            end_time || null,
            duration ? parseInt(duration) : null,
            trainer_id !== undefined && trainer_id !== null && trainer_id !== '' ? parseInt(trainer_id) : null,
            group_id !== undefined && group_id !== null && group_id !== '' ? parseInt(group_id) : null,
            skill_level !== undefined && skill_level !== null && skill_level !== '' ? parseInt(skill_level) : null,
            max_participants ? parseInt(max_participants) : null,
            price ? parseFloat(price) : null,
            parseInt(id)
        ]);
        
        // Если это групповая тренировка, обновляем слот в winter_schedule
        if (training.training_type === true && training.winter_training_type === 'group') {
            const timeSlot = start_time ? start_time.substring(0, 5) : training.start_time.substring(0, 5);
            const trainingDate = session_date || training.session_date;
            
            // Обновляем или создаем слот в winter_schedule
            await client.query(`
                UPDATE winter_schedule SET
                    date = $1,
                    time_slot = $2,
                    trainer_id = $3,
                    group_id = $4,
                    max_participants = $5,
                    updated_at = NOW()
                WHERE id IN (
                    SELECT ws.id FROM winter_schedule ws
                    WHERE ws.date = $6
                    AND ws.time_slot = $7::time
                    AND ws.is_group_training = true
                    LIMIT 1
                )
            `, [
                trainingDate,
                timeSlot,
                trainer_id !== undefined && trainer_id !== '' ? trainer_id : null,
                group_id !== undefined && group_id !== '' ? group_id : null,
                max_participants || training.max_participants,
                training.session_date,
                training.start_time.substring(0, 5)
            ]);
        }
        
        await client.query('COMMIT');
        
        const updatedTraining = updateResult.rows[0];
        console.log(`✅ Обновлена зимняя тренировка: ID=${id}`, {
            date: updatedTraining.session_date,
            time: updatedTraining.start_time,
            trainer_id: updatedTraining.trainer_id,
            group_id: updatedTraining.group_id
        });
        
        res.json(updatedTraining);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении зимней тренировки:', error);
        res.status(500).json({ 
            error: 'Ошибка при обновлении тренировки: ' + error.message 
        });
    } finally {
        client.release();
    }
});

/**
 * DELETE /api/winter-trainings/:id
 * Удаление зимней тренировки (естественный склон)
 * - Запрещаем удаление, если есть подтвержденные участники
 * - Очищаем связанные записи и слот в winter_schedule (для групповой)
 */
router.delete('/:id', async (req, res) => {
    const client = await pool.connect();
    const { id } = req.params;

    try {
        await client.query('BEGIN');

        // 1) Находим тренировку и блокируем строку
        const tsResult = await client.query(
            `SELECT id, session_date, start_time, end_time, duration, 
                    training_type, winter_training_type, price, max_participants, 
                    trainer_id, skill_level, group_id
             FROM training_sessions
             WHERE id = $1 AND slope_type = 'natural_slope'
             FOR UPDATE`,
            [id]
        );

        if (tsResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }

        const training = tsResult.rows[0];
        
        // 1.1) Получаем дополнительную информацию о тренировке
        const infoResult = await client.query(
            `SELECT 
                t.full_name as trainer_name,
                g.name as group_name,
                COUNT(sp.id) FILTER (WHERE sp.status = 'confirmed') as current_participants
             FROM training_sessions ts
             LEFT JOIN trainers t ON ts.trainer_id = t.id
             LEFT JOIN groups g ON ts.group_id = g.id
             LEFT JOIN session_participants sp ON ts.id = sp.session_id
             WHERE ts.id = $1
             GROUP BY t.full_name, g.name`,
            [id]
        );
        
        if (infoResult.rows.length > 0) {
            training.trainer_name = infoResult.rows[0].trainer_name;
            training.group_name = infoResult.rows[0].group_name;
            training.current_participants = parseInt(infoResult.rows[0].current_participants) || 0;
        }

        // 2) Получаем подтвержденных участников (если есть)
        const participantsResult = await client.query(
            `SELECT sp.id,
                    sp.client_id,
                    sp.child_id,
                    sp.is_child,
                    COALESCE(ch.full_name, c.full_name) as participant_name,
                    COALESCE(parent.telegram_id, c.telegram_id) as telegram_id,
                    c.phone as client_phone,
                    COALESCE(parent.full_name, c.full_name) as parent_name,
                    COALESCE(parent.phone, c.phone) as parent_phone,
                    w.id as wallet_id,
                    w.balance
             FROM session_participants sp
             LEFT JOIN clients c ON sp.client_id = c.id AND NOT sp.is_child
             LEFT JOIN children ch ON sp.child_id = ch.id AND sp.is_child
             LEFT JOIN clients parent ON ch.parent_id = parent.id AND sp.is_child
             LEFT JOIN wallets w ON COALESCE(parent.id, c.id) = w.client_id
             WHERE sp.session_id = $1 AND sp.status = 'confirmed'`,
            [id]
        );
        const confirmedParticipants = participantsResult.rows || [];

        // 3) Возвраты и уведомления, если были подтвержденные участники
        const dateObj = new Date(training.session_date);
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][dateObj.getDay()];
        const formattedDate = `${dateObj.getDate().toString().padStart(2,'0')}.${(dateObj.getMonth()+1).toString().padStart(2,'0')}.${dateObj.getFullYear()}`;
        const startTime = String(training.start_time).substring(0,5);
        const duration = training.duration || 60;
        const adminPhone = process.env.ADMIN_PHONE || '+79123924956';

        if (confirmedParticipants.length > 0) {
            for (const p of confirmedParticipants) {
                const walletId = p.wallet_id;
                if (!walletId) continue;
                
                // Проверяем, использовался ли абонемент для этого участника
                const subscriptionUsageCheck = await client.query(
                    `SELECT 
                        nsu.*,
                        ns.remaining_sessions,
                        ns.status as subscription_status,
                        st.name as subscription_name,
                        st.sessions_count as total_sessions
                     FROM natural_slope_subscription_usage nsu
                     JOIN natural_slope_subscriptions ns ON nsu.subscription_id = ns.id
                     JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
                     WHERE nsu.session_participant_id = $1
                     AND ns.client_id = $2`,
                    [p.id, p.client_id]
                );
                
                let usedSubscription = false;
                let subscriptionInfo = null;
                let refundAmount = 0;
                let refundType = 'refund';
                let refundDescription = '';
                
                if (subscriptionUsageCheck.rows.length > 0) {
                    // Использовался абонемент - возвращаем занятие
                    usedSubscription = true;
                    subscriptionInfo = subscriptionUsageCheck.rows[0];
                    
                    // Возвращаем занятие в абонемент
                    await client.query(
                        `UPDATE natural_slope_subscriptions 
                         SET remaining_sessions = remaining_sessions + 1,
                             status = CASE 
                                WHEN expires_at >= CURRENT_DATE THEN 'active'
                                ELSE status
                             END
                         WHERE id = $1`,
                        [subscriptionInfo.subscription_id]
                    );
                    
                    // Удаляем запись использования
                    await client.query(
                        `DELETE FROM natural_slope_subscription_usage 
                         WHERE id = $1`,
                        [subscriptionInfo.id]
                    );
                    
                    const remainingSessions = subscriptionInfo.remaining_sessions + 1;
                    refundType = 'subscription_return';
                    refundAmount = 0;
                    refundDescription = `Возврат занятия в абонемент: ${training.training_type ? 'Группа (Кулига Парк)' : 'Индивидуальная (Кулига Парк)'}, ${p.participant_name}, Дата: ${formattedDate}, Время: ${startTime}, Длительность: ${training.duration || duration} мин. Занятий осталось: ${remainingSessions}/${subscriptionInfo.total_sessions}`;
                    
                    // Создаем транзакцию для отчетности
                    await client.query(
                        'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                        [walletId, refundAmount, refundType, refundDescription]
                    );
                    
                    console.log(`✅ Возвращено занятие в абонемент ID ${subscriptionInfo.subscription_id} для участника ${p.id}`);
                } else {
                    // Не использовался абонемент - возвращаем деньги
                    // Идемпотентность: проверяем, не делали ли уже возврат по этой тренировке этому участнику
                    const refundCheck = await client.query(
                        `SELECT 1 FROM transactions 
                         WHERE wallet_id = $1 AND description ILIKE $2`,
                        [walletId, `%${formattedDate}%${startTime}%${p.participant_name}%`]
                    );
                    if (refundCheck.rows.length === 0) {
                        const totalPrice = Number.parseFloat(training.price || 0) || 0;
                        refundAmount = training.training_type === true
                            ? (training.max_participants ? totalPrice / training.max_participants : totalPrice)
                            : totalPrice;
                        refundType = 'refund';
                        refundDescription = `Возврат: ${training.training_type ? 'Группа (Кулига Парк)' : 'Индивидуальная (Кулига Парк)'}, ${p.participant_name}, Дата: ${formattedDate}, Время: ${startTime}, Длительность: ${training.duration || duration} мин.`;
                        
                        await client.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [walletId, refundAmount, refundType, refundDescription]
                        );
                        // Обновляем баланс кошелька
                        await client.query('UPDATE wallets SET balance = balance + $1 WHERE id = $2', [refundAmount, walletId]);
                    }
                }
                // Уведомление клиенту (best-effort)
                try {
                    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
                    if (TELEGRAM_BOT_TOKEN && p.telegram_id) {
                        // Формируем сообщение согласно требованиям
                        let text = `❗️ К сожалению, мы вынуждены отменить вашу тренировку на естественном склоне в Кулига Парк:\n\n`;
                        text += `👤 *Участник:* ${p.participant_name}\n`;
                        text += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                        text += `⏰ *Время:* ${startTime}\n`;
                        text += `⏱️ *Длительность:* ${duration} минут\n`;
                        
                        // Добавляем информацию о группе (только для групповых тренировок)
                        if (training.training_type === true && training.group_name) {
                            text += `👥 *Группа:* ${training.group_name}\n`;
                        }
                        
                        // Добавляем информацию о тренере (если есть)
                        if (training.trainer_name) {
                            text += `👨‍🏫 *Тренер:* ${training.trainer_name}\n`;
                        }
                        
                        // Добавляем уровень (если есть)
                        if (training.skill_level) {
                            text += `📊 *Уровень:* ${training.skill_level}\n`;
                        }
                        
                        // Добавляем информацию о возврате
                        if (usedSubscription) {
                            text += `🎫 *Абонемент:* Занятие возвращено в "${subscriptionInfo.subscription_name}"\n`;
                            text += `📊 *Занятий осталось:* ${subscriptionInfo.remaining_sessions + 1}/${subscriptionInfo.total_sessions}\n\n`;
                            text += `Занятие возвращено в абонемент.\n\n`;
                        } else {
                            text += `💰 *Возвращено:* ${refundAmount.toFixed(0)} руб.\n\n`;
                            text += `Деньги в размере ${refundAmount.toFixed(0)} руб. возвращены на ваш счет.\n\n`;
                        }
                        
                        text += `Тренировка могла быть отменена из-за недобора группы или болезни тренера.\n\n`;
                        text += `Подробнее вы можете уточнить у администратора: ${adminPhone}`;
                        
                        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: p.telegram_id, text, parse_mode: 'Markdown' })
                        });
                    }
                } catch (error) {
                    console.error('Ошибка при отправке уведомления клиенту:', error);
                }

                // Уведомление администратору по каждому участнику
                try {
                    const { notifyAdminNaturalSlopeTrainingCancellation } = require('../bot/admin-notify');
                    
                    // parent_name уже содержит имя родителя (для детей) или клиента (для взрослых) благодаря COALESCE
                    // parent_phone аналогично содержит телефон родителя (для детей) или клиента (для взрослых)
                    const clientName = p.parent_name || '—';
                    const clientPhone = p.is_child ? (p.parent_phone || '—') : (p.client_phone || '—');
                    
                    await notifyAdminNaturalSlopeTrainingCancellation({
                        client_name: clientName,
                        participant_name: p.participant_name,
                        client_phone: clientPhone,
                        date: training.session_date,
                        time: startTime,
                        trainer_name: training.trainer_name || null,
                        group_name: training.group_name || null,
                        refund: usedSubscription ? null : refundAmount,
                        used_subscription: usedSubscription,
                        subscription_name: usedSubscription ? subscriptionInfo.subscription_name : null,
                        subscription_remaining_sessions: usedSubscription ? (subscriptionInfo.remaining_sessions + 1) : null,
                        subscription_total_sessions: usedSubscription ? subscriptionInfo.total_sessions : null
                    });
                } catch (e) { 
                    console.error('Ошибка при отправке уведомления администратору:', e);
                }
            }
        }

        // 4) Удаляем всех участников (и черновых и подтвержденных)
        await client.query('DELETE FROM session_participants WHERE session_id = $1', [id]);

        // 5) Освобождаем соответствующий слот в winter_schedule
        if (training.training_type === true && training.winter_training_type === 'group') {
            const timeSlot = String(training.start_time).substring(0, 5); // ЧЧ:ММ
            await client.query(
                `UPDATE winter_schedule 
                 SET 
                    is_available = true,
                    is_individual_training = true,
                    is_group_training = false,
                    group_id = NULL,
                    trainer_id = NULL,
                    max_participants = 1,
                    current_participants = 0,
                    updated_at = NOW()
                 WHERE date = $1 
                   AND time_slot = $2::time`,
                [training.session_date, timeSlot]
            );
        } else {
            // Индивидуальная — просто возвращаем слот в свободное состояние
            const timeSlot = String(training.start_time).substring(0, 5); // ЧЧ:ММ
            await client.query(
                `UPDATE winter_schedule 
                 SET 
                    is_available = true,
                    current_participants = 0,
                    updated_at = NOW()
                 WHERE date = $1 
                   AND time_slot = $2::time 
                   AND is_individual_training = true`,
                [training.session_date, timeSlot]
            );
        }

        // 6) Удаляем саму тренировку
        await client.query('DELETE FROM training_sessions WHERE id = $1', [id]);

        await client.query('COMMIT');

        // Уведомление администратору (best-effort) только если не было участников
        if (confirmedParticipants.length === 0) {
            try {
                const { notifyAdminNaturalSlopeTrainingCancellation } = require('../bot/admin-notify');
                await notifyAdminNaturalSlopeTrainingCancellation({
                    client_name: '—',
                    participant_name: '—',
                    client_phone: '—',
                    date: training.session_date,
                    time: String(training.start_time).substring(0,5),
                    trainer_name: null,
                    refund: 0
                });
            } catch (e) { /* ignore */ }
        }

        return res.json({ success: true, refunds: confirmedParticipants.length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при удалении зимней тренировки:', error);
        return res.status(500).json({ error: 'Ошибка при удалении тренировки' });
    } finally {
        client.release();
    }
});

module.exports = router;

