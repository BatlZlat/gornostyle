const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Получение списка всех тренеров
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM trainers ORDER BY full_name');
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении списка тренеров:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Создание нового тренера
router.post('/', async (req, res) => {
    const {
        full_name,
        phone,
        birth_date,
        sport_type,
        description,
        hire_date,
        is_active
    } = req.body;

    // Проверка обязательных полей
    if (!full_name || !phone || !birth_date || !sport_type || !hire_date) {
        return res.status(400).json({ error: 'Необходимо заполнить все обязательные поля' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO trainers (
                full_name, phone, birth_date, sport_type, 
                description, hire_date, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [full_name, phone, birth_date, sport_type, description, hire_date, is_active]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при создании тренера:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получение информации о тренере
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('SELECT * FROM trainers WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении информации о тренере:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление информации о тренере
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const {
        full_name,
        phone,
        birth_date,
        sport_type,
        description,
        hire_date,
        is_active
    } = req.body;

    try {
        const result = await pool.query(
            `UPDATE trainers 
             SET full_name = $1, phone = $2, birth_date = $3, 
                 sport_type = $4, description = $5, hire_date = $6, 
                 is_active = $7, updated_at = CURRENT_TIMESTAMP
             WHERE id = $8 RETURNING *`,
            [full_name, phone, birth_date, sport_type, description, hire_date, is_active, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при обновлении информации о тренере:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Увольнение тренера (изменение статуса)
router.put('/:id/dismiss', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE trainers 
             SET is_active = false, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при увольнении тренера:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Восстановление тренера
router.put('/:id/rehire', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `UPDATE trainers 
             SET is_active = true, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тренер не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при восстановлении тренера:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 