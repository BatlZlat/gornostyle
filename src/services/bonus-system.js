/**
 * Универсальная система начисления бонусов
 * Работает с любыми типами акций из bonus_settings
 */

require('dotenv').config();
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
 * Проверяет и начисляет бонусы для конкретного события
 * @param {string} bonusType - Тип бонуса (registration, booking, referral, etc.)
 * @param {number} clientId - ID клиента
 * @param {Object} eventData - Данные события
 */
async function checkAndAwardBonus(bonusType, clientId, eventData = {}) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Получаем активные акции для этого типа бонуса
        const bonusSettings = await client.query(`
            SELECT * FROM bonus_settings 
            WHERE bonus_type = $1 
            AND is_active = TRUE
            AND (valid_from IS NULL OR valid_from <= CURRENT_TIMESTAMP)
            AND (valid_until IS NULL OR valid_until >= CURRENT_TIMESTAMP)
            ORDER BY bonus_amount DESC
        `, [bonusType]);
        
        if (bonusSettings.rows.length === 0) {
            console.log(`ℹ️ Нет активных акций для типа: ${bonusType}`);
            return;
        }
        
        // Проверяем каждую акцию
        for (const bonus of bonusSettings.rows) {
            const isEligible = await checkBonusEligibility(client, clientId, bonus, eventData);
            
            if (isEligible) {
                await awardBonus(client, clientId, bonus, eventData);
            }
        }
        
        await client.query('COMMIT');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Ошибка при проверке бонусов типа ${bonusType}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Проверяет, подходит ли клиент для получения бонуса
 */
async function checkBonusEligibility(dbClient, clientId, bonus, eventData) {
    try {
        // 1. Проверяем минимальную сумму
        if (bonus.min_amount > 0 && eventData.amount < bonus.min_amount) {
            console.log(`❌ Сумма ${eventData.amount}₽ меньше минимальной ${bonus.min_amount}₽ для бонуса ${bonus.name}`);
            return false;
        }
        
        // 2. Проверяем максимальное количество бонусов на пользователя
        if (bonus.max_bonus_per_user) {
            const userBonusesCount = await dbClient.query(`
                SELECT COUNT(*) as count 
                FROM bonus_transactions 
                WHERE client_id = $1 
                AND bonus_setting_id = $2 
                AND status = 'approved'
            `, [clientId, bonus.id]);
            
            if (parseInt(userBonusesCount.rows[0].count) >= bonus.max_bonus_per_user) {
                console.log(`❌ Клиент ${clientId} уже получил максимальное количество бонусов (${bonus.max_bonus_per_user}) для акции ${bonus.name}`);
                return false;
            }
        }
        
        // 3. Специальные проверки для разных типов бонусов
        switch (bonus.bonus_type) {
            case 'attendance_milestone':
                return await checkMilestoneEligibility(dbClient, clientId, bonus);
            
            case 'early_booking':
                return await checkEarlyBookingEligibility(eventData, bonus);
            
            case 'morning_training':
                return await checkMorningTrainingEligibility(eventData, bonus);
            
            case 'evening_training':
                return await checkEveningTrainingEligibility(eventData, bonus);
            
            case 'birthday':
                return await checkBirthdayEligibility(dbClient, clientId, bonus);
            
            default:
                return true; // Для остальных типов - просто проверяем базовые условия
        }
        
    } catch (error) {
        console.error('Ошибка при проверке eligibility:', error);
        return false;
    }
}

/**
 * Проверяет milestone бонусы (посещение N тренировок)
 */
