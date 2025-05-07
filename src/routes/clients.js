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
            ORDER BY c.created_at DESC
        `);
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

        // Преобразуем уровни в числовые значения
        const numericSkillLevel = convertSkillLevel(skill_level);
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

        // Обновление или создание данных о ребенке
        if (child_name) {
            try {
                const childResult = await client.query(`
                    SELECT id FROM children WHERE parent_id = $1
                `, [id]);
                console.log('Результат поиска ребенка:', childResult.rows);

                if (childResult.rows.length > 0) {
                    // Обновляем существующую запись
                    await client.query(`
                        UPDATE children 
                        SET 
                            full_name = $1,
                            birth_date = $2,
                            skill_level = $3,
                            sport_type = 'ski',
                            updated_at = CURRENT_TIMESTAMP
                        WHERE parent_id = $4
                    `, [child_name, child_birth_date, numericChildSkillLevel, id]);
                    console.log('Данные ребенка успешно обновлены');
                } else {
                    // Создаем новую запись
                    await client.query(`
                        INSERT INTO children (parent_id, full_name, birth_date, skill_level, sport_type)
                        VALUES ($1, $2, $3, $4, 'ski')
                    `, [id, child_name, child_birth_date, numericChildSkillLevel]);
                    console.log('Создана новая запись о ребенке');
                }
            } catch (error) {
                console.error('Ошибка при работе с данными ребенка:', error);
                throw error;
            }
        } else {
            try {
                // Если имя ребенка не указано, удаляем запись о ребенке
                await client.query(`
                    DELETE FROM children WHERE parent_id = $1
                `, [id]);
                console.log('Запись о ребенке удалена');
            } catch (error) {
                console.error('Ошибка при удалении данных ребенка:', error);
                throw error;
            }
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

module.exports = router; 