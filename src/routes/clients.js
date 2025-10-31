const express = require('express');
const router = express.Router();
const { pool } = require('../db/index');

// Функция для преобразования строкового уровня в числовой
function convertSkillLevel(level) {
    if (!level) return null;
    
    const levels = {
        'beginner': 1,
        'intermediate': 3,
        'advanced': 5
    };
    
    return levels[level] || null;
}

// Получение списка клиентов
router.get('/', async (req, res) => {
    try {
        const { is_athlete } = req.query;
        
        let query = `
            SELECT 
                c.*,
                ch.id as child_id,
                ch.full_name as child_name,
                ch.birth_date as child_birth_date,
                ch.skill_level as child_skill_level,
                w.balance,
                -- Подсчет индивидуальных тренировок клиента
                COALESCE((
                    SELECT COUNT(*) 
                    FROM individual_training_sessions its
                    WHERE its.client_id = c.id
                ), 0) +
                COALESCE((
                    SELECT COUNT(DISTINCT ts.id)
                    FROM training_sessions ts
                    JOIN session_participants sp ON ts.id = sp.session_id
                    WHERE sp.client_id = c.id
                        AND sp.child_id IS NULL
                        AND sp.status IN ('confirmed', 'completed')
                        AND (
                            ts.training_type = FALSE OR 
                            ts.group_id IS NULL
                        )
                ), 0) as client_individual_count,
                -- Подсчет групповых тренировок клиента
                COALESCE((
                    SELECT COUNT(DISTINCT ts.id)
                    FROM training_sessions ts
                    JOIN session_participants sp ON ts.id = sp.session_id
                    WHERE sp.client_id = c.id
                        AND sp.child_id IS NULL
                        AND sp.status IN ('confirmed', 'completed')
                        AND (
                            ts.training_type = TRUE OR 
                            ts.group_id IS NOT NULL
                        )
                ), 0) as client_group_count,
                -- Подсчет индивидуальных тренировок ребенка
                CASE 
                    WHEN ch.id IS NULL THEN 0
                    ELSE COALESCE((
                        SELECT COUNT(*) 
                        FROM individual_training_sessions its
                        WHERE its.child_id = ch.id
                    ), 0) +
                    COALESCE((
                        SELECT COUNT(DISTINCT ts.id)
                        FROM training_sessions ts
                        JOIN session_participants sp ON ts.id = sp.session_id
                        WHERE sp.child_id = ch.id
                            AND sp.status IN ('confirmed', 'completed')
                            AND (
                                ts.training_type = FALSE OR 
                                ts.group_id IS NULL
                            )
                    ), 0)
                END as child_individual_count,
                -- Подсчет групповых тренировок ребенка
                CASE 
                    WHEN ch.id IS NULL THEN 0
                    ELSE COALESCE((
                        SELECT COUNT(DISTINCT ts.id)
                        FROM training_sessions ts
                        JOIN session_participants sp ON ts.id = sp.session_id
                        WHERE sp.child_id = ch.id
                            AND sp.status IN ('confirmed', 'completed')
                            AND (
                                ts.training_type = TRUE OR 
                                ts.group_id IS NOT NULL
                            )
                    ), 0)
                END as child_group_count
            FROM clients c
            LEFT JOIN children ch ON c.id = ch.parent_id
            LEFT JOIN wallets w ON c.id = w.client_id
        `;
        
        const params = [];
        if (is_athlete !== undefined) {
            query += ' WHERE c.is_athlete = $1';
            params.push(is_athlete === 'true');
        }
        
        query += ' ORDER BY c.full_name ASC';
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении списка клиентов:', error);
        res.status(500).json({ message: 'Ошибка при получении списка клиентов' });
    }
});

// Получение данных конкретного клиента
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT 
                c.*,
                ch.full_name as child_name,
                ch.birth_date as child_birth_date,
                ch.skill_level as child_skill_level,
                w.balance
            FROM clients c
            LEFT JOIN children ch ON c.id = ch.parent_id
            LEFT JOIN wallets w ON c.id = w.client_id
            WHERE c.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Клиент не найден' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при получении данных клиента:', error);
        res.status(500).json({ message: 'Ошибка при получении данных клиента' });
    }
});

