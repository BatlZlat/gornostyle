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
        group_id,               // добавляем group_id
        price                   // теперь берем из запроса
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

        let { start_time, end_time } = timeSlotResult.rows[0];

        // Проверяем длительность слота
        const [sh, sm, ss] = start_time.split(':').map(Number);
        const [eh, em, es] = end_time.split(':').map(Number);
        const startDate = new Date(2000, 0, 1, sh, sm, ss || 0);
        const endDate = new Date(2000, 0, 1, eh, em, es || 0);
        let diff = (endDate - startDate) / 60000;
        if (diff < 59) {
            // Если слот короче 60 минут, вычисляем end_time = start_time + 60 минут
            const newEnd = new Date(startDate.getTime() + 60 * 60000);
            end_time = newEnd.toTimeString().slice(0, 5) + ':00';
        }

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

        // Логируем итоговые значения
        console.log('Вставляем в training_sessions:', {
            simulator_id,
            trainer_id,
            group_id,
            date,
            start_time,
            end_time,
            duration: 60,
            training_type,
            max_participants: max_participants || 1,
            skill_level: skill_level || 1,
            price,
            equipment_type: 'ski'
        });

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
                60, // всегда 60 минут
                training_type,
                max_participants || 1,
                skill_level || 1,
                price || 0,
                'ski'
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

// Получение тренировок
router.get('/', async (req, res) => {
    const { date, date_from, date_to, type } = req.query;

    // Если передан диапазон дат
    if (date_from && date_to) {
        try {
            let query = `
                SELECT ts.*, g.name as group_name, g.description as group_description
                FROM training_sessions ts
                LEFT JOIN groups g ON ts.group_id = g.id
                WHERE ts.session_date >= $1 AND ts.session_date <= $2
            `;
            const params = [date_from, date_to];

            if (type === 'group') {
                query += ' AND ts.training_type = true';
            } else if (type === 'individual') {
                query += ' AND ts.training_type = false';
            }

            query += ' ORDER BY ts.session_date, ts.start_time';

            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (error) {
            console.error('Ошибка при получении тренировок (диапазон):', error);
            res.status(500).json({ error: 'Внутренняя ошибка сервера' });
        }
        return;
    }

    // Если передан только date (старый режим)
    if (date) {
        try {
            let query = `
                SELECT ts.*, g.name as group_name, g.description as group_description
                FROM training_sessions ts
                LEFT JOIN groups g ON ts.group_id = g.id
                WHERE ts.session_date = $1
            `;
            const params = [date];

            if (type === 'group') {
                query += ' AND ts.training_type = true';
            } else if (type === 'individual') {
                query += ' AND ts.training_type = false';
            }

            query += ' ORDER BY ts.start_time';

            const result = await pool.query(query, params);
            res.json(result.rows);
        } catch (error) {
            console.error('Ошибка при получении тренировок:', error);
            res.status(500).json({ error: 'Внутренняя ошибка сервера' });
        }
        return;
    }

    // Если не передано ни date, ни date_from/date_to
    return res.status(400).json({ error: 'Необходимо указать дату или диапазон дат' });
});

// Получение одной тренировки по id
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT ts.*, g.name as group_name, g.description as group_description
            FROM training_sessions ts
            LEFT JOIN groups g ON ts.group_id = g.id
            WHERE ts.id = $1
        `, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении тренировки по id:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление тренировки по id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const {
        start_time,
        end_time,
        group_name, // не обновляем в таблице, только для отображения
        trainer_name, // не обновляем в таблице, только для отображения
        simulator_id,
        max_participants,
        skill_level,
        price
    } = req.body;
    try {
        // Обновляем только основные поля
        const result = await pool.query(
            `UPDATE training_sessions SET
                start_time = $1,
                end_time = $2,
                simulator_id = $3,
                max_participants = $4,
                skill_level = $5,
                price = $6,
                updated_at = NOW()
            WHERE id = $7
            RETURNING *`,
            [start_time, end_time, simulator_id, max_participants, skill_level, price, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }
        res.json({ message: 'Тренировка обновлена', training: result.rows[0] });
    } catch (error) {
        console.error('Ошибка при обновлении тренировки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 