const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

/**
 * API для управления абонементами на естественный склон
 */

/**
 * GET /api/natural-slope-subscriptions/stats
 * Получение статистики по абонементам
 */
router.get('/stats', async (req, res) => {
    try {
        const statsResult = await pool.query(`
            SELECT 
                COUNT(DISTINCT st.id) as total_types,
                COUNT(DISTINCT ns.id) FILTER (WHERE ns.status = 'active') as active_subscriptions,
                COUNT(DISTINCT ns.client_id) FILTER (WHERE ns.status = 'active') as clients_with_subscriptions,
                COALESCE(SUM(CASE WHEN ns.status = 'active' THEN 1 ELSE 0 END), 0) as active_count,
                COALESCE(SUM(CASE WHEN ns.status = 'expired' THEN 1 ELSE 0 END), 0) as expired_count,
                COALESCE(SUM(CASE WHEN ns.status = 'used' THEN 1 ELSE 0 END), 0) as used_count,
                COALESCE(SUM(ns.total_paid) FILTER (WHERE ns.purchased_at >= NOW() - INTERVAL '30 days'), 0) as revenue_30_days
            FROM natural_slope_subscription_types st
            LEFT JOIN natural_slope_subscriptions ns ON st.id = ns.subscription_type_id
            WHERE st.is_active = TRUE
        `);

        const stats = statsResult.rows[0];

        res.json({
            total_types: parseInt(stats.total_types) || 0,
            active_subscriptions: parseInt(stats.active_subscriptions) || 0,
            clients_with_subscriptions: parseInt(stats.clients_with_subscriptions) || 0,
            active_count: parseInt(stats.active_count) || 0,
            expired_count: parseInt(stats.expired_count) || 0,
            used_count: parseInt(stats.used_count) || 0,
            revenue_30_days: parseFloat(stats.revenue_30_days) || 0
        });
    } catch (error) {
        console.error('Ошибка при получении статистики абонементов:', error);
        res.status(500).json({ error: 'Ошибка при получении статистики' });
    }
});

/**
 * GET /api/natural-slope-subscriptions/types
 * Получение списка типов абонементов
 */
router.get('/types', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                st.*,
                COUNT(ns.id) FILTER (WHERE ns.status = 'active') as active_subscriptions_count,
                COUNT(DISTINCT ns.client_id) FILTER (WHERE ns.status = 'active') as clients_count
            FROM natural_slope_subscription_types st
            LEFT JOIN natural_slope_subscriptions ns ON st.id = ns.subscription_type_id
            GROUP BY st.id
            ORDER BY st.sessions_count ASC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении типов абонементов:', error);
        res.status(500).json({ error: 'Ошибка при получении типов абонементов' });
    }
});

/**
 * GET /api/natural-slope-subscriptions/client-subscriptions
 * Получение списка подписок клиентов с фильтрацией
 */
router.get('/client-subscriptions', async (req, res) => {
    try {
        const { status, skill_level, age_group } = req.query;
        
        let query = `
            SELECT 
                ns.*,
                st.name as subscription_name,
                st.sessions_count as total_sessions,
                st.discount_percentage,
                c.full_name as client_name,
                c.phone as client_phone,
                c.telegram_id
            FROM natural_slope_subscriptions ns
            JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
            JOIN clients c ON ns.client_id = c.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (status) {
            query += ` AND ns.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        if (skill_level) {
            query += ` AND ns.skill_level = $${paramIndex}`;
            params.push(skill_level);
            paramIndex++;
        }
        
        if (age_group) {
            query += ` AND ns.age_group = $${paramIndex}`;
            params.push(age_group);
            paramIndex++;
        }
        
        query += ` ORDER BY ns.purchased_at DESC LIMIT 200`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении подписок клиентов:', error);
        res.status(500).json({ error: 'Ошибка при получении подписок' });
    }
});

/**
 * POST /api/natural-slope-subscriptions/types
 * Создание нового типа абонемента (админ)
 */
