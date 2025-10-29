const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

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
        
        // Если это групповая тренировка, создаем слот в winter_schedule
        if (isGroupTraining && winter_training_type === 'group') {
            // Преобразуем start_time в time_slot для winter_schedule
            // Формат должен быть ЧЧ:ММ (например, '14:30'), а не ЧЧ:ММ:СС
            let timeSlot = start_time.substring(0, 5); // Берем только ЧЧ:ММ
            
            // Проверяем, что время соответствует допустимым значениям
            const validTimeSlots = ['10:30', '12:00', '14:30', '16:00', '17:30', '19:00'];
            if (!validTimeSlots.includes(timeSlot)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: `Недопустимое время слота: ${timeSlot}. Допустимые значения: ${validTimeSlots.join(', ')}` 
                });
            }
            
            await client.query(`
                INSERT INTO winter_schedule (
                    date,
                    time_slot,
                    is_group_training,
                    is_individual_training,
                    group_id,
                    trainer_id,
                    max_participants,
                    current_participants,
                    is_available,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            `, [
                session_date,
                timeSlot,
                true,  // is_group_training
                false, // is_individual_training
                group_id || null,
                trainer_id || null,
                max_participants || 1,
                0,      // current_participants (начинаем с 0)
                true    // is_available
            ]);
            
            console.log(`✅ Создан слот в winter_schedule для групповой тренировки ID=${newTraining.id}`);
        }
        
        await client.query('COMMIT');
        
        console.log(`✅ Создана зимняя тренировка: ID=${newTraining.id}, тип=${winter_training_type}, дата=${session_date}, время=${start_time}`);
        
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
 * GET /api/winter-trainings/:id
 * Получение конкретной зимней тренировки
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            SELECT ts.*, 
                   g.name as group_name,
                   t.full_name as trainer_name,
                   COUNT(sp.id) as current_participants
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id AND sp.status = 'confirmed'
            WHERE ts.id = $1 AND ts.slope_type = 'natural_slope'
            GROUP BY ts.id, g.name, t.full_name
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }
        
        res.json(result.rows[0]);
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
        
        // Валидация: проверяем, что дата является выходным днем (СБ или ВС), если дата обновляется
        if (session_date) {
            const trainingDate = new Date(session_date);
            const dayOfWeek = trainingDate.getUTCDay(); // 0 = ВС, 6 = СБ
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: 'Тренировки на естественном склоне возможны только на выходные дни (Суббота и Воскресенье)' 
                });
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
 * GET /api/winter-trainings/archive
 * Получение архива зимних тренировок (прошедших тренировок)
 */
router.get('/archive', async (req, res) => {
    try {
        const { date_from, date_to, trainer_id } = req.query;
        
        let query = `
            SELECT 
                ts.id,
                ts.session_date as date,
                ts.start_time,
                ts.end_time,
                ts.duration,
                ts.training_type as is_group,
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
                STRING_AGG(DISTINCT COALESCE(ch.full_name, c.full_name), ', ') FILTER (WHERE sp.id IS NOT NULL) as participant_names
            FROM training_sessions ts
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                AND sp.status = 'confirmed'
            LEFT JOIN clients c ON sp.client_id = c.id
            LEFT JOIN children ch ON sp.child_id = ch.id
            WHERE ts.slope_type = 'natural_slope'
                AND (
                    ts.session_date < CURRENT_DATE 
                    OR (ts.session_date = CURRENT_DATE AND ts.end_time < CURRENT_TIME)
                )
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (date_from) {
            query += ` AND ts.session_date >= $${paramIndex}`;
            params.push(date_from);
            paramIndex++;
        } else {
            // По умолчанию показываем тренировки за последние 30 дней
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            query += ` AND ts.session_date >= $${paramIndex}`;
            params.push(thirtyDaysAgo.toISOString().split('T')[0]);
            paramIndex++;
        }
        
        if (date_to) {
            query += ` AND ts.session_date <= $${paramIndex}`;
            params.push(date_to);
            paramIndex++;
        }
        
        if (trainer_id) {
            query += ` AND ts.trainer_id = $${paramIndex}`;
            params.push(trainer_id);
            paramIndex++;
        }
        
        query += `
            GROUP BY ts.id, t.full_name, g.name, ts.session_date, ts.start_time, ts.end_time, ts.duration, 
                     ts.training_type, ts.winter_training_type, ts.trainer_id, ts.group_id, ts.max_participants, 
                     ts.skill_level, ts.price, ts.status, ts.slope_type
            ORDER BY ts.session_date DESC, ts.start_time DESC
        `;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении архива зимних тренировок:', error);
        res.status(500).json({ error: 'Ошибка при получении архива тренировок' });
    }
});

module.exports = router;

