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

module.exports = router; 