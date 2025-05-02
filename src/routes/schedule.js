const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Получение расписания
router.get('/', async (req, res) => {
    const { date } = req.query;
    
    try {
        const result = await pool.query(
            `SELECT s.*, sim.name as simulator_name 
             FROM schedule s
             JOIN simulators sim ON s.simulator_id = sim.id
             WHERE s.date = $1
             ORDER BY s.start_time`,
            [date]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении расписания:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 