/**
 * API для управления зарплатами тренеров
 */

require('dotenv').config();
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: false
});

/**
 * GET /api/trainer-salary/stats
 * Получить статистику по выплатам тренерам
 */
router.get('/stats', async (req, res) => {
    try {
        // Общее количество тренеров
        const trainersCount = await pool.query(`
            SELECT COUNT(*) as count 
            FROM trainers 
            WHERE is_active = TRUE
        `);
        
        // Выплачено в этом месяце
        const currentMonth = new Date();
        currentMonth.setDate(1);
        currentMonth.setHours(0, 0, 0, 0);
        
        const paidThisMonth = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM trainer_payments
            WHERE status = 'paid'
            AND created_at >= $1
        `, [currentMonth]);
        
        // Ожидает выплаты (pending)
        const pending = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM trainer_payments
            WHERE status = 'pending'
        `);
        
        res.json({
            totalTrainers: parseInt(trainersCount.rows[0].count),
            totalPaid: parseFloat(paidThisMonth.rows[0].total),
            pending: parseFloat(pending.rows[0].total)
        });
        
    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

/**
 * GET /api/trainer-salary/trainers
 * Получить список всех тренеров с настройками ЗП
 */
router.get('/trainers', async (req, res) => {
    try {
        const trainers = await pool.query(`
            SELECT 
                t.id,
                t.full_name,
                t.sport_type,
                t.default_payment_type,
                t.default_percentage,
                t.default_fixed_amount,
                CASE 
                    WHEN t.sport_type = 'ski' THEN 'Горные лыжи 🎿'
                    WHEN t.sport_type = 'snowboard' THEN 'Сноуборд 🏂'
                    WHEN t.sport_type = 'both' THEN 'Горные лыжи и сноуборд 🎿🏂'
                    ELSE 'Не указано'
                END as sport_type_display,
                (SELECT COUNT(*) FROM training_sessions WHERE trainer_id = t.id) as total_sessions,
                (SELECT COALESCE(SUM(amount), 0) FROM trainer_payments WHERE trainer_id = t.id AND status IN ('approved', 'paid')) as total_earned,
                (SELECT COALESCE(SUM(amount), 0) FROM trainer_payments WHERE trainer_id = t.id AND status = 'pending') as pending_amount
            FROM trainers t
            WHERE t.is_active = TRUE
            ORDER BY t.full_name
        `);
        
        res.json(trainers.rows);
        
    } catch (error) {
        console.error('Ошибка при получении списка тренеров:', error);
        res.status(500).json({ error: 'Failed to load trainers' });
    }
});

/**
 * PUT /api/trainer-salary/trainers/:id
 * Обновить настройки ЗП тренера
 */
router.put('/trainers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentType, value } = req.body;
        
        if (!paymentType || value === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        if (paymentType === 'percentage') {
            await pool.query(`
                UPDATE trainers
                SET default_payment_type = 'percentage',
                    default_percentage = $1,
                    default_fixed_amount = NULL
                WHERE id = $2
            `, [value, id]);
        } else {
            await pool.query(`
                UPDATE trainers
                SET default_payment_type = 'fixed',
                    default_fixed_amount = $1,
                    default_percentage = NULL
                WHERE id = $2
            `, [value, id]);
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Ошибка при обновлении настроек тренера:', error);
        res.status(500).json({ error: 'Failed to update trainer settings' });
    }
});

/**
 * GET /api/trainer-salary/payments
 * Получить историю выплат с фильтрами
 */
router.get('/payments', async (req, res) => {
    try {
        const { trainer_id, status } = req.query;
        
        let query = `
            SELECT 
                tp.id,
                tp.trainer_id,
                tp.training_session_id,
                tp.amount,
                tp.payment_type,
                tp.percentage,
                tp.status,
                tp.created_at,
                t.full_name as trainer_name,
                ts.session_date,
                ts.session_time
            FROM trainer_payments tp
            JOIN trainers t ON tp.trainer_id = t.id
            LEFT JOIN training_sessions ts ON tp.training_session_id = ts.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (trainer_id) {
            params.push(trainer_id);
            query += ` AND tp.trainer_id = $${params.length}`;
        }
        
        if (status) {
            params.push(status);
            query += ` AND tp.status = $${params.length}`;
        }
        
        query += ` ORDER BY tp.created_at DESC LIMIT 100`;
        
        const payments = await pool.query(query, params);
        
        res.json(payments.rows);
        
    } catch (error) {
        console.error('Ошибка при получении истории выплат:', error);
        res.status(500).json({ error: 'Failed to load payments' });
    }
});

/**
 * POST /api/trainer-salary/payments/:id/approve
 * Одобрить выплату
 */
router.post('/payments/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query(`
            UPDATE trainer_payments
            SET status = 'approved'
            WHERE id = $1 AND status = 'pending'
        `, [id]);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Ошибка при одобрении выплаты:', error);
        res.status(500).json({ error: 'Failed to approve payment' });
    }
});

/**
 * POST /api/trainer-salary/payments/:id/paid
 * Отметить выплату как оплаченную
 */
router.post('/payments/:id/paid', async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query(`
            UPDATE trainer_payments
            SET status = 'paid'
            WHERE id = $1 AND status = 'approved'
        `, [id]);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Ошибка при отметке выплаты:', error);
        res.status(500).json({ error: 'Failed to mark as paid' });
    }
});

module.exports = router;
