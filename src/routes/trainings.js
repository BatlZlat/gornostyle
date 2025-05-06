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

        // Получаем время начала из time_slot_id
        const timeSlotResult = await client.query(
            'SELECT start_time FROM schedule WHERE id = $1',
            [time_slot_id]
        );

        if (timeSlotResult.rows.length === 0) {
            return res.status(400).json({ error: 'Временной слот не найден' });
        }

        let start_time = timeSlotResult.rows[0].start_time;
        
        // Вычисляем end_time как start_time + 60 минут
        const [hours, minutes] = start_time.split(':').map(Number);
        const startDate = new Date(2000, 0, 1, hours, minutes);
        const endDate = new Date(startDate.getTime() + 60 * 60000);
        const end_time = endDate.toTimeString().slice(0, 5) + ':00';

        // Для групповой тренировки проверяем, что следующий слот доступен
        if (training_type) {
            const nextSlotResult = await client.query(
                `SELECT id FROM schedule 
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
        // Бронируем все слоты между start_time и end_time
        await client.query(
            `UPDATE schedule 
             SET is_booked = true 
             WHERE simulator_id = $1 
             AND date = $2 
             AND start_time >= $3 
             AND start_time < $4`,
            [simulator_id, date, start_time, end_time]
        );

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
                SELECT ts.*, 
                       g.name as group_name, 
                       g.description as group_description,
                       t.full_name as trainer_full_name
                FROM training_sessions ts
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN trainers t ON ts.trainer_id = t.id
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
                SELECT ts.*, 
                       g.name as group_name, 
                       g.description as group_description,
                       t.full_name as trainer_full_name
                FROM training_sessions ts
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN trainers t ON ts.trainer_id = t.id
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
        simulator_id,
        trainer_id,
        group_id,
        max_participants,
        skill_level,
        price
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Проверяем, не занят ли тренажер в это время (исключая текущую тренировку)
        const checkResult = await client.query(
            `SELECT id FROM training_sessions 
             WHERE simulator_id = $1 
             AND session_date = (SELECT session_date FROM training_sessions WHERE id = $2)
             AND ((start_time, end_time) OVERLAPS ($3::time, $4::time))
             AND id != $2`,
            [simulator_id, id, start_time, end_time]
        );

        if (checkResult.rows.length > 0) {
            return res.status(400).json({ error: 'Тренажер уже занят в это время' });
        }

        // Обновляем тренировку
        const result = await client.query(
            `UPDATE training_sessions SET
                start_time = $1,
                end_time = $2,
                simulator_id = $3,
                trainer_id = $4,
                group_id = $5,
                max_participants = $6,
                skill_level = $7,
                price = $8,
                updated_at = NOW()
            WHERE id = $9
            RETURNING *`,
            [start_time, end_time, simulator_id, trainer_id, group_id, max_participants, skill_level, price, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }

        // Обновляем слоты в расписании
        // Сначала освобождаем старые слоты
        const oldTraining = await client.query(
            'SELECT simulator_id, session_date, start_time, end_time FROM training_sessions WHERE id = $1',
            [id]
        );

        if (oldTraining.rows.length > 0) {
            const old = oldTraining.rows[0];
            await client.query(
                `UPDATE schedule 
                 SET is_booked = false 
                 WHERE simulator_id = $1 
                 AND date = $2 
                 AND start_time >= $3 
                 AND start_time < $4`,
                [old.simulator_id, old.session_date, old.start_time, old.end_time]
            );
        }

        // Бронируем новые слоты
        await client.query(
            `UPDATE schedule 
             SET is_booked = true 
             WHERE simulator_id = $1 
             AND date = (SELECT session_date FROM training_sessions WHERE id = $2)
             AND start_time >= $3 
             AND start_time < $4`,
            [simulator_id, id, start_time, end_time]
        );

        await client.query('COMMIT');
        res.json({ message: 'Тренировка обновлена', training: result.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении тренировки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } finally {
        client.release();
    }
});

// Удаление тренировки
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Получаем информацию о тренировке
        const trainingResult = await client.query(
            'SELECT simulator_id, session_date, start_time, end_time, training_type FROM training_sessions WHERE id = $1',
            [id]
        );

        if (trainingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Тренировка не найдена' });
        }

        const training = trainingResult.rows[0];

        // Освобождаем все слоты в расписании между start_time и end_time
        await client.query(
            `UPDATE schedule 
             SET is_booked = false 
             WHERE simulator_id = $1 
             AND date = $2 
             AND start_time >= $3 
             AND start_time < $4`,
            [
                training.simulator_id, 
                training.session_date, 
                training.start_time, 
                training.end_time
            ]
        );

        // Удаляем тренировку
        await client.query('DELETE FROM training_sessions WHERE id = $1', [id]);

        await client.query('COMMIT');
        res.json({ message: 'Тренировка успешно удалена' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при удалении тренировки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } finally {
        client.release();
    }
});

module.exports = router; 