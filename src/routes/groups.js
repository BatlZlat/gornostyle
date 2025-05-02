const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Получение списка всех групп
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM groups ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении списка групп:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Создание новой группы
router.post('/', async (req, res) => {
    console.log('Получен запрос на создание группы:', req.body);
    const { name, description } = req.body;
    
    if (!name) {
        console.log('Ошибка: название группы не указано');
        return res.status(400).json({ error: 'Название группы обязательно' });
    }

    try {
        console.log('Попытка создания группы:', { name, description });
        const result = await pool.query(
            'INSERT INTO groups (name, description) VALUES ($1, $2) RETURNING *',
            [name, description]
        );
        console.log('Группа успешно создана:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при создании группы:', error);
        console.error('Детали ошибки:', {
            message: error.message,
            code: error.code,
            detail: error.detail,
            hint: error.hint
        });
        res.status(500).json({ 
            error: 'Внутренняя ошибка сервера',
            details: error.message
        });
    }
});

// Получение группы по ID
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM groups WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении группы:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление группы
router.put('/:id', async (req, res) => {
    const { name, description } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Название группы обязательно' });
    }

    try {
        const result = await pool.query(
            'UPDATE groups SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
            [name, description, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при обновлении группы:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Удаление группы
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM groups WHERE id = $1 RETURNING *', [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        
        res.json({ message: 'Группа успешно удалена' });
    } catch (error) {
        console.error('Ошибка при удалении группы:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router; 