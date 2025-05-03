const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Получение прайса
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                type,
                with_trainer,
                duration,
                participants,
                price
            FROM prices
            ORDER BY 
                type,
                with_trainer,
                duration,
                participants
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении прайса:', error);
        res.status(500).json({ error: 'Ошибка при получении прайса' });
    }
});

module.exports = router; 