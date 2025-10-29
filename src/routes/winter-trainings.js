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

module.exports = router;

