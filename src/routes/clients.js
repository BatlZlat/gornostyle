const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Получение списка клиентов
router.get('/', async (req, res) => {
    const { sort = 'created' } = req.query;
    let orderBy = 'c.created_at DESC';
    
    if (sort === 'name') {
        orderBy = 'c.full_name ASC';
    }

    try {
        const result = await pool.query(`
            SELECT 
                c.*,
                ch.full_name as child_name,
                ch.birth_date as child_birth_date,
                ch.skill_level as child_skill_level,
                w.balance
            FROM clients c
            LEFT JOIN children ch ON ch.parent_id = c.id
            LEFT JOIN wallets w ON w.client_id = c.id
            ORDER BY ${orderBy}
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении клиентов:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Получение клиента по id
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT 
                c.*,
                ch.full_name as child_name,
                ch.birth_date as child_birth_date,
                ch.skill_level as child_skill_level,
                w.balance
            FROM clients c
            LEFT JOIN children ch ON ch.parent_id = c.id
            LEFT JOIN wallets w ON w.client_id = c.id
            WHERE c.id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении клиента:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Обновление клиента
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const {
        full_name,
        birth_date,
        phone,
        skill_level,
        child_name,
        child_birth_date,
        child_skill_level
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Обновляем данные клиента
        await client.query(
            `UPDATE clients 
             SET full_name = $1, 
                 birth_date = $2, 
                 phone = $3, 
                 skill_level = $4,
                 updated_at = NOW()
             WHERE id = $5`,
            [full_name, birth_date, phone, skill_level, id]
        );

        // Если есть данные о ребенке, обновляем или создаем запись
        if (child_name && child_birth_date && child_skill_level) {
            const childResult = await client.query(
                'SELECT id FROM children WHERE parent_id = $1',
                [id]
            );

            if (childResult.rows.length > 0) {
                // Обновляем существующую запись
                await client.query(
                    `UPDATE children 
                     SET full_name = $1,
                         birth_date = $2,
                         skill_level = $3,
                         updated_at = NOW()
                     WHERE parent_id = $4`,
                    [child_name, child_birth_date, child_skill_level, id]
                );
            } else {
                // Создаем новую запись
                await client.query(
                    `INSERT INTO children 
                     (parent_id, full_name, birth_date, skill_level, sport_type)
                     VALUES ($1, $2, $3, $4, 'ski')`,
                    [id, child_name, child_birth_date, child_skill_level]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'Клиент успешно обновлен' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении клиента:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } finally {
        client.release();
    }
});

module.exports = router; 