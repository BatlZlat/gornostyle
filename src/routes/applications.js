const express = require('express');
const { pool } = require('../db/index');
const router = express.Router();

// Получение всех заявок с фильтрацией по статусу
router.get('/', async (req, res) => {
    try {
        const { status, date, search } = req.query;
        
        let query = `
            SELECT 
                tr.id,
                tr.client_id,
                tr.child_id,
                tr.equipment_type,
                tr.duration,
                tr.preferred_date,
                tr.preferred_time,
                tr.has_group,
                tr.group_size,
                tr.training_frequency,
                tr.skill_level,
                tr.group_status,
                tr.created_at,
                tr.updated_at,
                c.full_name as client_name,
                c.telegram_username,
                c.phone as client_phone,
                ch.full_name as child_name
            FROM training_requests tr
            LEFT JOIN clients c ON tr.client_id = c.id
            LEFT JOIN children ch ON tr.child_id = ch.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Фильтр по статусу
        if (status && status !== 'all') {
            paramCount++;
            query += ` AND tr.group_status = $${paramCount}`;
            params.push(status);
        }
        
        // Фильтр по дате
        if (date) {
            paramCount++;
            query += ` AND tr.preferred_date = $${paramCount}`;
            params.push(date);
        }
        
        // Поиск по имени клиента или ребенка
        if (search) {
            paramCount++;
            query += ` AND (c.full_name ILIKE $${paramCount} OR ch.full_name ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        query += ` ORDER BY tr.created_at DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Ошибка при получении заявок:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получение заявок для архива (только completed)
router.get('/archive', async (req, res) => {
    try {
        const { date, search } = req.query;
        
        let query = `
            SELECT 
                tr.id,
                tr.client_id,
                tr.child_id,
                tr.equipment_type,
                tr.duration,
                tr.preferred_date,
                tr.preferred_time,
                tr.has_group,
                tr.group_size,
                tr.training_frequency,
                tr.skill_level,
                tr.group_status,
                tr.created_at,
                tr.updated_at,
                c.full_name as client_name,
                c.telegram_username,
                c.phone as client_phone,
                ch.full_name as child_name
            FROM training_requests tr
            LEFT JOIN clients c ON tr.client_id = c.id
            LEFT JOIN children ch ON tr.child_id = ch.id
            WHERE tr.group_status = 'completed'
        `;
        
        const params = [];
        let paramCount = 0;
        
        // Фильтр по дате
        if (date) {
            paramCount++;
            query += ` AND tr.preferred_date = $${paramCount}`;
            params.push(date);
        }
        
        // Поиск по имени клиента или ребенка
        if (search) {
            paramCount++;
            query += ` AND (c.full_name ILIKE $${paramCount} OR ch.full_name ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        query += ` ORDER BY tr.created_at DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
        
    } catch (error) {
        console.error('Ошибка при получении архива заявок:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получение конкретной заявки по ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            SELECT 
                tr.*,
                c.full_name as client_name,
                c.telegram_username,
                c.phone as client_phone,
                ch.full_name as child_name
            FROM training_requests tr
            LEFT JOIN clients c ON tr.client_id = c.id
            LEFT JOIN children ch ON tr.child_id = ch.id
            WHERE tr.id = $1
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Ошибка при получении заявки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление статуса заявки
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { group_status } = req.body;
        
        // Проверяем валидность статуса
        const validStatuses = ['ungrouped', 'completed', 'cancelled'];
        if (!validStatuses.includes(group_status)) {
            return res.status(400).json({ error: 'Недопустимый статус заявки' });
        }
        
        const query = `
            UPDATE training_requests 
            SET group_status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `;
        
        const result = await pool.query(query, [group_status, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        res.json(result.rows[0]);
        
    } catch (error) {
        console.error('Ошибка при обновлении заявки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Удаление заявки
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = 'DELETE FROM training_requests WHERE id = $1 RETURNING *';
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        
        res.json({ message: 'Заявка успешно удалена' });
        
    } catch (error) {
        console.error('Ошибка при удалении заявки:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;
