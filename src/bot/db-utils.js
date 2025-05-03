const { pool } = require('../db');

// Создание нового клиента
async function createClient(clientData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Создаем клиента
        const clientResult = await client.query(
            `INSERT INTO clients (
                full_name, birth_date, phone, telegram_id, 
                telegram_username, nickname
            ) VALUES ($1, $2, $3, $4, $5, $6) 
            RETURNING id`,
            [
                clientData.full_name,
                clientData.birth_date,
                clientData.phone,
                clientData.telegram_id,
                clientData.telegram_username,
                clientData.nickname
            ]
        );

        const clientId = clientResult.rows[0].id;

        // Создаем кошелек
        const walletNumber = generateWalletNumber();
        await client.query(
            `INSERT INTO wallets (client_id, balance) 
             VALUES ($1, 0)`,
            [clientId]
        );

        // Если есть данные о ребенке, создаем запись
        if (clientData.child) {
            await client.query(
                `INSERT INTO children (
                    parent_id, full_name, birth_date, 
                    sport_type, skill_level
                ) VALUES ($1, $2, $3, $4, $5)`,
                [
                    clientId,
                    clientData.child.full_name,
                    clientData.child.birth_date,
                    clientData.child.sport_type || 'ski',
                    clientData.child.skill_level || 1
                ]
            );
        }

        await client.query('COMMIT');
        return { clientId, walletNumber };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Получение данных клиента
async function getClientByTelegramId(telegramId) {
    const result = await pool.query(
        `SELECT c.*, w.id as wallet_id, w.balance 
         FROM clients c 
         LEFT JOIN wallets w ON c.id = w.client_id 
         WHERE c.telegram_id = $1`,
        [telegramId]
    );
    return result.rows[0];
}

// Получение данных ребенка
async function getChildByParentId(parentId) {
    const result = await pool.query(
        'SELECT * FROM children WHERE parent_id = $1',
        [parentId]
    );
    return result.rows[0];
}

// Генерация уникального номера кошелька
function generateWalletNumber() {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `${timestamp}${random}`;
}

// Обновление поля клиента
async function updateClientField(clientId, field, value) {
    const query = {
        text: `UPDATE clients SET ${field} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        values: [value, clientId]
    };

    try {
        const result = await pool.query(query);
        return result.rows[0];
    } catch (error) {
        console.error('Ошибка при обновлении данных клиента:', error);
        throw error;
    }
}

// Добавление ребенка
async function addChild(parentId, childData) {
    const query = {
        text: `INSERT INTO children (parent_id, full_name, birth_date) 
               VALUES ($1, $2, $3) 
               RETURNING *`,
        values: [parentId, childData.full_name, childData.birth_date]
    };

    try {
        const result = await pool.query(query);
        return result.rows[0];
    } catch (error) {
        console.error('Ошибка при добавлении ребенка:', error);
        throw error;
    }
}

// Обновление данных ребенка
async function updateChild(childId, field, value) {
    const query = {
        text: `UPDATE children SET ${field} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        values: [value, childId]
    };

    try {
        const result = await pool.query(query);
        return result.rows[0];
    } catch (error) {
        console.error('Ошибка при обновлении данных ребенка:', error);
        throw error;
    }
}

module.exports = {
    createClient,
    getClientByTelegramId,
    getChildByParentId,
    updateClientField,
    addChild,
    updateChild
}; 