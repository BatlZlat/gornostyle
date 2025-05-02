const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Получение временных слотов для конкретной даты и тренажера
router.get('/', async (req, res) => {
    const { date, simulator_id } = req.query;

    if (!date || !simulator_id) {
        return res.status(400).json({ error: 'Необходимо указать дату и ID тренажера' });
    }

    try {
        const result = await pool.query(
            `SELECT id, start_time, end_time, is_holiday, is_booked 
             FROM schedule 
             WHERE date = $1 AND simulator_id = $2 
             ORDER BY start_time`,
            [date, simulator_id]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении временных слотов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 