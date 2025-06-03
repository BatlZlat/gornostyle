const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Получить данные ребенка по id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM children WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Ребенок не найден' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Ошибка при получении данных ребенка', details: error.message });
    }
});

// Обновить данные ребенка по id
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, birth_date, skill_level } = req.body;
        if (!full_name || !birth_date || !skill_level) {
            return res.status(400).json({ message: 'Необходимо указать ФИО, дату рождения и уровень' });
        }
        await pool.query(
            'UPDATE children SET full_name = $1, birth_date = $2, skill_level = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
            [full_name, birth_date, skill_level, id]
        );
        const updated = await pool.query('SELECT * FROM children WHERE id = $1', [id]);
        res.json(updated.rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Ошибка при обновлении данных ребенка', details: error.message });
    }
});

module.exports = router; 