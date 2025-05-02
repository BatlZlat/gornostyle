const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Создание новой тренировки
router.post('/', async (req, res) => {
    console.log('Получены данные для создания тренировки:', req.body);
    
    const {
        date,                    // переименовываем в session_date
        simulator_id,
        time_slot_id,           // получаем start_time и end_time из time_slot_id
        skill_level,
        trainer_id,
        max_participants,
        is_group_session
    } = req.body;

    try {
        // Получаем время начала и конца из time_slot_id
        const timeSlotResult = await pool.query(
            'SELECT start_time, end_time FROM schedule WHERE id = $1',
            [time_slot_id]
        );

        if (timeSlotResult.rows.length === 0) {
            return res.status(400).json({ error: 'Временной слот не найден' });
        }

        const { start_time, end_time } = timeSlotResult.rows[0];

        // Проверяем, не занят ли тренажер в это время
        const checkResult = await pool.query(
            `SELECT id FROM training_sessions 
             WHERE simulator_id = $1 
             AND session_date = $2 
             AND ((start_time, end_time) OVERLAPS ($3::time, $4::time))`,
            [simulator_id, date, start_time, end_time]
        );

        if (checkResult.rows.length > 0) {
            return res.status(400).json({ error: 'Тренажер уже занят в это время' });
        }

        // Создаем тренировку
        const result = await pool.query(
            `INSERT INTO training_sessions (
                simulator_id, trainer_id, session_date, 
                start_time, end_time, duration,
                is_group_session, max_participants, 
                skill_level, price, equipment_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`,
            [
                simulator_id,
                trainer_id,
                date,
                start_time,
                end_time,
                60, // duration по умолчанию
                is_group_session,
                max_participants || 1,
                skill_level || 1,
                0, // price по умолчанию
                'ski' // equipment_type по умолчанию
            ]
        );

        res.status(201).json({ 
            message: 'Тренировка успешно создана',
            training_id: result.rows[0].id 
        });
    } catch (error) {
        console.error('Ошибка при создании тренировки:', error);
        res.status(500).json({ 
            error: 'Ошибка при создании тренировки',
            details: error.message
        });
    }
});

// Получение списка тренировок
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.*, s.name as simulator_name, tr.name as trainer_name, g.name as group_name
             FROM training_sessions t
             LEFT JOIN simulators s ON t.simulator_id = s.id
             LEFT JOIN trainers tr ON t.trainer_id = tr.id
             LEFT JOIN groups g ON t.group_id = g.id
             ORDER BY t.session_date DESC, t.start_time DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении списка тренировок:', error);
        res.status(500).json({ error: 'Ошибка при получении списка тренировок' });
    }
});

module.exports = router; 