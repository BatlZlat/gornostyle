const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

/**
 * Проверяет является ли текущее время ночным (22:00 - 9:00)
 * @returns {boolean} true если сейчас ночное время
 */
function isNightTime() {
    // Используем часовой пояс Екатеринбурга (UTC+5)
    const now = new Date();
    const ekbOffset = 5 * 60; // UTC+5 в минутах
    const localOffset = now.getTimezoneOffset(); // смещение локального времени от UTC
    const ekbTime = new Date(now.getTime() + (ekbOffset + localOffset) * 60000);
    
    const hour = ekbTime.getHours();
    
    // Ночное время: с 22:00 до 9:00
    return hour >= 22 || hour < 9;
}

/**
 * Проверяет включен ли беззвучный режим для клиента по Telegram ID
 * С учетом ночного времени (22:00 - 9:00)
 * @param {string} telegramId - Telegram ID клиента
 * @returns {Promise<boolean>} true если беззвучный режим включен
 */
async function getClientSilentMode(telegramId) {
    try {
        // Проверяем ночное время - если ночь, всегда беззвучно
        if (isNightTime()) {
            return true;
        }
        
        const result = await pool.query(
            'SELECT silent_notifications FROM clients WHERE telegram_id = $1',
            [telegramId]
        );
        
        if (result.rows.length === 0) {
            return false; // Клиент не найден - по умолчанию со звуком
        }
        
        return result.rows[0].silent_notifications || false;
    } catch (error) {
        console.error('Ошибка при получении настроек беззвучного режима:', error);
        return false; // В случае ошибки - по умолчанию со звуком
    }
}

/**
 * Проверяет включен ли беззвучный режим для клиента по Client ID
 * С учетом ночного времени (22:00 - 9:00)
 * @param {number} clientId - ID клиента
 * @returns {Promise<boolean>} true если беззвучный режим включен
 */
async function getClientSilentModeById(clientId) {
    try {
        // Проверяем ночное время - если ночь, всегда беззвучно
        if (isNightTime()) {
            return true;
        }
        
        const result = await pool.query(
            'SELECT silent_notifications FROM clients WHERE id = $1',
            [clientId]
        );
        
        if (result.rows.length === 0) {
            return false; // Клиент не найден - по умолчанию со звуком
        }
        
        return result.rows[0].silent_notifications || false;
    } catch (error) {
        console.error('Ошибка при получении настроек беззвучного режима:', error);
        return false; // В случае ошибки - по умолчанию со звуком
    }
}

/**
 * Обновляет настройку беззвучного режима для клиента
 * @param {string} telegramId - Telegram ID клиента
 * @param {boolean} isSilent - true для беззвучного режима, false для обычного
 * @returns {Promise<boolean>} true если обновление успешно
 */
async function updateClientSilentMode(telegramId, isSilent) {
    try {
        const result = await pool.query(
            'UPDATE clients SET silent_notifications = $1 WHERE telegram_id = $2 RETURNING id',
            [isSilent, telegramId]
        );
        
        return result.rows.length > 0;
    } catch (error) {
        console.error('Ошибка при обновлении настроек беззвучного режима:', error);
        return false;
    }
}

/**
 * Обновляет настройку беззвучного режима для клиента по Client ID
 * @param {number} clientId - ID клиента
 * @param {boolean} isSilent - true для беззвучного режима, false для обычного
 * @returns {Promise<boolean>} true если обновление успешно
 */
async function updateClientSilentModeById(clientId, isSilent) {
    try {
        const result = await pool.query(
            'UPDATE clients SET silent_notifications = $1 WHERE id = $2 RETURNING id',
            [isSilent, clientId]
        );
        
        return result.rows.length > 0;
    } catch (error) {
        console.error('Ошибка при обновлении настроек беззвучного режима:', error);
        return false;
    }
}

/**
 * Получает данные клиента включая настройки уведомлений по Telegram ID
 * @param {string} telegramId - Telegram ID клиента
 * @returns {Promise<Object|null>} Объект с данными клиента или null
 */
async function getClientWithSettings(telegramId) {
    try {
        const result = await pool.query(
            'SELECT id, full_name, telegram_id, silent_notifications FROM clients WHERE telegram_id = $1',
            [telegramId]
        );
        
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error('Ошибка при получении данных клиента:', error);
        return null;
    }
}

module.exports = {
    getClientSilentMode,
    getClientSilentModeById,
    updateClientSilentMode,
    updateClientSilentModeById,
    getClientWithSettings
};