router.post('/types', async (req, res) => {
    try {
        const { name, description, sessions_count, discount_percentage, price, price_per_session, expires_at, is_active } = req.body;

        // Валидация
        if (!name || !sessions_count || discount_percentage === undefined || !price || !expires_at) {
            return res.status(400).json({ error: 'Все обязательные поля должны быть заполнены' });
        }
        
        // Валидация даты
        const expiresDate = new Date(expires_at);
        if (isNaN(expiresDate.getTime())) {
            return res.status(400).json({ error: 'Некорректная дата окончания действия' });
        }

        if (sessions_count < 1) {
            return res.status(400).json({ error: 'Количество занятий должно быть больше 0' });
        }

        if (discount_percentage < 0 || discount_percentage > 100) {
            return res.status(400).json({ error: 'Скидка должна быть от 0 до 100%' });
        }

        // Используем переданную price_per_session, если она есть, иначе рассчитываем
        let finalPricePerSession = price_per_session;
        if (!finalPricePerSession) {
            // Если не передана, рассчитываем на основе общей цены и количества занятий
            finalPricePerSession = price / sessions_count;
        }

        const result = await pool.query(`
            INSERT INTO natural_slope_subscription_types (
                name, description, sessions_count, discount_percentage, 
                price, price_per_session, expires_at, is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [
            name, 
            description || null, 
            sessions_count, 
            discount_percentage, 
            price, 
            finalPricePerSession, 
            expires_at, 
            is_active !== false
        ]);

        console.log(`✅ Создан новый тип абонемента: ${name}`);
        console.log('Сохраненные данные:', JSON.stringify(result.rows[0], null, 2));
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при создании типа абонемента:', error);
        res.status(500).json({ error: 'Ошибка при создании типа абонемента: ' + error.message });
    }
});

/**
 * PUT /api/natural-slope-subscriptions/types/:id
 * Обновление типа абонемента (админ)
 */
router.put('/types/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, sessions_count, discount_percentage, price, price_per_session, expires_at, is_active } = req.body;

        // Валидация
        if (!name || !sessions_count || discount_percentage === undefined || !price || !expires_at) {
            return res.status(400).json({ error: 'Все обязательные поля должны быть заполнены' });
        }
        
        // Валидация даты
        const expiresDate = new Date(expires_at);
        if (isNaN(expiresDate.getTime())) {
            return res.status(400).json({ error: 'Некорректная дата окончания действия' });
        }

        // Используем переданную price_per_session, если она есть, иначе рассчитываем
        let finalPricePerSession = price_per_session;
        if (!finalPricePerSession) {
            // Если не передана, рассчитываем на основе общей цены и количества занятий
            finalPricePerSession = price / sessions_count;
        }

        const result = await pool.query(`
            UPDATE natural_slope_subscription_types 
            SET name = $1, 
                description = $2, 
                sessions_count = $3, 
                discount_percentage = $4, 
                price = $5, 
                price_per_session = $6,
                expires_at = $7, 
                is_active = $8,
                updated_at = NOW()
            WHERE id = $9
            RETURNING *
        `, [
            name, 
            description || null, 
            sessions_count, 
            discount_percentage, 
            price, 
            finalPricePerSession,
            expires_at, 
            is_active !== false, 
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тип абонемента не найден' });
        }

        console.log(`✅ Обновлен тип абонемента ID ${id}: ${name}`);
        console.log('Обновленные данные:', JSON.stringify(result.rows[0], null, 2));
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при обновлении типа абонемента:', error);
        res.status(500).json({ error: 'Ошибка при обновлении типа абонемента: ' + error.message });
    }
});

/**
 * DELETE /api/natural-slope-subscriptions/types/:id
 * Удаление типа абонемента (только если нет активных подписок)
 */
router.delete('/types/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Проверяем, есть ли активные подписки
        const checkResult = await pool.query(`
            SELECT COUNT(*) as count 
            FROM natural_slope_subscriptions 
            WHERE subscription_type_id = $1 AND status = 'active'
        `, [id]);

        if (parseInt(checkResult.rows[0].count) > 0) {
            return res.status(400).json({ 
                error: 'Невозможно удалить тип абонемента с активными подписками' 
            });
        }

        const result = await pool.query(
            'DELETE FROM natural_slope_subscription_types WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тип абонемента не найден' });
        }

        console.log(`✅ Удален тип абонемента ID ${id}`);
        res.json({ message: 'Тип абонемента успешно удален' });
    } catch (error) {
        console.error('Ошибка при удалении типа абонемента:', error);
        res.status(500).json({ error: 'Ошибка при удалении типа абонемента' });
    }
});

/**
 * PUT /api/natural-slope-subscriptions/types/:id/toggle
 * Переключение активности типа абонемента
 */
router.put('/types/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(`
            UPDATE natural_slope_subscription_types 
            SET is_active = NOT is_active, updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Тип абонемента не найден' });
        }

        const status = result.rows[0].is_active ? 'активирован' : 'деактивирован';
        console.log(`✅ Тип абонемента ID ${id} ${status}`);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при переключении активности типа абонемента:', error);
        res.status(500).json({ error: 'Ошибка при переключении активности' });
    }
});

/**
 * POST /api/natural-slope-subscriptions/:id/add-note
 * Добавление заметки к абонементу клиента
 */
router.post('/:id/add-note', async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        const result = await pool.query(`
            UPDATE natural_slope_subscriptions
            SET notes = $1
            WHERE id = $2
            RETURNING *
        `, [notes, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Абонемент не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при добавлении заметки:', error);
        res.status(500).json({ error: 'Ошибка при добавлении заметки' });
    }
});

module.exports = router;

