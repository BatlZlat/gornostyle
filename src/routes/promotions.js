const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || '90.156.210.24',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'skisimulator',
    user: process.env.DB_USER || 'batl-zlat',
    password: process.env.DB_PASSWORD || 'Nemezida2324%)',
    ssl: false
});

// Получить все акции
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM bonus_settings 
            ORDER BY created_at DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении акций:', error);
        res.status(500).json({ error: 'Ошибка при получении акций' });
    }
});

// Получить статистику по акциям
router.get('/stats', async (req, res) => {
    try {
        // Количество активных акций
        const activeResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM bonus_settings 
            WHERE is_active = TRUE
        `);
        
        // Общая сумма выплаченных бонусов
        const paidResult = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM bonus_transactions 
            WHERE status = 'approved'
        `);
        
        // Количество реферальных переходов
        const referralResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM referral_transactions
        `);
        
        res.json({
            activeCount: parseInt(activeResult.rows[0].count),
            totalPaid: parseFloat(paidResult.rows[0].total),
            referralCount: parseInt(referralResult.rows[0].count)
        });
    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        res.status(500).json({ error: 'Ошибка при получении статистики' });
    }
});

// Получить детали акции
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            SELECT * FROM bonus_settings WHERE id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Акция не найдена' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении акции:', error);
        res.status(500).json({ error: 'Ошибка при получении акции' });
    }
});

// Создать новую акцию
router.post('/', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const {
            name,
            description,
            slope_type,
            bonus_type,
            bonus_amount,
            min_amount,
            max_bonus_per_user,
            valid_from,
            valid_until,
            is_active
        } = req.body;
        
        // Валидация
        if (!name || !bonus_type || !bonus_amount || !slope_type) {
            return res.status(400).json({ error: 'Не все обязательные поля заполнены' });
        }
        
        await client.query('BEGIN');
        
        const result = await client.query(`
            INSERT INTO bonus_settings (
                name, description, slope_type, bonus_type, bonus_amount,
                min_amount, max_bonus_per_user, valid_from, valid_until,
                is_active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `, [
            name,
            description,
            slope_type,
            bonus_type,
            bonus_amount,
            min_amount || 0,
            max_bonus_per_user || null,
            valid_from || null,
            valid_until || null,
            is_active !== false
        ]);
        
        await client.query('COMMIT');
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании акции:', error);
        res.status(500).json({ error: 'Ошибка при создании акции', details: error.message });
    } finally {
        client.release();
    }
});

// Обновить акцию
router.put('/:id', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { id } = req.params;
        const {
            name,
            description,
            slope_type,
            bonus_type,
            bonus_amount,
            min_amount,
            max_bonus_per_user,
            valid_from,
            valid_until,
            is_active
        } = req.body;
        
        await client.query('BEGIN');
        
        const result = await client.query(`
            UPDATE bonus_settings 
            SET name = $1,
                description = $2,
                slope_type = $3,
                bonus_type = $4,
                bonus_amount = $5,
                min_amount = $6,
                max_bonus_per_user = $7,
                valid_from = $8,
                valid_until = $9,
                is_active = $10,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING *
        `, [
            name,
            description,
            slope_type,
            bonus_type,
            bonus_amount,
            min_amount || 0,
            max_bonus_per_user || null,
            valid_from || null,
            valid_until || null,
            is_active !== false,
            id
        ]);
        
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Акция не найдена' });
        }
        
        await client.query('COMMIT');
        
        res.json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении акции:', error);
        res.status(500).json({ error: 'Ошибка при обновлении акции', details: error.message });
    } finally {
        client.release();
    }
});

// Удалить акцию
router.delete('/:id', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { id } = req.params;
        
        await client.query('BEGIN');
        
        // Проверяем, есть ли связанные бонусные транзакции
        const transactionsResult = await client.query(`
            SELECT COUNT(*) as count 
            FROM bonus_transactions 
            WHERE bonus_setting_id = $1
        `, [id]);
        
        if (parseInt(transactionsResult.rows[0].count) > 0) {
            return res.status(400).json({ 
                error: 'Невозможно удалить акцию, так как по ней уже были начисления. Деактивируйте её вместо удаления.' 
            });
        }
        
        const result = await client.query(`
            DELETE FROM bonus_settings WHERE id = $1 RETURNING *
        `, [id]);
        
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Акция не найдена' });
        }
        
        await client.query('COMMIT');
        
        res.json({ message: 'Акция успешно удалена' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при удалении акции:', error);
        res.status(500).json({ error: 'Ошибка при удалении акции', details: error.message });
    } finally {
        client.release();
    }
});

// Переключить статус активности акции
router.patch('/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            UPDATE bonus_settings 
            SET is_active = NOT is_active,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Акция не найдена' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при переключении статуса:', error);
        res.status(500).json({ error: 'Ошибка при переключении статуса' });
    }
});

// Получить историю начислений по акции
router.get('/:id/transactions', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            SELECT 
                bt.*,
                c.full_name as client_name
            FROM bonus_transactions bt
            JOIN clients c ON bt.client_id = c.id
            WHERE bt.bonus_setting_id = $1
            ORDER BY bt.created_at DESC
            LIMIT 100
        `, [id]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении истории:', error);
        res.status(500).json({ error: 'Ошибка при получении истории' });
    }
});

module.exports = router;
