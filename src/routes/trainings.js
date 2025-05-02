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
        training_type,          // переименовано с is_group_session
        group_id               // добавляем group_id
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Получаем время начала и конца из time_slot_id
        const timeSlotResult = await client.query(
            'SELECT start_time, end_time FROM schedule WHERE id = $1',
            [time_slot_id]
        );

        if (timeSlotResult.rows.length === 0) {
            return res.status(400).json({ error: 'Временной слот не найден' });
        }

        const { start_time, end_time } = timeSlotResult.rows[0];

        // Для групповой тренировки проверяем, что выбран следующий слот
        if (training_type) {
            const nextSlotResult = await client.query(
                `SELECT id, start_time, end_time 
                 FROM schedule 
                 WHERE simulator_id = $1 
                 AND date = $2 
                 AND start_time = $3 
                 AND is_booked = false 
                 AND is_holiday = false`,
                [simulator_id, date, end_time]
            );

            if (nextSlotResult.rows.length === 0) {
                return res.status(400).json({ error: 'Следующий слот недоступен для групповой тренировки' });
            }
        }

        // Проверяем, не занят ли тренажер в это время
        const checkResult = await client.query(
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
        const result = await client.query(
            `INSERT INTO training_sessions (
                simulator_id, trainer_id, group_id, session_date, 
                start_time, end_time, duration,
                training_type, max_participants, 
                skill_level, price, equipment_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id`,
            [
                simulator_id,
                trainer_id,
                group_id,
                date,
                start_time,
                end_time,
                training_type ? 60 : 30, // 60 минут для групповой, 30 для индивидуальной
                training_type,
                max_participants || 1,
                skill_level || 1,
                0, // price по умолчанию
                'ski' // equipment_type по умолчанию
            ]
        );

        // Бронируем слоты в расписании
        if (training_type) {
            // Для групповой тренировки бронируем два слота
            await client.query(
                `UPDATE schedule 
                 SET is_booked = true 
                 WHERE simulator_id = $1 
                 AND date = $2 
                 AND start_time IN ($3, $4)`,
                [simulator_id, date, start_time, end_time]
            );
        } else {
            // Для индивидуальной тренировки бронируем один слот
            await client.query(
                `UPDATE schedule 
                 SET is_booked = true 
                 WHERE simulator_id = $1 
                 AND date = $2 
                 AND start_time = $3`,
                [simulator_id, date, start_time]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({ 
            message: 'Тренировка успешно создана',
            training_id: result.rows[0].id 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании тренировки:', error);
        res.status(500).json({ 
            error: 'Ошибка при создании тренировки',
            details: error.message
        });
    } finally {
        client.release();
    }
});

// Получение списка тренировок
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.*, s.name as simulator_name, tr.full_name as trainer_name, g.name as group_name
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