// Обновление данных клиента
router.put('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const {
            full_name,
            birth_date,
            phone,
            skill_level,
            balance,
            child_name,
            child_birth_date,
            child_skill_level
        } = req.body;

        console.log('Получены данные для обновления:', {
            id,
            full_name,
            birth_date,
            phone,
            skill_level,
            balance,
            child_name,
            child_birth_date,
            child_skill_level
        });

        // Преобразуем уровень в число
        const numericSkillLevel = Number(skill_level);
        const numericChildSkillLevel = convertSkillLevel(child_skill_level);

        console.log('Преобразованные уровни:', {
            skill_level: numericSkillLevel,
            child_skill_level: numericChildSkillLevel
        });

        // Обновление данных клиента
        try {
            await client.query(`
                UPDATE clients 
                SET 
                    full_name = $1,
                    birth_date = $2,
                    phone = $3,
                    skill_level = $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
            `, [full_name, birth_date, phone, numericSkillLevel, id]);
            console.log('Данные клиента успешно обновлены');
        } catch (error) {
            console.error('Ошибка при обновлении данных клиента:', error);
            throw error;
        }

        // Обновление баланса
        try {
            const walletResult = await client.query(`
                SELECT id FROM wallets WHERE client_id = $1
            `, [id]);
            console.log('Результат поиска кошелька:', walletResult.rows);

            if (walletResult.rows.length > 0) {
                await client.query(`
                    UPDATE wallets 
                    SET balance = $1
                    WHERE client_id = $2
                `, [balance, id]);
                console.log('Баланс успешно обновлен');
            } else {
                await client.query(`
                    INSERT INTO wallets (client_id, balance)
                    VALUES ($1, $2)
                `, [id, balance]);
                console.log('Создан новый кошелек');
            }
        } catch (error) {
            console.error('Ошибка при работе с кошельком:', error);
            throw error;
        }

        await client.query('COMMIT');
        console.log('Транзакция успешно завершена');

        // Получаем обновленные данные клиента
        const updatedClient = await client.query(`
            SELECT 
                c.*,
                ch.full_name as child_name,
                ch.birth_date as child_birth_date,
                ch.skill_level as child_skill_level,
                w.balance
            FROM clients c
            LEFT JOIN children ch ON c.id = ch.parent_id
            LEFT JOIN wallets w ON c.id = w.client_id
            WHERE c.id = $1
        `, [id]);

        console.log('Обновленные данные клиента:', updatedClient.rows[0]);
        res.json(updatedClient.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при обновлении клиента:', error);
        res.status(500).json({ 
            message: 'Ошибка при обновлении данных клиента',
            details: error.message,
            stack: error.stack
        });
    } finally {
        client.release();
    }
});

// Обновление статуса отзыва клиента
router.put('/:id/review-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { reviewType, value } = req.body;

        // Валидация данных
        if (!reviewType || typeof value !== 'boolean') {
            return res.status(400).json({ 
                error: 'Некорректные данные. Укажите reviewType (2gis или yandex) и value (boolean)' 
            });
        }

        if (reviewType !== '2gis' && reviewType !== 'yandex') {
            return res.status(400).json({ 
                error: 'Некорректный тип отзыва. Допустимые значения: 2gis, yandex' 
            });
        }

        // Определяем, какое поле обновлять
        const fieldName = reviewType === '2gis' ? 'review_2gis' : 'review_yandex';

        // Обновляем статус отзыва
        const result = await pool.query(`
            UPDATE clients 
            SET ${fieldName} = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, full_name, review_2gis, review_yandex
        `, [value, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }

        console.log(`Обновлен статус отзыва ${reviewType} для клиента ${id}: ${value}`);
        res.json({
            success: true,
            message: 'Статус отзыва успешно обновлен',
            client: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при обновлении статуса отзыва:', error);
        res.status(500).json({ 
            error: 'Ошибка при обновлении статуса отзыва',
            details: error.message
        });
    }
});

// Обновление статуса спортсмена
router.put('/:id/athlete-status', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_athlete } = req.body;

        // Валидация данных
        if (typeof is_athlete !== 'boolean') {
            return res.status(400).json({ 
                error: 'Некорректные данные. Укажите is_athlete (boolean)' 
            });
        }

        // Обновляем статус спортсмена
        const result = await pool.query(`
            UPDATE clients 
            SET is_athlete = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, full_name, is_athlete
        `, [is_athlete, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Клиент не найден' });
        }

        console.log(`Обновлен статус спортсмена для клиента ${id}: ${is_athlete}`);
        res.json({
            success: true,
            message: 'Статус спортсмена успешно обновлен',
            client: result.rows[0]
        });
    } catch (error) {
        console.error('Ошибка при обновлении статуса спортсмена:', error);
        res.status(500).json({ 
            error: 'Ошибка при обновлении статуса спортсмена',
            details: error.message
        });
    }
});

module.exports = router; 