async function checkMilestoneEligibility(dbClient, clientId, bonus) {
    const totalTrainings = await getTotalTrainings(dbClient, clientId);
    
    // Проверяем, достиг ли клиент нужного количества тренировок
    const milestoneReached = totalTrainings >= bonus.bonus_amount;
    
    if (!milestoneReached) {
        console.log(`❌ Клиент ${clientId} посетил ${totalTrainings} тренировок, нужно ${bonus.bonus_amount} для бонуса ${bonus.name}`);
        return false;
    }
    
    // Проверяем, не получал ли уже этот milestone бонус
    const existingMilestone = await dbClient.query(`
        SELECT COUNT(*) as count 
        FROM bonus_transactions 
        WHERE client_id = $1 
        AND bonus_setting_id = $2 
        AND description LIKE '%${bonus.bonus_amount} тренировок%'
    `, [clientId, bonus.id]);
    
    if (parseInt(existingMilestone.rows[0].count) > 0) {
        console.log(`❌ Клиент ${clientId} уже получил milestone бонус за ${bonus.bonus_amount} тренировок`);
        return false;
    }
    
    return true;
}

/**
 * Проверяет бонус за раннюю запись
 */
async function checkEarlyBookingEligibility(eventData, bonus) {
    const daysUntilTraining = eventData.daysUntilTraining || 0;
    const requiredDays = bonus.min_amount || 7; // По умолчанию 7 дней
    
    return daysUntilTraining >= requiredDays;
}

/**
 * Проверяет бонус за утреннюю тренировку
 */
async function checkMorningTrainingEligibility(eventData, bonus) {
    const trainingTime = eventData.time || '';
    const hour = parseInt(trainingTime.split(':')[0]);
    
    return hour >= 6 && hour < 12; // Утренние часы
}

/**
 * Проверяет бонус за вечернюю тренировку
 */
async function checkEveningTrainingEligibility(eventData, bonus) {
    const trainingTime = eventData.time || '';
    const hour = parseInt(trainingTime.split(':')[0]);
    
    return hour >= 18 && hour < 23; // Вечерние часы
}

/**
 * Проверяет бонус за день рождения
 */
async function checkBirthdayEligibility(dbClient, clientId, bonus) {
    const clientResult = await dbClient.query(`
        SELECT birth_date FROM clients WHERE id = $1
    `, [clientId]);
    
    if (clientResult.rows.length === 0) return false;
    
    const birthDate = new Date(clientResult.rows[0].birth_date);
    const today = new Date();
    
    // Проверяем, сегодня ли день рождения (месяц и день)
    const isBirthday = birthDate.getMonth() === today.getMonth() && 
                      birthDate.getDate() === today.getDate();
    
    if (!isBirthday) {
        console.log(`❌ У клиента ${clientId} сегодня не день рождения`);
        return false;
    }
    
    // Проверяем, не получал ли уже бонус в этом году
    const yearStart = new Date(today.getFullYear(), 0, 1);
    const existingBirthdayBonus = await dbClient.query(`
        SELECT COUNT(*) as count 
        FROM bonus_transactions 
        WHERE client_id = $1 
        AND bonus_setting_id = $2 
        AND created_at >= $3
    `, [clientId, bonus.id, yearStart]);
    
    if (parseInt(existingBirthdayBonus.rows[0].count) > 0) {
        console.log(`❌ Клиент ${clientId} уже получил birthday бонус в этом году`);
        return false;
    }
    
    return true;
}

/**
 * Начисляет бонус клиенту
 */
async function awardBonus(dbClient, clientId, bonus, eventData) {
    try {
        // Получаем кошелек клиента
        const walletResult = await dbClient.query(`
            SELECT id FROM wallets WHERE client_id = $1
        `, [clientId]);
        
        if (walletResult.rows.length === 0) {
            throw new Error('Кошелек клиента не найден');
        }
        
        const walletId = walletResult.rows[0].id;
        
        // Начисляем бонус на кошелек
        await dbClient.query(`
            UPDATE wallets 
            SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
            WHERE id = $2
        `, [bonus.bonus_amount, walletId]);
        
        // Создаем транзакцию
        const description = generateBonusDescription(bonus, eventData);
        await dbClient.query(`
            INSERT INTO transactions (wallet_id, amount, type, description)
            VALUES ($1, $2, 'bonus', $3)
        `, [walletId, bonus.bonus_amount, description]);
        
        // Создаем запись в bonus_transactions
        await dbClient.query(`
            INSERT INTO bonus_transactions (client_id, bonus_setting_id, amount, description, status, approved_at)
            VALUES ($1, $2, $3, $4, 'approved', CURRENT_TIMESTAMP)
        `, [clientId, bonus.id, bonus.bonus_amount, description]);
        
        console.log(`✅ Начислен бонус ${bonus.bonus_amount}₽ клиенту ${clientId} за акцию "${bonus.name}"`);
        
        // Отправляем уведомление клиенту (опционально)
        await notifyClientAboutBonus(clientId, bonus, eventData);
        
    } catch (error) {
        console.error('Ошибка при начислении бонуса:', error);
        throw error;
    }
}

