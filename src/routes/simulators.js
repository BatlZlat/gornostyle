const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Получение списка всех тренажеров
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM simulators ORDER BY id');
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении списка тренажеров:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление статуса тренажера
router.put('/:id/status', async (req, res) => {
    const { id } = req.params;
    const { is_working } = req.body;

    if (typeof is_working !== 'boolean') {
        return res.status(400).json({ error: 'Неверный статус тренажера' });
    }

    try {
        const result = await pool.query(
            'UPDATE simulators SET is_working = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            [is_working, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренажер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при обновлении статуса тренажера:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление рабочих часов тренажера
router.put('/:id/hours', async (req, res) => {
    const { id } = req.params;
    const { working_hours_start, working_hours_end } = req.body;

    if (!working_hours_start || !working_hours_end) {
        return res.status(400).json({ error: 'Необходимо указать время начала и окончания работы' });
    }

    try {
        const result = await pool.query(
            'UPDATE simulators SET working_hours_start = $1, working_hours_end = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
            [working_hours_start, working_hours_end, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренажер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при обновлении рабочих часов тренажера:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 