const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

/**
 * API для управления ценами на зимние тренировки (естественный склон)
 */

/**
 * GET /api/winter-prices
 * Получение списка всех цен
 */
router.get('/', async (req, res) => {
    try {
        const { type, is_active } = req.query;
        
        let query = 'SELECT * FROM winter_prices WHERE 1=1';
        const params = [];
        let paramIndex = 1;
        
        if (type) {
            query += ` AND type = $${paramIndex}`;
            params.push(type);
            paramIndex++;
        }
        
        if (is_active !== undefined) {
            query += ` AND is_active = $${paramIndex}`;
            params.push(is_active === 'true');
            paramIndex++;
        }
        
        query += ' ORDER BY type, participants NULLS FIRST';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении зимних цен:', error);
        res.status(500).json({ error: 'Ошибка при получении цен' });
    }
});

/**
 * GET /api/winter-prices/:id
 * Получение конкретной цены
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'SELECT * FROM winter_prices WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Цена не найдена' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении цены:', error);
        res.status(500).json({ error: 'Ошибка при получении цены' });
    }
});

/**
 * POST /api/winter-prices
 * Создание новой цены
 */
router.post('/', async (req, res) => {
    try {
        const { type, duration, participants, price, description, is_active } = req.body;
        
        // Валидация
        if (!type || !duration || price === undefined) {
            return res.status(400).json({ error: 'Обязательные поля: type, duration, price' });
        }
        
        if (!['individual', 'sport_group', 'group'].includes(type)) {
            return res.status(400).json({ error: 'Неверный тип тренировки' });
        }
        
        if (duration <= 0) {
            return res.status(400).json({ error: 'Длительность должна быть больше 0' });
        }
        
        if (price <= 0) {
            return res.status(400).json({ error: 'Цена должна быть больше 0' });
        }
        
        // Для групповых тренировок обязательно указать количество участников
        if ((type === 'sport_group' || type === 'group') && !participants) {
            return res.status(400).json({ error: 'Для групповых тренировок укажите количество участников' });
        }
        
        // Для индивидуальных тренировок participants должен быть NULL
        const participantsValue = type === 'individual' ? null : participants;
        
        const result = await pool.query(`
            INSERT INTO winter_prices (type, duration, participants, price, description, is_active)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [type, duration, participantsValue, price, description || null, is_active !== false]);
        
        console.log(`✅ Создана новая зимняя цена: ${type} ${participantsValue ? `(${participantsValue} чел)` : ''} - ${price}₽`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при создании цены:', error);
        res.status(500).json({ error: 'Ошибка при создании цены' });
    }
});

/**
 * PUT /api/winter-prices/:id
 * Обновление цены
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { type, duration, participants, price, description, is_active } = req.body;
        
        // Валидация
        if (!type || !duration || price === undefined) {
            return res.status(400).json({ error: 'Обязательные поля: type, duration, price' });
        }
        
        if (!['individual', 'sport_group', 'group'].includes(type)) {
            return res.status(400).json({ error: 'Неверный тип тренировки' });
        }
        
        if (duration <= 0) {
            return res.status(400).json({ error: 'Длительность должна быть больше 0' });
        }
        
        if (price <= 0) {
            return res.status(400).json({ error: 'Цена должна быть больше 0' });
        }
        
        // Для групповых тренировок обязательно указать количество участников
        if ((type === 'sport_group' || type === 'group') && !participants) {
            return res.status(400).json({ error: 'Для групповых тренировок укажите количество участников' });
        }
        
        // Для индивидуальных тренировок participants должен быть NULL
        const participantsValue = type === 'individual' ? null : participants;
        
        const result = await pool.query(`
            UPDATE winter_prices
            SET type = $1,
                duration = $2,
                participants = $3,
                price = $4,
                description = $5,
                is_active = $6,
                updated_at = NOW()
            WHERE id = $7
            RETURNING *
        `, [type, duration, participantsValue, price, description || null, is_active !== false, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Цена не найдена' });
        }
        
        console.log(`✅ Обновлена зимняя цена ID ${id}: ${type} - ${price}₽`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при обновлении цены:', error);
        res.status(500).json({ error: 'Ошибка при обновлении цены' });
    }
});

/**
 * DELETE /api/winter-prices/:id
 * Удаление цены
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'DELETE FROM winter_prices WHERE id = $1 RETURNING *',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Цена не найдена' });
        }
        
        console.log(`✅ Удалена зимняя цена ID ${id}`);
        res.json({ message: 'Цена успешно удалена' });
    } catch (error) {
        console.error('Ошибка при удалении цены:', error);
        res.status(500).json({ error: 'Ошибка при удалении цены' });
    }
});

/**
 * PUT /api/winter-prices/:id/toggle
 * Переключение активности цены
 */
router.put('/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            UPDATE winter_prices
            SET is_active = NOT is_active, updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Цена не найдена' });
        }
        
        const status = result.rows[0].is_active ? 'активирована' : 'деактивирована';
        console.log(`✅ Зимняя цена ID ${id} ${status}`);
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при переключении активности цены:', error);
        res.status(500).json({ error: 'Ошибка при переключении активности' });
    }
});

/**
 * GET /api/winter-prices/calculate/:type/:participants?
 * Рассчитать стоимость тренировки
 */
router.get('/calculate/:type/:participants?', async (req, res) => {
    try {
        const { type, participants } = req.params;
        
        let query = 'SELECT * FROM winter_prices WHERE type = $1 AND is_active = TRUE';
        const params = [type];
        
        if (type === 'individual') {
            query += ' AND participants IS NULL';
        } else if (participants) {
            query += ' AND participants = $2';
            params.push(parseInt(participants));
        }
        
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Цена для данной конфигурации не найдена' });
        }
        
        const priceData = result.rows[0];
        
        // Для sport_group цена за человека, умножаем на количество участников
        let totalPrice = priceData.price;
        if (type === 'sport_group' && participants) {
            totalPrice = priceData.price * parseInt(participants);
        }
        
        res.json({
            type: priceData.type,
            participants: priceData.participants,
            price_per_unit: priceData.price,
            total_price: totalPrice,
            duration: priceData.duration,
            description: priceData.description
        });
    } catch (error) {
        console.error('Ошибка при расчете стоимости:', error);
        res.status(500).json({ error: 'Ошибка при расчете стоимости' });
    }
});

module.exports = router;