/**
 * Генерирует описание для бонуса
 */
function generateBonusDescription(bonus, eventData) {
    const descriptions = {
        'registration': `Бонус за регистрацию - ${bonus.name}`,
        'booking': `Бонус за запись на тренировку - ${bonus.name}`,
        'referral': `Реферальный бонус - ${bonus.name}`,
        'group_booking': `Бонус за групповую тренировку - ${bonus.name}`,
        'individual_booking': `Бонус за индивидуальную тренировку - ${bonus.name}`,
        'attendance_milestone': `Бонус за посещение ${bonus.bonus_amount} тренировок - ${bonus.name}`,
        'subscription_purchase': `Бонус за покупку абонемента - ${bonus.name}`,
        'early_booking': `Бонус за раннюю запись - ${bonus.name}`,
        'review': `Бонус за отзыв - ${bonus.name}`,
        'birthday': `Бонус на день рождения - ${bonus.name}`,
        'morning_training': `Бонус за утреннюю тренировку - ${bonus.name}`,
        'evening_training': `Бонус за вечернюю тренировку - ${bonus.name}`
    };
    
    return descriptions[bonus.bonus_type] || `Бонус - ${bonus.name}`;
}

/**
 * Подсчитывает общее количество тренировок клиента
 */
async function getTotalTrainings(dbClient, clientId) {
    // Групповые тренировки
    const groupResult = await dbClient.query(`
        SELECT COUNT(*) as count 
        FROM session_participants 
        WHERE client_id = $1 
        AND status IN ('confirmed', 'completed')
    `, [clientId]);
    
    // Индивидуальные тренировки
    const individualResult = await dbClient.query(`
        SELECT COUNT(*) as count 
        FROM individual_training_sessions 
        WHERE client_id = $1
    `, [clientId]);
    
    return parseInt(groupResult.rows[0].count) + parseInt(individualResult.rows[0].count);
}

/**
 * Отправляет уведомление клиенту о начислении бонуса
 */
async function notifyClientAboutBonus(clientId, bonus, eventData) {
    try {
        // Получаем telegram_id клиента
        const clientResult = await pool.query(`
            SELECT telegram_id, full_name FROM clients WHERE id = $1
        `, [clientId]);
        
        if (clientResult.rows.length === 0) return;
        
        const telegramId = clientResult.rows[0].telegram_id;
        const clientName = clientResult.rows[0].full_name;
        
        // Импортируем бота
        const TelegramBot = require('telegram-bot-api');
        const bot = new TelegramBot(process.env.BOT_TOKEN);
        
        const message = `🎉 Поздравляем, ${clientName}!\n\n` +
            `💰 Вам начислен бонус ${bonus.bonus_amount}₽!\n` +
            `🎁 Акция: ${bonus.name}\n\n` +
            `💳 Бонус зачислен на ваш баланс и уже доступен для использования!`;
        
        await bot.sendMessage(telegramId, message);
        
    } catch (error) {
        console.error('Ошибка при отправке уведомления о бонусе:', error);
        // Не прерываем основной процесс при ошибке уведомления
    }
}

module.exports = {
    checkAndAwardBonus,
    checkMilestoneBonuses: async (clientId) => {
        await checkAndAwardBonus('attendance_milestone', clientId);
    },
    getTotalTrainings: async (clientId) => {
        const client = await pool.connect();
        try {
            return await getTotalTrainings(client, clientId);
        } finally {
            client.release();
        }
    }
};
