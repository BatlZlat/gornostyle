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
 * Query параметры:
 *   - is_active: фильтр по активности (true/false)
 */
router.get('/types', async (req, res) => {
    try {
        console.log('GET /types - запрос получен', { query: req.query, path: req.path });
        const { is_active } = req.query;
        
        let query = `
            SELECT 
                st.*,
                COUNT(ns.id) FILTER (WHERE ns.status = 'active') as active_subscriptions_count,
                COUNT(DISTINCT ns.client_id) FILTER (WHERE ns.status = 'active') as clients_count
            FROM natural_slope_subscription_types st
            LEFT JOIN natural_slope_subscriptions ns ON st.id = ns.subscription_type_id
            WHERE 1=1
        `;
        
        const params = [];
        if (is_active !== undefined) {
            query += ` AND st.is_active = $1`;
            params.push(is_active === 'true' || is_active === true);
        }
        
        query += ` GROUP BY st.id ORDER BY st.sessions_count ASC`;
        
        console.log('Выполняем запрос:', query, 'с параметрами:', params);
        const result = await pool.query(query, params);
        console.log('Получено типов абонементов:', result.rows.length);

        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении типов абонементов:', error);
        res.status(500).json({ error: 'Ошибка при получении типов абонементов: ' + error.message });
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
 * GET /api/natural-slope-subscriptions/client/:client_id
 * Получение активных абонементов клиента
 */
router.get('/client/:client_id', async (req, res) => {
    try {
        console.log('GET /client/:client_id - запрос получен', { params: req.params, path: req.path });
        const { client_id } = req.params;

        const result = await pool.query(
            `SELECT 
                ns.*,
                st.name as subscription_name,
                st.sessions_count as total_sessions,
                st.discount_percentage,
                st.description,
                CASE 
                    WHEN ns.expires_at < CURRENT_DATE THEN 'expired'
                    WHEN ns.remaining_sessions = 0 THEN 'used'
                    ELSE ns.status
                END as actual_status
             FROM natural_slope_subscriptions ns
             JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
             WHERE ns.client_id = $1
             ORDER BY ns.purchased_at DESC`,
            [client_id]
        );

        console.log(`Получено абонементов для клиента ${client_id}:`, result.rows.length);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении абонементов клиента:', error);
        res.status(500).json({ error: 'Ошибка при получении абонементов клиента: ' + error.message });
    }
});

/**
 * POST /api/natural-slope-subscriptions/purchase
 * Покупка абонемента клиентом
 */
router.post('/purchase', async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { client_id, subscription_type_id } = req.body;

        // Валидация
        if (!client_id || !subscription_type_id) {
            return res.status(400).json({ 
                error: 'Не указаны обязательные поля: client_id, subscription_type_id' 
            });
        }

        await client.query('BEGIN');

        // Получаем тип абонемента
        const typeResult = await client.query(
            `SELECT * FROM natural_slope_subscription_types WHERE id = $1 AND is_active = TRUE`,
            [subscription_type_id]
        );

        if (typeResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ 
                error: 'Тип абонемента не найден или неактивен' 
            });
        }

        const subscriptionType = typeResult.rows[0];

        // Проверяем, что дата окончания еще не прошла
        const expiresDate = new Date(subscriptionType.expires_at);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (expiresDate < today) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Абонемент уже истёк и не может быть приобретен' 
            });
        }

        // Рассчитываем дату окончания для абонемента клиента
        // Если есть validity_days, используем его, иначе берем expires_at из типа
        let subscriptionExpiresAt;
        if (subscriptionType.validity_days && subscriptionType.validity_days > 0) {
            // Используем срок действия в днях
            const expiresAtDate = new Date();
            expiresAtDate.setDate(expiresAtDate.getDate() + subscriptionType.validity_days);
            expiresAtDate.setHours(23, 59, 59, 999); // До конца дня
            subscriptionExpiresAt = expiresAtDate.toISOString();
        } else {
            // Используем expires_at из типа, преобразуя DATE в TIMESTAMP
            const expiresAtDate = new Date(subscriptionType.expires_at);
            expiresAtDate.setHours(23, 59, 59, 999); // До конца дня
            subscriptionExpiresAt = expiresAtDate.toISOString();
        }

        // Получаем клиента и его кошелек
        const clientResult = await client.query(
            `SELECT c.id, c.full_name, w.id as wallet_id, w.balance, w.wallet_number
             FROM clients c
             LEFT JOIN wallets w ON c.id = w.client_id
             WHERE c.id = $1`,
            [client_id]
        );

        if (clientResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Клиент не найден' });
        }

        const clientData = clientResult.rows[0];

        // Проверяем баланс
        const balance = parseFloat(clientData.balance || 0);
        const price = parseFloat(subscriptionType.price);

        if (balance < price) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Недостаточно средств на балансе',
                required: price,
                available: balance
            });
        }

        // Если нет кошелька, создаем его
        let walletId = clientData.wallet_id;
        if (!walletId) {
            // Генерируем уникальный номер кошелька
            let walletNumber;
            let isUnique = false;
            let attempts = 0;
            
            while (!isUnique && attempts < 10) {
                walletNumber = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
                const checkResult = await client.query('SELECT id FROM wallets WHERE wallet_number = $1', [walletNumber]);
                isUnique = checkResult.rows.length === 0;
                attempts++;
            }
            
            if (!isUnique) {
                await client.query('ROLLBACK');
                return res.status(500).json({ 
                    error: 'Не удалось сгенерировать уникальный номер кошелька' 
                });
            }
            
            const walletResult = await client.query(
                `INSERT INTO wallets (client_id, balance, wallet_number, last_updated)
                 VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                 RETURNING id`,
                [client_id, 0, walletNumber]
            );
            walletId = walletResult.rows[0].id;
        }

        // Списываем средства с кошелька
        await client.query(
            'UPDATE wallets SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP WHERE id = $2',
            [price, walletId]
        );

        // Создаем абонемент
        // expires_at для абонемента клиента рассчитан выше
        const subscriptionResult = await client.query(
            `INSERT INTO natural_slope_subscriptions (
                client_id, subscription_type_id, remaining_sessions, status,
                expires_at, total_paid
            )
            VALUES ($1, $2, $3, 'active', $4::timestamp, $5)
            RETURNING *`,
            [
                client_id,
                subscription_type_id,
                subscriptionType.sessions_count,
                subscriptionExpiresAt,
                price
            ]
        );

        const subscription = subscriptionResult.rows[0];

        // Создаем запись о транзакции
        const transactionDescription = `Покупка абонемента "${subscriptionType.name}"`;
        await client.query(
            `INSERT INTO transactions (wallet_id, amount, type, description, created_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
            [walletId, price, 'subscription_purchase', transactionDescription]
        );

        await client.query('COMMIT');

        console.log(`✅ Клиент ID ${client_id} приобрел абонемент "${subscriptionType.name}" за ${price} руб.`);

        // Обновляем реферальный статус после покупки абонемента
        // Покупка абонемента - это расход средств, который должен обновить статус на 'deposited'
        try {
            const { updateReferralStatusOnDeposit } = require('../services/referral-service');
            await updateReferralStatusOnDeposit(client_id, price);
        } catch (error) {
            console.error('❌ Ошибка при обновлении реферального статуса после покупки абонемента:', error);
            // Не прерываем основной процесс
        }

        // Получаем полную информацию об абонементе для ответа
        const fullSubscriptionResult = await pool.query(
            `SELECT 
                ns.*,
                st.name as subscription_name,
                st.sessions_count as total_sessions,
                st.discount_percentage,
                st.description
             FROM natural_slope_subscriptions ns
             JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
             WHERE ns.id = $1`,
            [subscription.id]
        );

        res.status(201).json(fullSubscriptionResult.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при покупке абонемента:', error);
        res.status(500).json({ error: 'Ошибка при покупке абонемента: ' + error.message });
    } finally {
        client.release();
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

