const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Получение списка тренажеров
router.get('/api/simulators', async (req, res) => {
    try {
        const query = `
            SELECT 
                id,
                name,
                status,
                working_hours_start,
                working_hours_end,
                created_at,
                updated_at
            FROM simulators
            ORDER BY name;
        `;

        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении списка тренажеров:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Ошибка при получении списка тренажеров' 
        });
    }
});

// Обновление статуса тренажера
router.put('/api/simulators/:id/status', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const { status } = req.body;

        const query = `
            UPDATE simulators 
            SET status = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *;
        `;

        const result = await client.query(query, [status, id]);

        if (result.rows.length === 0) {
            throw new Error('Тренажер не найден');
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            simulator: result.rows[0] 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении статуса тренажера:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Ошибка при обновлении статуса тренажера' 
        });
    } finally {
        client.release();
    }
});

// Обновление рабочего времени тренажера
router.put('/api/simulators/:id/hours', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const { working_hours_start, working_hours_end } = req.body;

        const query = `
            UPDATE simulators 
            SET working_hours_start = $1,
                working_hours_end = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *;
        `;

        const result = await client.query(query, [working_hours_start, working_hours_end, id]);

        if (result.rows.length === 0) {
            throw new Error('Тренажер не найден');
        }

        await client.query('COMMIT');
        res.json({ 
            success: true, 
            simulator: result.rows[0] 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении рабочего времени тренажера:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Ошибка при обновлении рабочего времени тренажера' 
        });
    } finally {
        client.release();
    }
});

module.exports = router; 