const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Получение временных слотов для конкретной даты
router.get('/', async (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ error: 'Необходимо указать дату' });
    }

    try {
        const result = await pool.query(
            `SELECT id, simulator_id, start_time, end_time, is_holiday, is_booked 
             FROM schedule 
             WHERE date = $1 
             ORDER BY simulator_id, start_time`,
            [date]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении временных слотов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 