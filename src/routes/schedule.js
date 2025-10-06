const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Получение временных слотов для конкретной даты
router.get('/', async (req, res) => {
    const { date, simulator_id } = req.query;

    if (!date) {
        return res.status(400).json({ error: 'Необходимо указать дату' });
    }

    try {
        let query = `SELECT id, simulator_id, start_time, end_time, is_holiday, is_booked 
                     FROM schedule 
                     WHERE date = $1`;
        const params = [date];
        if (simulator_id) {
            query += ' AND simulator_id = $2';
            params.push(simulator_id);
        }
        query += ' ORDER BY simulator_id, start_time';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении временных слотов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Новый эндпоинт для админ-панели
router.get('/admin', async (req, res) => {
    try {
        const query = `
            WITH future_trainings AS (
                -- Групповые тренировки
                SELECT 
                    ts.id,
                    ts.session_date as date,
                    ts.start_time,
                    ts.end_time,
                    ts.duration,
                    FALSE as is_individual,
                    ts.trainer_id,
                    t.full_name as trainer_name,
                    ts.simulator_id,
                    s.name as simulator_name,
                    ts.max_participants,
                    ts.skill_level,
                    ts.price,
                    ts.equipment_type,
                    ts.with_trainer,
                    g.name as group_name,
                    COUNT(sp.id) as current_participants
                FROM training_sessions ts
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                LEFT JOIN simulators s ON ts.simulator_id = s.id
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN session_participants sp ON ts.id = sp.session_id 
                    AND sp.status = 'confirmed'
                WHERE ts.session_date >= CURRENT_DATE
                    AND ts.session_date <= CURRENT_DATE + INTERVAL '7 days'
                    AND ts.status = 'scheduled'
                GROUP BY ts.id, t.full_name, s.name, g.name

                UNION ALL

                -- Индивидуальные тренировки
                SELECT 
                    its.id,
                    its.preferred_date as date,
                    its.preferred_time as start_time,
                    (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
                    its.duration,
                    TRUE as is_individual,
                    NULL as trainer_id,
                    NULL as trainer_name,
                    its.simulator_id,
                    s.name as simulator_name,
                    1 as max_participants,
                    NULL as skill_level,
                    its.price,
                    its.equipment_type,
                    its.with_trainer,
                    NULL as group_name,
                    1 as current_participants
                FROM individual_training_sessions its
                LEFT JOIN simulators s ON its.simulator_id = s.id
                WHERE its.preferred_date >= CURRENT_DATE
                    AND its.preferred_date <= CURRENT_DATE + INTERVAL '7 days'
            )
            SELECT *
            FROM future_trainings
            ORDER BY date, start_time;
        `;

        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении расписания для админ-панели:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получение диапазона существующего расписания
router.get('/range', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT MIN(date) as min_date, MAX(date) as max_date 
             FROM schedule 
             WHERE date >= CURRENT_DATE`
        );
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении диапазона расписания:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 