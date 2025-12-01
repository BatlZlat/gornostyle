require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const { notifyNewTrainingRequest, notifyNewIndividualTraining, notifyAdminGroupTrainingCancellation, notifyAdminIndividualTrainingCancellation, notifyNewClient, notifyAdminNaturalSlopeTrainingCancellation, notifyAdminNaturalSlopeTrainingBooking, notifyInstructorKuligaTrainingBooking } = require('./admin-notify');
const { Booking } = require('../models/Booking');
const jwt = require('jsonwebtoken');
const { getClientWithSettings, updateClientSilentMode } = require('../services/silent-notification-helper');
const axios = require('axios');
const { checkAndUseSubscription, returnSubscriptionSession, checkTrainingSubscriptionUsage } = require('../services/subscription-helper');
const { normalizePhone } = require('../utils/phone-normalizer');
const moment = require('moment-timezone');

// Функция для получения названия места по location
function getLocationDisplayName(location) {
    if (!location) {
        return 'База отдыха «Кулига-Клуб»'; // Fallback
    }
    const locationNames = {
        'kuliga': 'База отдыха «Кулига-Клуб»',
        'vorona': 'Воронинские горки'
    };
    return locationNames[location] || 'База отдыха «Кулига-Клуб»';
}

// Настройка подключения к БД
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Проверяем наличие токена бота
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ Ошибка: TELEGRAM_BOT_TOKEN не настроен в .env файле');
    process.exit(1);
}

// Создаем экземпляр бота с обработкой ошибок
let bot;
const userStates = new Map();

try {
    // Создаем бота с отложенным запуском polling для избежания падения при сетевых ошибках
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// Глобальный обработчик ошибок бота
bot.on('polling_error', (error) => {
        console.error('❌ Ошибка polling клиентского бота:', error.code || 'EFATAL', error.message);
        // Не падаем, просто логируем ошибку
        // Бот автоматически попытается переподключиться
});

bot.on('error', (error) => {
        console.error('❌ Ошибка клиентского бота:', error.code || 'ERROR', error.message);
});
    
    // Запускаем polling с обработкой ошибок асинхронно
    // Это предотвращает падение приложения при проблемах с сетью
    setTimeout(() => {
        bot.startPolling().catch((error) => {
            console.error('❌ Ошибка при запуске polling клиентского бота:', error.message);
            console.log('⚠️ Клиентский бот будет перезапущен через 30 секунд...');
            
            // Retry через 30 секунд
            setTimeout(() => {
                bot.startPolling().catch((retryError) => {
                    console.error('❌ Ошибка при повторном подключении клиентского бота:', retryError.message);
                    console.log('⚠️ Клиентский бот будет работать в ограниченном режиме');
                });
            }, 30000);
        });
    }, 1000); // Небольшая задержка для инициализации
    
    console.log('🤖 Клиентский бот запущен...');
} catch (error) {
    console.error('❌ Критическая ошибка при создании клиентского бота:', error.message);
    console.log('⚠️ Приложение продолжит работу, но клиентский бот недоступен');
    // Создаем заглушку, чтобы не падало приложение
    bot = {
        sendMessage: async () => {
            console.warn('⚠️ Клиентский бот недоступен, сообщение не отправлено');
            return Promise.resolve();
        },
        onText: () => {},
        on: () => {},
        onMessage: () => {},
        startPolling: () => Promise.resolve()
    };
}

// Безопасная отправка сообщений с обработкой ошибок
async function safeSendMessage(chatId, text, options = {}) {
    try {
        return await bot.sendMessage(chatId, text, options);
    } catch (error) {
        if (error.response && error.response.body) {
            const errorBody = error.response.body;
            console.error(`❌ Ошибка отправки сообщения пользователю ${chatId}:`, errorBody.description);
            
            // Если пользователь заблокировал бота или деактивирован
            if (errorBody.error_code === 403) {
                console.warn(`⚠️ Пользователь ${chatId} заблокировал бота или деактивирован`);
                // Можно добавить логику для пометки пользователя как неактивного в БД
            }
        } else {
            console.error(`❌ Ошибка отправки сообщения пользователю ${chatId}:`, error.message);
        }
        return null;
    }
}

// Экспортируем бота для использования в других модулях
module.exports = { bot, userStates, safeSendMessage };

// Функция для получения JWT токена
function getJWTToken() {
    return jwt.sign(
        { 
            type: 'bot',
            timestamp: Date.now() 
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function showMainMenu(chatId, telegramId = null) {
    return bot.sendMessage(chatId, 'Выберите действие:', {
        reply_markup: {
            keyboard: [
                ['📝 Записаться на тренировку'],
                ['📋 Мои записи', '👤 Личный кабинет'],
                ['🎁 Сертификаты', '💰 Кошелек'],
                // ['🎫 Абонементы'], // Временно закомментировано
                ['📤 Поделиться ботом', '⚙️ Настройка уведомлений']
            ],
            resize_keyboard: true,
            one_time_keyboard: false,
            persistent: true
        }
    });
}

// Валидация
function validateDate(dateStr) {
    const [day, month, year] = dateStr.split('.');
    
    // Проверяем, что все части даты являются числами
    if (!day || !month || !year || isNaN(day) || isNaN(month) || isNaN(year)) {
        return null;
    }
    
    // Создаем дату в UTC с учетом часового пояса Екатеринбурга (UTC+5)
    const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0));
    
    // Проверяем корректность даты
    if (date.getUTCDate() !== parseInt(day) || 
        date.getUTCMonth() !== parseInt(month) - 1 || 
        date.getUTCFullYear() !== parseInt(year)) {
        return null;
    }
    
    // Возвращаем дату в формате YYYY-MM-DD для PostgreSQL
    return date.toISOString().split('T')[0];
}

// Получение максимальной даты расписания
async function getMaxScheduleDate() {
    try {
        const result = await pool.query(
            "SELECT TO_CHAR(MAX(date), 'YYYY-MM-DD') as max_date FROM schedule"
        );
        return result.rows[0]?.max_date || null;
    } catch (error) {
        console.error('Ошибка при получении максимальной даты расписания:', error);
        return null;
    }
}

// Получение текущей даты в часовом поясе Екатеринбурга
function getCurrentDateInYekaterinburg() {
    const now = new Date();
    const yekaterinburgOffset = 5 * 60; // UTC+5 в минутах
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const yekaterinburgTime = new Date(utc + (yekaterinburgOffset * 60000));
    return yekaterinburgTime.toISOString().split('T')[0];
}

// Проверка даты с юмористическими сообщениями
async function validateDateWithHumor(dateStr, trainingType = 'individual') {
    // Сначала проверяем корректность формата
    const date = validateDate(dateStr);
    if (!date) {
        return {
            valid: false,
            message: '❌ Неверный формат даты. Пожалуйста, используйте формат ДД.ММ.ГГГГ\nНапример: 25.12.2024',
            date: null
        };
    }

    // Получаем текущую дату в часовом поясе Екатеринбурга
    const currentDate = getCurrentDateInYekaterinburg();
    
    // Проверяем, что дата не в прошлом
    if (date < currentDate) {
        const message = trainingType === 'suggestion' 
            ? '⏰ Ой-ой! Похоже, вы пытаетесь предложить тренировку в прошлом! 🕰️\n\nК сожалению, я не могу предложить прошедшую дату - моя машина времени в ремонте! 😅\n\nДавайте выберем дату в будущем - у вас еще все впереди! 🎿✨'
            : '⏰ Ой-ой! Похоже, вы пытаетесь записаться на тренировку в прошлом! 🕰️\n\nК сожалению, я не могу предложить прошедшую дату - моя машина времени в ремонте! 😅\n\nДавайте выберем дату в будущем - у вас еще все впереди! 🎿✨';
        
        return {
            valid: false,
            message: message,
            date: null
        };
    }

    // Проверяем максимальную дату расписания только для индивидуальных тренировок
    if (trainingType === 'individual' || trainingType === 'natural_slope_individual') {
        const maxScheduleDate = await getMaxScheduleDate();
        
        // Проверяем, что дата не превышает максимальную дату расписания
        if (maxScheduleDate && date > maxScheduleDate) {
            const [year, month, day] = maxScheduleDate.split('-');
            const formattedMaxDate = `${day}.${month}.${year}`;
            
            const message = `🔮 Вау! Вы планируете так далеко вперед! Но честно говоря, я даже не знаю, что будет завтра! 😄\n\nК сожалению, расписание составлено только до ${formattedMaxDate}. Давайте выберем дату в этом диапазоне? 🎯\n\nМы же не хотим гадать на кофейной гуще! ☕`;
            
            return {
                valid: false,
                message: message,
                date: null
            };
        }
    }

    // Дополнительная проверка для зимних тренировок (только выходные)
    if (trainingType === 'natural_slope_individual') {
        // Убираем проверку выходных дней - теперь проверяем наличие расписания в БД
        // const dayOfWeek = date.getDay(); // 0 = воскресенье, 6 = суббота
        // if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        //     return {
        //         valid: false,
        //         message: '🏔️ *Зимние тренировки доступны только по выходным!*\n\n' +
        //                  'Выберите субботу или воскресенье для записи на естественный склон. 🎿\n\n' +
        //                  'В будние дни работают только тренажеры! 🏠',
        //         date: null
        //     };
        // }
    }

    return {
        valid: true,
        message: null,
        date: date
    };
}

function validatePhone(phone) {
    return /^\+7\d{10}$/.test(phone) ? phone : null;
}
function formatWalletNumber(number) {
    return number.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1-$2-$3-$4');
}

// Получение клиента
async function getClientByTelegramId(telegramId) {
    try {
    const res = await pool.query(
        `SELECT c.*, w.wallet_number, w.balance FROM clients c LEFT JOIN wallets w ON c.id = w.client_id WHERE c.telegram_id = $1`,
        [telegramId]
    );
    if (res.rows[0] && res.rows[0].wallet_number) {
        res.rows[0].wallet_number = formatWalletNumber(res.rows[0].wallet_number);
    }
    return res.rows[0];
    } catch (error) {
        console.error('Ошибка при получении клиента по telegram_id:', error);
        throw error;
    }
}

// Генерация уникального номера кошелька
async function generateUniqueWalletNumber() {
    const generateNumber = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join('');
    let walletNumber, isUnique = false, attempts = 0;
    while (!isUnique && attempts < 10) {
        walletNumber = generateNumber();
        const result = await pool.query('SELECT COUNT(*) FROM wallets WHERE wallet_number = $1', [walletNumber]);
        if (result.rows[0].count === '0') isUnique = true;
        attempts++;
    }
    if (!isUnique) throw new Error('Не удалось сгенерировать уникальный номер кошелька');
    return walletNumber;
}

// Регистрация клиента
async function registerClient(data) {
    console.log('Начало регистрации клиента:', data);
    
    // Проверяем обязательные поля
    if (!data.full_name || !data.birth_date || !data.phone || !data.telegram_id || !data.email) {
        throw new Error('Отсутствуют обязательные поля для регистрации');
    }
    
    // Валидация формата email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
        throw new Error('Неверный формат email');
    }

    const dbClient = await pool.connect();
    try {
        console.log('Начало транзакции');
        await dbClient.query('BEGIN');
        
        // Генерируем уникальный реферальный код для нового клиента
        const newReferralCode = await generateUniqueReferralCode();
        console.log('Сгенерирован реферальный код:', newReferralCode);
        
        // Если есть реферальный код пригласившего, проверяем его
        let referrerId = null;
        if (data.referral_code) {
            const referrerResult = await dbClient.query(
                'SELECT id FROM clients WHERE referral_code = $1',
                [data.referral_code]
            );
            if (referrerResult.rows.length > 0) {
                referrerId = referrerResult.rows[0].id;
                console.log('Найден пригласивший пользователь, ID:', referrerId);
            }
        }
        
        // Проверяем, есть ли уже клиент с таким telegram_id (приоритетная проверка)
        let existingClientResult = await dbClient.query(
            `SELECT id, telegram_id, birth_date, phone FROM clients 
             WHERE telegram_id = $1 
             LIMIT 1`,
            [data.telegram_id]
        );
        
        let clientId;
        let existingClient = null;
        
        if (existingClientResult.rows.length > 0) {
            // Клиент найден по telegram_id
            existingClient = existingClientResult.rows[0];
            clientId = existingClient.id;
            
            console.log(`✅ Найден существующий клиент по telegram_id (ID: ${clientId}), обновляем данные`);
            
            await dbClient.query(
                `UPDATE clients 
                 SET telegram_username = $1, 
                     nickname = $2,
                     full_name = $3,
                     birth_date = $4,
                     email = $5,
                     phone = COALESCE(phone, $6),
                     referral_code = COALESCE(referral_code, $7),
                     referred_by = COALESCE(referred_by, $8),
                     skill_level = COALESCE(skill_level, 1),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $9`,
                [data.username || null, data.nickname, data.full_name, data.birth_date, data.email, data.phone, newReferralCode, referrerId, clientId]
            );
            
            console.log('✅ Клиент обновлен для интеграции с ботом');
        } else {
            // МИГРАЦИЯ 033: Проверяем, есть ли уже клиент с таким телефоном
            // (возможно, зарегистрирован через сайт Кулиги, но не имеет telegram_id)
            const normalizedPhone = data.phone.replace(/[\s\-\(\)]/g, '');
            existingClientResult = await dbClient.query(
                `SELECT id, telegram_id, birth_date FROM clients 
                 WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') = $1 
                   AND (telegram_id IS NULL OR telegram_id = '')
                 LIMIT 1`,
                [normalizedPhone]
            );
            
            if (existingClientResult.rows.length > 0) {
                // Клиент найден по телефону, но без telegram_id
                existingClient = existingClientResult.rows[0];
                clientId = existingClient.id;
                
                console.log(`✅ МИГРАЦИЯ 033: Найден существующий клиент по телефону (ID: ${clientId}), добавляем telegram_id`);
                
                await dbClient.query(
                    `UPDATE clients 
                     SET telegram_id = $1, 
                         telegram_username = $2, 
                         nickname = $3,
                         full_name = $4,
                         birth_date = $5,
                         email = $6,
                         referral_code = COALESCE(referral_code, $7),
                         referred_by = COALESCE(referred_by, $8),
                         skill_level = COALESCE(skill_level, 1),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $9`,
                    [data.telegram_id, data.username || null, data.nickname, data.full_name, data.birth_date, data.email, newReferralCode, referrerId, clientId]
                );
                
                console.log('✅ Клиент обновлен для интеграции с ботом');
            } else {
                // Клиент не найден, создаем нового
                const res = await dbClient.query(
                    `INSERT INTO clients (full_name, birth_date, phone, email, telegram_id, telegram_username, nickname, skill_level, referral_code, referred_by) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9) RETURNING id`,
                    [data.full_name, data.birth_date, data.phone, data.email, data.telegram_id, data.username || null, data.nickname, newReferralCode, referrerId]
                );
                
                console.log('Клиент создан, ID:', res.rows[0].id);
                clientId = res.rows[0].id;
            }
        }
        
        // Проверяем, есть ли уже кошелек у клиента (может быть создан через сайт)
        const walletCheckResult = await dbClient.query(
            'SELECT id, wallet_number FROM wallets WHERE client_id = $1 LIMIT 1',
            [clientId]
        );
        
        let walletId;
        let walletNumber;
        if (walletCheckResult.rows.length > 0) {
            // Кошелек уже существует
            walletId = walletCheckResult.rows[0].id;
            walletNumber = walletCheckResult.rows[0].wallet_number;
            console.log('✅ Кошелек уже существует, ID:', walletId, 'номер:', walletNumber);
        } else {
            // Создаем кошелек
            walletNumber = await generateUniqueWalletNumber();
            console.log('Создание кошелька:', walletNumber);
            const walletResult = await dbClient.query(
                `INSERT INTO wallets (client_id, wallet_number, balance) 
                 VALUES ($1, $2, 0) RETURNING id`,
                [clientId, walletNumber]
            );
            walletId = walletResult.rows[0].id;
        }
        
        // Если есть пригласивший, создаем запись в referral_transactions и начисляем бонус приглашенному
        if (referrerId) {
            // Получаем сумму бонуса из настроек
            const bonusSettingsResult = await dbClient.query(
                `SELECT bonus_amount FROM bonus_settings 
                 WHERE bonus_type = 'referral' AND is_active = TRUE 
                 ORDER BY created_at DESC LIMIT 1`
            );
            
            const refereeBonus = bonusSettingsResult.rows.length > 0 
                ? bonusSettingsResult.rows[0].bonus_amount 
                : 500.00;
            
            // Создаем запись в referral_transactions
            // Проверяем наличие колонок в таблице для совместимости
            const columnsCheck = await dbClient.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'referral_transactions' 
                AND column_name IN ('referee_bonus_paid', 'referral_code')
            `);
            
            const hasRefereeBonusPaid = columnsCheck.rows.some(r => r.column_name === 'referee_bonus_paid');
            const hasReferralCode = columnsCheck.rows.some(r => r.column_name === 'referral_code');
            
            // Получаем реферальный код пригласившего
            const referrerCodeResult = await dbClient.query(
                'SELECT referral_code FROM clients WHERE id = $1',
                [referrerId]
            );
            const referrerCode = referrerCodeResult.rows[0]?.referral_code || 'UNKNOWN';
            
            let referralInsertQuery;
            let referralParams;
            
            if (hasRefereeBonusPaid && hasReferralCode) {
                // Новая структура с referee_bonus_paid и referral_code
                referralInsertQuery = `INSERT INTO referral_transactions (referrer_id, referee_id, referral_code, status, referee_bonus, referee_bonus_paid, registration_date) 
                                     VALUES ($1, $2, $3, 'registered', $4, TRUE, CURRENT_TIMESTAMP) RETURNING id`;
                referralParams = [referrerId, clientId, referrerCode, refereeBonus];
            } else if (hasReferralCode) {
                // Структура с referral_code, но без referee_bonus_paid
                referralInsertQuery = `INSERT INTO referral_transactions (referrer_id, referee_id, referral_code, status, referee_bonus, registration_date) 
                                     VALUES ($1, $2, $3, 'registered', $4, CURRENT_TIMESTAMP) RETURNING id`;
                referralParams = [referrerId, clientId, referrerCode, refereeBonus];
            } else {
                // Старая структура без referral_code и referee_bonus_paid
                referralInsertQuery = `INSERT INTO referral_transactions (referrer_id, referee_id, status, referee_bonus) 
                                     VALUES ($1, $2, 'registered', $3) RETURNING id`;
                referralParams = [referrerId, clientId, refereeBonus];
            }
            
            const referralResult = await dbClient.query(referralInsertQuery, referralParams);
            console.log('Создана реферальная транзакция: referrer_id =', referrerId, ', referee_id =', clientId);
            
            // Начисляем бонус приглашенному сразу после регистрации
            await dbClient.query(
                `UPDATE wallets 
                 SET balance = balance + $1, last_updated = CURRENT_TIMESTAMP 
                 WHERE id = $2`,
                [refereeBonus, walletId]
            );
            
            await dbClient.query(
                `INSERT INTO transactions (wallet_id, amount, type, description)
                 VALUES ($1, $2, 'bonus', $3)`,
                [
                    walletId,
                    refereeBonus,
                    `Реферальный бонус за регистрацию по ссылке`
                ]
            );
            
            // Создаем запись в bonus_transactions
            const bonusSettingIdResult = await dbClient.query(
                `SELECT id FROM bonus_settings WHERE bonus_type = 'referral' AND is_active = TRUE LIMIT 1`
            );
            
            if (bonusSettingIdResult.rows.length > 0) {
                const bonusSettingId = bonusSettingIdResult.rows[0].id;
                await dbClient.query(
                    `INSERT INTO bonus_transactions (client_id, bonus_setting_id, amount, description, status, approved_at)
                     VALUES ($1, $2, $3, $4, 'approved', CURRENT_TIMESTAMP)`,
                    [
                        clientId,
                        bonusSettingId,
                        refereeBonus,
                        `Реферальный бонус за регистрацию по реферальной ссылке`
                    ]
                );
            }
            
            console.log(`✅ Начислено ${refereeBonus}₽ приглашенному (ID: ${clientId}) сразу после регистрации`);
            
            // Отправляем уведомление приглашенному о получении бонуса
            try {
                const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
                if (TELEGRAM_BOT_TOKEN && data.telegram_id) {
                    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: data.telegram_id,
                            text: `🎉 *Поздравляем!*\n\nВам начислено *${Math.round(refereeBonus)}₽* на баланс за регистрацию по реферальной ссылке!\n\n💡 Эта сумма поможет оплатить первую тренировку со скидкой.\n\nСпасибо, что присоединились к нам! 🎁`,
                            parse_mode: 'Markdown'
                        })
                    });
                }
            } catch (notificationError) {
                console.error('Ошибка при отправке уведомления приглашенному о бонусе:', notificationError);
            }
            
            // Отправляем уведомление пригласившему о регистрации реферала
            try {
                const referrerResult = await dbClient.query(
                    'SELECT telegram_id, full_name FROM clients WHERE id = $1',
                    [referrerId]
                );
                
                if (referrerResult.rows.length > 0 && referrerResult.rows[0].telegram_id) {
                    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
                    const refereeName = data.full_name;
                    const bonusAmount = Math.round(refereeBonus);
                    
                    if (TELEGRAM_BOT_TOKEN) {
                        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: referrerResult.rows[0].telegram_id,
                                text: `🎉 *Поздравляем!*\n\nВаш реферал *${refereeName}* зарегистрировался в боте.\n\nПосле первой тренировки ${refereeName} вы получите ${bonusAmount}₽.\n\nСпасибо, что помогаете нам развиваться! Приглашайте больше друзей и получайте больше бонусов. 🎁`,
                                parse_mode: 'Markdown'
                            })
                        });
                        console.log(`✅ Отправлено уведомление пригласившему (ID: ${referrerId}) о регистрации реферала`);
                    }
                }
            } catch (notificationError) {
                console.error('Ошибка при отправке уведомления пригласившему о регистрации реферала:', notificationError);
            }
        }
        
        // Если есть данные о ребенке, создаем запись
        if (data.child && data.child.full_name && data.child.birth_date) {
            console.log('Создание записи о ребенке');
            await dbClient.query(
                `INSERT INTO children (parent_id, full_name, birth_date, sport_type, skill_level) 
                 VALUES ($1, $2, $3, 'ski', 1)`,
                [clientId, data.child.full_name, data.child.birth_date]
            );
            console.log('Запись о ребенке создана');
        }
        
        // Сохраняем согласие на обработку персональных данных
        // Получаем активную версию политики конфиденциальности
        const policyResult = await dbClient.query(
            `SELECT id, version FROM privacy_policies 
             WHERE is_active = true 
             ORDER BY effective_date DESC 
             LIMIT 1`
        );
        
        if (policyResult.rows.length > 0) {
            const policy = policyResult.rows[0];
            console.log(`Сохранение согласия на обработку ПД для клиента ${clientId}, политика версия ${policy.version}`);
            
            await dbClient.query(
                `INSERT INTO privacy_consents (client_id, policy_id, consent_type, telegram_id, is_legacy)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (client_id, consent_type, policy_id) DO NOTHING`,
                [clientId, policy.id, 'registration', data.telegram_id, false]
            );
            console.log('Согласие на обработку ПД сохранено');
        } else {
            console.warn('⚠️ ВНИМАНИЕ: Не найдена активная политика конфиденциальности. Согласие не сохранено.');
        }
        
        await dbClient.query('COMMIT');
        console.log('Транзакция успешно завершена');
        return { id: clientId, walletNumber: formatWalletNumber(walletNumber), referralCode: newReferralCode };
    } catch (e) {
        console.error('Ошибка при регистрации клиента:', e);
        await dbClient.query('ROLLBACK');
        throw e;
    } finally {
        dbClient.release();
    }
}

// Функция показа согласия на обработку персональных данных
async function showPrivacyConsent(chatId, data) {
    // Используем BASE_URL из env (если есть), иначе fallback на правильный домен
    let websiteUrl = process.env.BASE_URL || process.env.WEBSITE_URL || 'https://gornostyle72.ru';
    
    // Убираем завершающий слеш, если есть
    websiteUrl = websiteUrl.replace(/\/$/, '');
    
    // Формируем полный URL для политики конфиденциальности
    const privacyPolicyUrl = `${websiteUrl}/privacy-policy`;
    
    console.log(`[showPrivacyConsent] URL политики конфиденциальности: ${privacyPolicyUrl}`);
    
    await bot.sendMessage(chatId, 
        '📋 *Согласие на обработку персональных данных*\n\n' +
        'Для завершения регистрации необходимо ваше согласие на обработку персональных данных в соответствии с ФЗ-152.\n\n' +
        'Мы обрабатываем ваши данные для:\n' +
        '• Организации тренировок и записи на занятия\n' +
        '• Ведения вашего кошелька и обработки платежей\n' +
        '• Коммуникации и уведомлений\n\n' +
        'Подробная информация в политике конфиденциальности.',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📄 Ознакомиться с полной политикой', url: privacyPolicyUrl }],
                    [
                        { text: '✅ Согласен', callback_data: 'consent_agree' },
                        { text: '❌ Не согласен', callback_data: 'consent_disagree' }
                    ]
                ]
            }
        }
    );
}

// Функция завершения регистрации
async function finishRegistration(chatId, data) {
    try {
        const result = await registerClient(data);
        // Уведомляем админов о новом клиенте
        await notifyNewClient({
            full_name: data.full_name,
            birth_date: data.birth_date,
            phone: data.phone,
            skill_level: 1, // всегда 1 при регистрации
            child: data.child
        });
        
        let registrationMessage = '✅ *Регистрация успешно завершена!*\n\n' +
            '🎉 Добро пожаловать в Ski-instruktor!\n\n' +
            '— *Записывайтесь на тренировки, управляйте своими занятиями и балансом прямо в Telegram!*\n\n';
        
        // Если пользователь пришел по реферальной ссылке, показываем информацию о бонусе
        if (data.referral_code) {
            // Проверяем, активна ли реферальная программа
            const referralActiveResult = await pool.query(
                `SELECT bonus_amount FROM bonus_settings 
                 WHERE bonus_type = 'referral' AND is_active = TRUE 
                 ORDER BY created_at DESC LIMIT 1`
            );
            
            const isReferralActive = referralActiveResult.rows.length > 0;
            
            if (isReferralActive) {
                const bonusAmount = Math.round(referralActiveResult.rows[0].bonus_amount);
                registrationMessage += '🎁 *Вы пришли по реферальной ссылке!*\n' +
                    `✅ Вам уже начислено *${bonusAmount}₽* на баланс!\n` +
                    `💡 Эта сумма поможет оплатить первую тренировку со скидкой.\n\n` +
                    `💰 Ваш друг получит *${bonusAmount}₽* после того, как вы пополните баланс и пройдете первую тренировку.\n\n`;
            } else {
                registrationMessage += '🎁 *Вы пришли по реферальной ссылке!*\n' +
                    'Спасибо, что присоединились к нам!\n\n';
            }
        }
        
        // Проверяем и начисляем бонусы за регистрацию
        try {
            const { checkAndAwardBonus } = require('../services/bonus-system');
            await checkAndAwardBonus('registration', result.id, {
                amount: 0,
                description: 'Регистрация нового пользователя'
            });
        } catch (error) {
            console.error('Ошибка при начислении бонуса за регистрацию:', error);
            // Не прерываем основной процесс
        }
        
        registrationMessage += '👥 *Групповые тренировки выгоднее!* Если не удалось собрать свою команду, просто оставьте заявку через пункт меню "Записаться на тренировку" → "Предложить тренировку". Мы с радостью поможем вам найти единомышленников! 🏂\n\n' +
            '👤 *В личном кабинете* вы всегда можете добавить друзей, родственников, детей, для удобной записи их на групповые или индивидуальные тренировки.\n\n' +
            '💳 *Пополнение баланса* — легко и просто! Пополняйте счет на любую сумму. Главное — не забудьте указать номер вашего кошелька в комментарии к платежу. Если забыли — не беда, поддержка всегда на связи! 😉\n\n' +
            '🎁 *Подарочные сертификаты* — отличный способ порадовать друга или близкого. Дарите спорт и хорошее настроение!\n\n' +
            '📤 *Приглашайте друзей!* Используйте кнопку "Поделиться ботом" и получайте бонусы за каждого приведенного друга!\n\n' +
            `• Если возникли вопросы — пишите или звоните в поддержку: ${process.env.ADMIN_PHONE || 'не указан'}\n\n`;
        
        await bot.sendMessage(chatId, registrationMessage,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['📝 Записаться на тренировку'],
                        ['📋 Мои записи', '👤 Личный кабинет'],
                        ['🎁 Сертификаты', '💰 Кошелек'],
                        ['📤 Поделиться ботом', '⚙️ Настройка уведомлений']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false,
                    persistent: true
                }
            }
        );
        userStates.delete(chatId);
    } catch (error) {
        console.error('Ошибка при регистрации:', error);
        await bot.sendMessage(chatId,
            '❌ Произошла ошибка при регистрации. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Константы для типов сообщений
const MESSAGE_TYPES = {
    text: 'текстовое сообщение',
    voice: 'голосовое сообщение',
    photo: 'фотография',
    video: 'видео',
    document: 'документ',
    animation: 'анимация (GIF)',
    sticker: 'стикер'
};

const UNSUPPORTED_MESSAGE_RESPONSES = {
    voice: "🎙 Спасибо за голосовое сообщение! Пока я учусь понимать голос, давайте общаться текстом 😊",
    photo: "📸 Красивое фото! Но я пока работаю только с текстовыми сообщениями 📝",
    video: "🎥 Отличное видео! Но я пока принимаю только текстовые сообщения 📝",
    document: "📄 Спасибо за документ! Я пока работаю только с текстовыми сообщениями 📝",
    animation: "🎭 Забавная GIF-ка! Но я пока принимаю только текстовые сообщения 📝",
    sticker: "😊 Спасибо за стикер! Давайте общаться текстом 📝"
};

// Базовый обработчик сообщений
async function handleMessage(msg) {
    const chatId = msg.chat.id;
    
    // Не обрабатывать /start и /help здесь, чтобы не было двойного ответа
    if (msg.text && (msg.text.trim() === '/start' || msg.text.trim() === '/help')) {
        return;
    }

    // Логирование входящего сообщения
    console.log('Получено сообщение:', {
        chatId,
        messageType: msg.type || 'unknown',
        hasText: !!msg.text,
        timestamp: new Date().toISOString()
    });

    try {
        // Обработка команд
        if (msg.text && msg.text.startsWith('/')) {
            const command = msg.text.split(' ')[0].toLowerCase();
            switch (command) {
                // case '/start':
                //     return handleStartCommand(msg);
                case '/help':
                    return handleHelpCommand(msg);
                case '/price':
                    return handlePriceCommand(msg);
                case '/address':
                    return handleAddressCommand(msg);
                case '/band':
                    return handleTeamCommand(msg);
                default:
                    return bot.sendMessage(chatId, 
                        '❓ Неизвестная команда. Используйте /help для получения списка доступных команд.',
                        { parse_mode: 'Markdown' }
                    );
            }
        }

        // Обработка неподдерживаемых типов сообщений
        if (!msg.text) {
            const messageType = Object.keys(MESSAGE_TYPES).find(type => msg[type]);
            if (messageType && UNSUPPORTED_MESSAGE_RESPONSES[messageType]) {
                return bot.sendMessage(chatId, UNSUPPORTED_MESSAGE_RESPONSES[messageType], {
                    reply_markup: {
                        keyboard: [['🔙 В главное меню']],
                        resize_keyboard: true
                    }
                });
            }
            return bot.sendMessage(chatId, 
                '📝 Пожалуйста, отправьте текстовое сообщение. Я пока учусь работать только с текстом 😊',
                {
                    reply_markup: {
                        keyboard: [['🔙 В главное меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Обработка текстовых сообщений
        const result = await handleTextMessage(msg);
        if (!result) {
            console.warn('⚠️ handleTextMessage вернул undefined для сообщения:', msg.text);
        }
        return result;
    } catch (error) {
        console.error('❌ Ошибка при обработке сообщения:', error);
        console.error('Stack trace:', error.stack);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при обработке сообщения. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
            {
                reply_markup: {
                    keyboard: [['🔙 В главное меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Обработчик команды /help
async function handleHelpCommand(msg) {
    const chatId = msg.chat.id;
    const adminPhone = process.env.ADMIN_PHONE || 'не указан';
    await bot.sendMessage(chatId,
        'ℹ️ *Справка по работе с ботом Ski-instruktor*\n\n' +
        '• /start — начать или перезапустить работу с ботом\n\n' +
        '— *Записывайтесь на тренировки, управляйте своими занятиями и балансом прямо в Telegram!*\n\n' +
        '👥 *Групповые тренировки выгоднее!* Если не удалось собрать свою команду, просто оставьте заявку через пункт меню "Записаться на тренировку" → "Предложить тренировку". Мы с радостью поможем вам найти единомышленников и собрать команду мечты! 🏂\n\n' +
            '👤 *В личном кабинете* вы всегда можете добавить друзей, родственников, детей, для удобной записи их на групповые или индивидуальные тренировки.\n\n' +
        '💳 *Пополнение баланса* — легко и просто! Пополняйте счет на любую сумму. Главное — не забудьте указать номер вашего кошелька в комментарии к платежу. Если забыли — не беда, поддержка всегда на связи! 😉\n\n' +
        '🎁 *Подарочные сертификаты* — отличный способ порадовать друга или близкого. Дарите спорт и хорошее настроение!\n\n' +
        `• Если возникли вопросы — пишите или звоните в поддержку: ${adminPhone}\n\n`,
        { parse_mode: 'Markdown' }
    );
}

// Обработчик команды /price
async function handlePriceCommand(msg) {
    const chatId = msg.chat.id;
    const adminPhone = process.env.ADMIN_PHONE || 'не указан';

    // Получаем текущую дату в Екатеринбурге
    const now = new Date();
    const yekatTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Yekaterinburg' }));
    const day = yekatTime.getDate().toString().padStart(2, '0');
    const month = (yekatTime.getMonth() + 1).toString().padStart(2, '0');
    const year = yekatTime.getFullYear();
    const dateStr = `${day}.${month}.${year}`;

    // Получаем прайс для тренажера из базы
    let prices;
    try {
        const res = await pool.query('SELECT * FROM prices ORDER BY type, with_trainer DESC, participants, duration');
        prices = res.rows;
    } catch (e) {
        console.error('Ошибка при получении прайса тренажера:', e);
        await bot.sendMessage(chatId, '❌ Не удалось получить прайс. Попробуйте позже.');
        return;
    }

    // Получаем прайс для зимних тренировок
    let winterPrices;
    try {
        const winterRes = await pool.query(
            'SELECT * FROM winter_prices WHERE is_active = TRUE ORDER BY type, participants NULLS FIRST, duration'
        );
        winterPrices = winterRes.rows;
    } catch (e) {
        console.error('Ошибка при получении прайса зимних тренировок:', e);
        winterPrices = [];
    }

    // Формируем текст
    let message = `💸 *Актуальный прайс на тренировки*\nна дату: ${dateStr}\n\n`;

    // ============ ТРЕНИРОВКИ НА ТРЕНАЖЕРЕ ============
    message += '🎿 *Тренировки на тренажере:*\n\n';

    // Группируем прайс тренажера
    const individual = prices.filter(p => p.type === 'individual');
    const group = prices.filter(p => p.type === 'group');

    // Индивидуальные
    const indWithTrainer = individual.filter(p => p.with_trainer);
    const indWithoutTrainer = individual.filter(p => !p.with_trainer);

    // Групповые
    const groupWithTrainer = group.filter(p => p.with_trainer);
    const groupWithoutTrainer = group.filter(p => !p.with_trainer);

    message += '👤 *Индивидуальные тренировки:*\n';
    message += '👨‍🏫 С тренером:\n';
    indWithTrainer.forEach(p => {
        message += `⏱ ${p.duration} минут — ${Number(p.price).toLocaleString('ru-RU')} руб.\n`;
    });
    message += '(Быстрый прогресс и максимум внимания! 🚀)\n\n';
    message += '👤 Без тренера:\n';
    indWithoutTrainer.forEach(p => {
        message += `⏱ ${p.duration} минут — ${Number(p.price).toLocaleString('ru-RU')} руб.\n`;
    });
    message += '(Только для уверенных райдеров! 😎)\n\n';

    // Групповые
    message += '👥 *Групповые тренировки (60 минут):*\n(Чем больше народу — тем выгоднее! 🥳)\n\n';
    message += 'С тренером:\n';
    groupWithTrainer.forEach(p => {
        message += `• ${p.participants} чел — ${Number(p.price).toLocaleString('ru-RU')} руб./чел\n`;
    });
    message += '\nБез тренера:\n';
    groupWithoutTrainer.forEach(p => {
        message += `• ${p.participants} чел — ${Number(p.price).toLocaleString('ru-RU')} руб./чел\n`;
    });
    message += '\n*Запишись с друзьями и катай дешевле!*\n\n---\n\n';

    // ============ ЗИМНИЕ ТРЕНИРОВКИ (ЕСТЕСТВЕННЫЙ СКЛОН) ============
    if (winterPrices.length > 0) {
        message += '🏔️ *Зимние тренировки (естественный склон):*\n\n';

        // Индивидуальные зимние тренировки
        const winterIndividual = winterPrices.filter(p => p.type === 'individual');
        if (winterIndividual.length > 0) {
            message += '👤 *Индивидуальные тренировки:*\n';
            winterIndividual
                .sort((a, b) => a.duration - b.duration)
                .forEach(p => {
                    message += `⏱ ${p.duration} минут — ${Number(p.price).toLocaleString('ru-RU')} руб.\n`;
                });
            message += '\n';
        }

        // Спортивная группа (до 4 чел) - цена уже за человека
        const sportGroup = winterPrices.filter(p => p.type === 'sport_group');
        if (sportGroup.length > 0) {
            message += '👥 *Спортивная группа (до 4 чел):*\n';
            sportGroup
                .sort((a, b) => (a.participants || 0) - (b.participants || 0))
                .forEach(p => {
                    const pricePerPerson = Number(p.price).toLocaleString('ru-RU', { 
                        minimumFractionDigits: 0, 
                        maximumFractionDigits: 0 
                    });
                    message += `• ${p.participants} чел — ${pricePerPerson} руб./чел\n`;
                });
            message += '\n';
        }

        // Обычная группа
        const winterGroup = winterPrices.filter(p => p.type === 'group');
        if (winterGroup.length > 0) {
            message += '👥 *Обычная группа:*\n';
            message += '(Чем больше народу — тем выгоднее! 🥳)\n\n';
            winterGroup
                .sort((a, b) => (a.participants || 0) - (b.participants || 0))
                .forEach(p => {
                    // Для типа 'group' цена - общая за группу, делим на количество для показа цены за человека
                    const pricePerPerson = (Number(p.price) / (p.participants || 1)).toLocaleString('ru-RU', { 
                        minimumFractionDigits: 0, 
                        maximumFractionDigits: 0 
                    });
                    message += `• ${p.participants} чел — ${pricePerPerson} руб./чел\n`;
                });
            message += '\n*Запишись с друзьями и катай дешевле!*\n\n---\n\n';
        }
    }

    message += `❓ Остались вопросы?\nПишите или звоните администратору: ${adminPhone}`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

// Обработчик команды /address
async function handleAddressCommand(msg) {
    const chatId = msg.chat.id;
    const adminTelegram = process.env.ADMIN_TELEGRAM_USERNAME || 'не указан';
    const adminPhone = process.env.ADMIN_PHONE || 'не указан';

    const message = 
        '<b>🏗️ Адрес и контакты</b>\n\n' +
        '<b>🏗️ Наш адрес:</b>\n' +
        '<b>Улица Источник, 6в, село Яр</b>\n' +
        'По адресу нас можно найти только в 2ГИС\n\n' +
        '<b>📍 Ориентир:</b> улица Источник, 2А, село Яр\n' +
        '<b>🚪 Въезд:</b> напротив этого дома, распашные железные ворота с кирпичным забором\n\n' +
        '<b>🗺️ Как добраться:</b>\n' +
        'Район Мыса, Поселок Яр → проезжаем мимо горячего источника → доезжаем до кирпичного забора → едем вдоль забора → как только забор заканчивается, сразу направо в открытые ворота!\n\n' +
        '<b>🗺️ Наше точное местоположение:</b>\n' +
        '• 🟡 Яндекс Карты: <a href="https://clck.ru/3MiVTy">Открыть карту</a>\n' +
        '• 🔵 Google Maps: <a href="https://golnk.ru/XA1zz">Открыть карту</a>\n' +
        '• 🟢 2ГИС: <a href="https://go.2gis.com/Vt271">Открыть карту</a>\n\n' +
        '<b>💡 Совет:</b> Если заблудились — звоните, мы вам поможем найти нас! 🚗\n\n' +
        '<b>📞 Контакты для связи:</b>\n' +
        `• Telegram: ${adminTelegram}\n` +
        `• Телефон: ${adminPhone}`;

    await bot.sendMessage(chatId, message, { 
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
            keyboard: [['🔙 Назад в меню']],
            resize_keyboard: true
        }
    });
}

// Обработчик команды /band
async function handleTeamCommand(msg) {
    const chatId = msg.chat.id;

    try {
        // Получаем всех активных тренеров
        const trainersResult = await pool.query(
            'SELECT full_name, birth_date, sport_type, phone FROM trainers WHERE is_active = true ORDER BY full_name'
        );

        if (trainersResult.rows.length === 0) {
            return bot.sendMessage(chatId,
                '👥 <b>Наша команда</b>\n\n' +
                'Пока информация о тренерах обновляется. Скоро здесь появится полная информация о нашей команде! 🏂',
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        let message = '<b>👥 Наша команда</b>\n\n';
        message += '<b>🏂 Профессиональные тренеры:</b>\n\n';

        trainersResult.rows.forEach((trainer, index) => {
            const age = calculateAge(trainer.birth_date);
            const sportType = getSportTypeDisplay(trainer.sport_type);
            
            message += `<b>${index + 1}. ${trainer.full_name}</b>\n`;
            message += `📅 Возраст: ${age} лет\n`;
            message += `🎿 Вид спорта: ${sportType}\n`;
            message += `📞 Телефон: <code>${trainer.phone}</code>\n\n`;
        });

        message += '💪 <b>Наши тренеры — опытные профессионалы, которые помогут вам освоить горные лыжи и сноуборд, летом и зимой!</b>';

        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [['🔙 Назад в меню']],
                resize_keyboard: true
            }
        });

    } catch (error) {
        console.error('Ошибка при получении информации о команде:', error);
        await bot.sendMessage(chatId,
            '❌ Произошла ошибка при получении информации о команде. Пожалуйста, попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Вспомогательная функция для отображения типа спорта
function getSportTypeDisplay(sportType) {
    switch (sportType) {
        case 'ski':
            return 'Горные лыжи 🎿';
        case 'snowboard':
            return 'Сноуборд 🏂';
        case 'both':
            return 'Горные лыжи и сноуборд 🎿🏂';
        default:
            return sportType;
    }
}

const DAY_SHORT_LABELS = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

function formatDateLabel(dateStr) {
    const date = new Date(dateStr);
    const dd = date.getDate().toString().padStart(2, '0');
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    const weekday = DAY_SHORT_LABELS[date.getDay()];
    return `${dd}.${mm} (${weekday})`;
}

async function promptNaturalSlopeParticipant(chatId, client, location = 'kuliga') {
    const { rows: children } = await pool.query(
        'SELECT id, full_name FROM children WHERE parent_id = $1 ORDER BY full_name',
        [client.id]
    );

    const keyboard = [
        ['👤 Для себя'],
        ...children.map((child) => [`👶 ${child.full_name}`]),
        ['🔙 Назад']
    ];

    userStates.set(chatId, {
        step: 'natural_slope_participant_selection',
        data: {
            client_id: client.id,
            client_phone: client.phone,
            client_full_name: client.full_name,
            available_children: children,
            location: location // Сохраняем location
        }
    });

    const message = children.length
        ? '👤 *Для кого записываемся?*\n\nВыберите участника тренировки:'
        : '👤 *Запись для себя*\n\nДетей в профиле не найдено, поэтому запись можно оформить только на себя.';

    return bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: keyboard,
            resize_keyboard: true
        }
    });
}

async function promptNaturalSlopeSport(chatId, state) {
    const participantName = state.data?.participant_name || 'участника';
    state.step = 'natural_slope_individual_sport';
    userStates.set(chatId, state);

    return bot.sendMessage(chatId,
        `🏔️ *Что будем осваивать для ${participantName}?*\n\nВыберите вид спорта:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['⛷️ Горные лыжи', '🏂 Сноуборд'],
                    ['🔙 Назад']
                ],
                resize_keyboard: true
            }
        }
    );
}

async function promptNaturalSlopeInstructor(chatId, state) {
    state.step = 'natural_slope_individual_instructor';
    userStates.set(chatId, state);

    const sportType = state.data?.selected_sport || 'ski';
    const location = state.data?.location || 'kuliga';
    
    const params = [sportType === 'snowboard' ? 'snowboard' : 'ski'];
    let locationFilter = '';
    if (location && (location === 'kuliga' || location === 'vorona')) {
        params.push(location);
        locationFilter = `AND location = $${params.length}`;
    }
    
    const instructorsRes = await pool.query(
        `SELECT id, full_name, sport_type
         FROM kuliga_instructors
         WHERE is_active = TRUE
           AND (sport_type = $1 OR sport_type = 'both')
           ${locationFilter}
         ORDER BY full_name`,
        params
    );

    const instructors = instructorsRes.rows;
    state.data.available_instructors = instructors;
    userStates.set(chatId, state);

    if (!instructors.length) {
        return bot.sendMessage(chatId,
            '❌ К сожалению, пока нет доступных инструкторов для выбранного вида спорта.\nПопробуйте выбрать другой вид спорта или обратитесь к администратору.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад']],
                    resize_keyboard: true
                }
            }
        );
    }

    const instructorButtons = [
        ['🤷 Без разницы'],
        ...instructors.map((inst) => [`👨‍🏫 ${inst.full_name}`]),
        ['🔙 Назад']
    ];

    return bot.sendMessage(chatId,
        '👨‍🏫 *Выберите инструктора:*\n\nМожно выбрать конкретного тренера или оставить выбор за нами.',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: instructorButtons,
                resize_keyboard: true
            }
        }
    );
}

function showNaturalSlopeTrainingMenu(chatId) {
    userStates.set(chatId, { step: 'natural_slope_location_selection', data: {} });
    return bot.sendMessage(chatId,
        '🏔️ *Естественный склон*\n\nВыберите место проведения тренировки:',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['🏔️ База отдыха «Кулига-Клуб»'],
                    ['⛰️ Воронинские горки'],
                    ['🔙 Назад']
                ],
                resize_keyboard: true
            }
        }
    );
}

// Обработчик текстовых сообщений
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const state = userStates.get(chatId);

    console.log('📨 handleTextMessage вызван:', {
        text: msg.text,
        hasState: !!state,
        step: state ? state.step : 'NO_STATE',
        chatId,
        textStartsWithChild: msg.text && (msg.text.startsWith('👶') || msg.text.startsWith('✅'))
    });
    
    // Если state отсутствует, но это кнопка ребенка или "Себя", значит состояние потеряно
    if (!state && msg.text && (msg.text.startsWith('👶') || msg.text.startsWith('✅') || msg.text === '👤 Себя' || msg.text === '✅ Себя')) {
        console.error('⚠️ КРИТИЧЕСКОЕ: Состояние потеряно при нажатии на кнопку участника!', {
            text: msg.text,
            chatId
        });
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка. Пожалуйста, начните запись заново через меню.',
            {
                reply_markup: {
                    keyboard: [['📝 Записаться на тренировку'], ['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
    
    // Обработка кнопки "Кошелек" (работает всегда, независимо от состояния)
        if (msg.text === '💰 Кошелек') {
            try {
                const clientResult = await pool.query(
                    'SELECT c.id, c.full_name, w.wallet_number, w.balance FROM clients c JOIN wallets w ON c.id = w.client_id WHERE c.telegram_id = $1',
                    [msg.from.id.toString()]
                );
    
                if (!clientResult.rows[0]) {
                    return bot.sendMessage(chatId,
                        '❌ Ошибка: кошелек не найден. Пожалуйста, обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
    
                const { id: clientId, full_name, wallet_number: walletNumber, balance } = clientResult.rows[0];
                const formattedWalletNumber = formatWalletNumber(walletNumber);
    
                await bot.sendMessage(chatId,
                    `💳 *Информация о кошельке*\n\n` +
                    `👤 *Владелец:* ${full_name}\n` +
                    `💳 *Номер кошелька*: \`${formattedWalletNumber}\`\n` +
                    `💰 *Текущий баланс*: ${parseFloat(balance).toFixed(2)} руб.\n\n` +
                    `Выберите действие:`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['💳 Пополнить баланс'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
                return;
            } catch (error) {
                console.error('Ошибка при получении информации о кошельке:', error);
                await bot.sendMessage(chatId,
                    '❌ Произошла ошибка. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    }
                );
                return;
            }
        }

    // Обработка кнопки "Пополнить баланс"
    if (msg.text === '💳 Пополнить баланс') {
        try {
            let clientId;
            if (state && state.data && state.data.client_id) {
                clientId = state.data.client_id;
            } else {
                const clientResult = await pool.query(
                    'SELECT id FROM clients WHERE telegram_id = $1',
                    [msg.from.id.toString()]
                );
                if (!clientResult.rows[0]) {
                    return bot.sendMessage(chatId,
                        '❌ Ошибка: клиент не найден. Пожалуйста, обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                clientId = clientResult.rows[0].id;
            }
            await handleTopUpBalance(chatId, clientId);
            return;
        } catch (error) {
            console.error('Ошибка при обработке пополнения баланса:', error);
            await bot.sendMessage(chatId,
                '❌ Произошла ошибка. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                {
                    reply_markup: {
                        keyboard: [['🔙 В главное меню']],
                        resize_keyboard: true
                    }
                }
            );
            return;
        }
    }

    // Обработка кнопки "Мои записи" независимо от состояния
    if (msg.text === '📋 Мои записи') {
        return showMyBookings(chatId);
    }

    // Глобальная обработка сообщений
    if (msg.text === '🎁 Сертификаты') {
        return showCertificatesMenu(chatId);
    }

    // Обработка кнопки "Абонементы" - ВРЕМЕННО ЗАКОММЕНТИРОВАНО
    // if (msg.text === '🎫 Абонементы') {
    //     const client = await getClientByTelegramId(msg.from.id.toString());
    //     if (client) {
    //         return showSubscriptionsMenu(chatId, client.id);
    //     } else {
    //         return bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
    //     }
    // }

    // Обработка кнопки "Купить абонемент" - ВРЕМЕННО ЗАКОММЕНТИРОВАНО
    // if (msg.text === '🛒 Купить абонемент') {
    //     const client = await getClientByTelegramId(msg.from.id.toString());
    //     if (client) {
    //         return showAvailableSubscriptions(chatId, client.id);
    //     } else {
    //         return bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
    //     }
    // }

    // Обработка кнопки "Мои абонементы" - ВРЕМЕННО ЗАКОММЕНТИРОВАНО
    // if (msg.text === '📋 Мои абонементы') {
    //     const client = await getClientByTelegramId(msg.from.id.toString());
    //     if (client) {
    //         return showMySubscriptions(chatId, client.id);
    //     } else {
    //         return bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
    //     }
    // }

    // Обработка выбора абонемента для покупки - ВРЕМЕННО ЗАКОММЕНТИРОВАНО
    // if (state && state.step === 'subscription_purchase_selection') {
    //     // Проверяем кнопку "Назад" перед проверкой номера
    //     if (msg.text === '🔙 Назад в меню') {
    //         const clientId = state.data?.client_id;
    //         userStates.delete(chatId);
    //         if (clientId) {
    //             return showSubscriptionsMenu(chatId, clientId);
    //         } else {
    //             // Если clientId нет в состоянии, получаем из telegram_id
    //             const client = await getClientByTelegramId(msg.from.id.toString());
    //             if (client) {
    //                 return showSubscriptionsMenu(chatId, client.id);
    //             }
    //         }
    //     }
    //
    //     const selectedIndex = parseInt(msg.text) - 1;
    //     const subscriptions = state.data?.available_subscriptions || [];
    //
    //     if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= subscriptions.length) {
    //         return bot.sendMessage(chatId,
    //             '❌ Неверный номер абонемента. Пожалуйста, выберите номер из списка.',
    //             {
    //                 reply_markup: {
    //                     keyboard: [['🔙 Назад в меню']],
    //                     resize_keyboard: true
    //                 }
    //             }
    //         );
    //     }
    //
    //     const selectedType = subscriptions[selectedIndex];
    //     return purchaseSubscription(chatId, state.data.client_id, selectedType.id);
    // }

    // Обработка кнопки "Подарить еще сертификат"
    if (msg.text === '💝 Подарить еще сертификат') {
        return showCertificatesMenu(chatId);
    }

    // Обработка кнопки "Подарить сертификат" (из меню "Мои сертификаты")
    if (msg.text === '💝 Подарить сертификат') {
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (client) {
            return showCertificateIntro(chatId, client.id);
        } else {
            return bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
        }
    }

    // Обработка кнопки "Мои сертификаты"
    if (msg.text === '📋 Мои сертификаты') {
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (client) {
            return showUserCertificates(chatId, client.id);
        } else {
            return bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
        }
    }

    // Обработка кнопки "Активировать сертификат"
    if (msg.text === '🔑 Активировать сертификат') {
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (client) {
            return showCertificateActivation(chatId, client.id);
        } else {
            return bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
        }
    }

    // Обработка кнопки "Адрес и контакты"
    if (msg.text === '📍 Адрес и контакты') {
        return handleAddressCommand(msg);
    }
    
    if (msg.text === '👤 Личный кабинет') {
        await showPersonalCabinet(chatId);
        return;
    }

    // Обработка кнопки "Поделиться ботом"
    if (msg.text === '📤 Поделиться ботом') {
        return handleShareBotCommand(msg);
    }

    // Обработка кнопки "Настройка уведомлений"
    if (msg.text === '⚙️ Настройка уведомлений') {
        return showNotificationSettingsMenu(msg);
    }

    // Обработка кнопок выбора режима уведомлений
    if (msg.text === '🔊 Со звуком') {
        return setNotificationMode(msg, false); // false = обычный режим
    }

    if (msg.text === '🔇 Без звука') {
        return setNotificationMode(msg, true); // true = беззвучный режим
    }

    if (msg.text === '🔙 В главное меню' || msg.text === '🔙 Назад в меню') {
        const client = state && state.data && state.data.client_id ? 
            { id: state.data.client_id } : 
            await getClientByTelegramId(msg.from.id.toString());
        userStates.set(chatId, { step: 'main_menu', data: { client_id: client ? client.id : undefined } });
        return showMainMenu(chatId);
    }

    // Глобальная обработка "Добавить человека"
    if (msg.text === '➕ Добавить человека') {
        let clientId;
        if (state && state.data && state.data.client_id) {
            clientId = state.data.client_id;
        } else {
            const client = await getClientByTelegramId(msg.from.id.toString());
            if (!client) {
                return bot.sendMessage(chatId, '❌ Профиль не найден. Пожалуйста, обратитесь в поддержку.');
            }
            clientId = client.id;
        }
        userStates.set(chatId, { step: 'add_child_name', data: { client_id: clientId } });
        return bot.sendMessage(chatId, '👤 Введите ФИО человека:', {
            reply_markup: {
                keyboard: [['🔙 Отмена']],
                resize_keyboard: true
            }
        });
    }

    // Глобальная обработка "Записаться на тренировку"
    if (msg.text === '📝 Записаться на тренировку') {
        console.log('Начало процесса записи на тренировку');
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (!client) {
            return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
        }

        return bot.sendMessage(chatId,
            '🏔️ *Выберите тип склона:*\n\n' +
            '🎿 *Горнолыжный тренажер* - Горностайл72 кататься и оттачивать технику можно круглый год, в любую погоду.\n\n' +
            '🏔️ *Естественный склон* - записаться можно только после официального открытия горнолыжного сезона в Тюмени.',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['🎿 Горнолыжный тренажер'],
                        ['🏔️ Естественный склон'],
                        ['🔙 Назад в меню']
                    ],
                    resize_keyboard: true
                }
            }
        );
    }

    // Обработка "Горнолыжный тренажер"
    if (msg.text === '🎿 Горнолыжный тренажер') {
        console.log('Выбран горнолыжный тренажер');
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (!client) {
            return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
        }

        // Получаем список детей клиента
        const childrenResult = await pool.query(
            'SELECT id, full_name FROM children WHERE parent_id = $1',
            [client.id]
        );

        userStates.set(chatId, {
            step: 'training_type',
            data: { 
                client_id: client.id,
                children: childrenResult.rows
            }
        });

        return bot.sendMessage(chatId,
            '🎿 *Вы приняли решение записаться на тренировку на Горнолыжный тренажер.*\n\n' +
            '🏆 *Преимущества тренажёра:*\n\n' +
            '👥 *Подходит для всех*\n' +
            'От детей до профессионалов: тренажёр универсален\n\n' +
            '⏰ *В любое время*\n' +
            'Мы работаем в любое время года, в любую погоду, даже летом\n\n' +
            '🎯 *Удобство*\n' +
            'Не придётся стоять в очередях на подъемник и тратить время на подъемы.\n\n' +
            '🌱 *Начинающим ученикам*\n' +
            'мы быстро даём правильную технику и базовые навыки — основу для дальнейшего развития и уверенного катания на любых склонах.\n\n' +
            '🏔️ *Тем, кто уже уверенно катается на параллельных лыжах*\n' +
            'помогаем освоить карвинговый поворот, достичь больших углов закантовок и более высоких скоростей.\n\n' +
            '🎿 *Выберите тип тренировки:*\n\n' +
            '⚠️ *Напоминание:* Перед записью на тренировку убедитесь, что ваш баланс пополнен! 💰\n\n' +
            '• Групповая - тренировка в группе с другими участниками\n' +
            '• Индивидуальная - персональная тренировка\n' +
            '• Предложить тренировку - если нет подходящих групп',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['👥 Групповая'],
                        ['👤 Индивидуальная'],
                        ['💡 Предложить тренировку'],
                        ['🔙 Назад в меню']
                    ],
                    resize_keyboard: true
                }
            }
        );
    }

    // Обработка "Естественный склон"
    if (msg.text === '🏔️ Естественный склон') {
        console.log('Выбран естественный склон');
        return showNaturalSlopeTrainingMenu(chatId);
    }
        
    // Обработка "Индивидуальная тренировка" (естественный склон)
    if (msg.text === '🏔️ Индивидуальная тренировка') {
        console.log('Выбрана индивидуальная тренировка на естественном склоне');
        
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (!client) {
            return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
        }

        const currentState = userStates.get(chatId);
        const location = currentState?.data?.location || 'kuliga';
        return promptNaturalSlopeParticipant(chatId, client, location);
    }

    // Обработка "Групповая тренировка" (естественный склон)
    if (msg.text === '👥 Групповая тренировка') {
        console.log('Выбрана групповая тренировка на естественном склоне');
        
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (!client) {
            return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
        }

        const currentState = userStates.get(chatId);
        const location = currentState?.data?.location || 'kuliga';

        // Показываем выбор типа групповой тренировки
        userStates.set(chatId, {
            step: 'kuliga_group_type_selection',
            data: { client_id: client.id, location: location }
        });
            
            return bot.sendMessage(chatId,
            '👥 *Групповые тренировки на естественном склоне*\n\n' +
            'Выберите вариант записи:\n\n' +
            '• 👥 *У меня своя группа* - выберите дату и время для своей группы, укажите участников\n' +
            '• 📅 *Записаться в группу* - выберите из существующих групповых тренировок',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                    keyboard: [
                        ['👥 У меня своя группа'],
                        ['📅 Записаться в группу'],
                        ['🔙 Назад']
                    ],
                        resize_keyboard: true
                    }
                }
            );
    }

    // Обработка кнопки "🏔️ Выбрать другую тренировку" (естественный склон)
    if (msg.text === '🏔️ Выбрать другую тренировку') {
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (!client) {
            return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
        }

        const currentState = userStates.get(chatId);
        const location = currentState?.data?.location || 'kuliga';

        // Показываем доступные групповые тренировки на естественном склоне
        return showAvailableGroupTrainings(chatId, client.id, location);
    }

    // Обработка выбора участника для индивидуальной тренировки (естественный склон)
    // НЕ обрабатываем, если мы на шаге выбора участников для групповой тренировки
    if (msg.text && msg.text.startsWith('👶 ') && 
        (!state || state.step !== 'kuliga_group_own_participants' && state.step !== 'kuliga_group_existing_participants')) {
        const childName = msg.text.replace('👶 ', '');
        const client = await getClientByTelegramId(msg.from.id.toString());
        
        if (!client) {
            return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
        }

        // Находим ребенка по имени
        const childResult = await pool.query(
            'SELECT id, full_name FROM children WHERE parent_id = $1 AND full_name = $2',
            [client.id, childName]
        );

        if (childResult.rows.length === 0) {
            return bot.sendMessage(chatId, '❌ Ребенок не найден.');
        }

        const child = childResult.rows[0];

        // Получаем location из текущего состояния
        const currentState = userStates.get(chatId);
        const location = currentState?.data?.location || 'kuliga';
        
        // Устанавливаем состояние для записи ребенка
        const stateData = {
                client_id: client.id,
            client_phone: client.phone,
                participant_type: 'child',
                participant_id: child.id,
                participant_name: child.full_name,
                location: location // Сохраняем location
        };
        const newState = { step: 'natural_slope_individual_sport', data: stateData };
        userStates.set(chatId, newState);
        return promptNaturalSlopeSport(chatId, newState);
    }

    // Обработка "Для себя" для индивидуальной тренировки (естественный склон)
    if (msg.text === '👤 Для себя') {
        const client = await getClientByTelegramId(msg.from.id.toString());
        
        if (!client) {
            return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
        }

        // Получаем location из текущего состояния
        const currentState = userStates.get(chatId);
        const location = currentState?.data?.location || 'kuliga';
        
        // Устанавливаем состояние для записи самого клиента
        const stateData = {
                client_id: client.id,
            client_phone: client.phone,
                participant_type: 'self',
                participant_id: client.id,
                participant_name: client.full_name,
                location: location // Сохраняем location
        };
        const newState = { step: 'natural_slope_individual_sport', data: stateData };
        userStates.set(chatId, newState);
        return promptNaturalSlopeSport(chatId, newState);
    }

    // Обработка кнопок участников ДО switch-case
    // Обрабатываем кнопки "Себя" и детей, если состояние существует и мы на шаге выбора участников
    console.log('🔍 Проверка состояния для обработки кнопок участников:', {
        hasState: !!state,
        step: state ? state.step : 'NO_STATE',
        text: msg.text,
        isCorrectStep: state && state.step === 'kuliga_group_own_participants'
    });
    
    if (state && state.step === 'kuliga_group_own_participants') {
        console.log('✅ Состояние найдено для kuliga_group_own_participants:', {
            step: state.step,
            hasClientId: !!state.data.client_id,
            text: msg.text,
            textStartsWithBaby: msg.text ? msg.text.startsWith('👶') : false,
            textStartsWithCheck: msg.text ? msg.text.startsWith('✅') : false,
            textFirstChar: msg.text ? msg.text.charAt(0) : 'NO_TEXT',
            textFirstCharCode: msg.text ? msg.text.charCodeAt(0) : 'NO_TEXT'
        });
        // Обработка кнопки "Себя"
        if (msg.text === '👤 Себя' || msg.text === '✅ Себя') {
            console.log('🔍 Обработка "Себя" ДО switch-case');
            // Получаем данные клиента если еще не получены
            if (!state.data.client) {
                const clientResult = await pool.query(
                    'SELECT id, full_name, birth_date FROM clients WHERE id = $1',
                    [state.data.client_id]
                );
                state.data.client = clientResult.rows[0] || {};
            }

            const client = state.data.client;
            if (!client.full_name) {
                return bot.sendMessage(chatId, '❌ Ошибка: данные клиента не найдены.');
            }

            // Инициализируем selected_participants если его нет
            if (!state.data.selected_participants) {
                state.data.selected_participants = [];
            }

            // Проверяем, выбран ли уже клиент
            const existingIndex = state.data.selected_participants.findIndex(p => p.isSelf);
            if (existingIndex >= 0) {
                // Убираем из списка (повторное нажатие)
                state.data.selected_participants.splice(existingIndex, 1);
            } else {
                // Добавляем к участникам
                const age = moment().diff(moment(client.birth_date), 'years');
                state.data.selected_participants.push({
                    fullName: client.full_name,
                    birthYear: moment(client.birth_date).year(),
                    age: age,
                    isSelf: true
                });
            }
            userStates.set(chatId, state);
            console.log('💾 Состояние сохранено после "Себя" (до switch):', {
                step: state.step,
                participantsCount: state.data.selected_participants.length,
                hasChildren: !!state.data.children
            });

            // Показываем обновленный список участников
            return await showParticipantsList(chatId, state);
    }

        // Обработка выбора ребенка ДО switch-case
        // Формат кнопки: "👶 Имя (возраст)" или "✅ Имя (возраст)"
        const isChildButton = msg.text && 
            (msg.text.startsWith('👶') || msg.text.startsWith('✅')) && 
            msg.text !== '✅ Себя' && 
            msg.text !== '✅ Все указано, продолжить';
        
        console.log('🔍 Проверка кнопки ребенка ДО switch:', {
            msgText: msg.text,
            isChildButton: isChildButton,
            startsWithBaby: msg.text ? msg.text.startsWith('👶') : false,
            startsWithCheck: msg.text ? msg.text.startsWith('✅') : false,
            isNotSelf: msg.text !== '✅ Себя',
            isNotContinue: msg.text !== '✅ Все указано, продолжить',
            firstChar: msg.text ? msg.text.charAt(0) : 'NO_TEXT',
            firstCharCode: msg.text ? msg.text.charCodeAt(0) : 'NO_TEXT'
        });
        
        if (isChildButton) {
            console.log('🔍 ОБНАРУЖЕНА КНОПКА РЕБЕНКА ДО SWITCH:', {
                msgText: msg.text,
                step: state.step,
                clientId: state.data.client_id,
                msgTextLength: msg.text ? msg.text.length : 0,
                msgTextBytes: msg.text ? Buffer.from(msg.text).toString('hex') : null
            });

            // Формат кнопки: "👶 Имя (возраст)" или "✅ Имя (возраст)"
            const buttonText = msg.text.replace(/^(👶|✅)\s*/, '');
            const match = buttonText.match(/^(.+?)\s*\((\d+)\)$/);
            
            if (!match) {
                console.error('❌ Неверный формат кнопки:', { buttonText, msgText: msg.text });
                return bot.sendMessage(chatId, '❌ Неверный формат кнопки. Выберите из списка.');
            }

            const childName = match[1].trim();
            const buttonAge = parseInt(match[2]);
            console.log('🔎 Ищем ребенка:', { childName, buttonAge });
            
            // Всегда загружаем свежий список детей из базы данных
            const childrenResult = await pool.query(
                'SELECT id, full_name, birth_date FROM children WHERE parent_id = $1 ORDER BY birth_date',
                [state.data.client_id]
            );
            state.data.children = childrenResult.rows;
            
            console.log('📋 Загружено детей из БД:', {
                count: state.data.children.length,
                children: state.data.children.map(c => ({
                    id: c.id,
                    name: c.full_name,
                    birth_date: c.birth_date,
                    age: moment().diff(moment(c.birth_date), 'years')
                }))
            });
            
            // Инициализируем selected_participants если его нет
            if (!state.data.selected_participants) {
                state.data.selected_participants = [];
            }
            
            userStates.set(chatId, state);
            
            // Ищем ребенка по имени и возрасту
            const child = state.data.children.find(c => {
                const dbName = c.full_name.trim();
                const searchName = childName.trim();
                const dbAge = moment().diff(moment(c.birth_date), 'years');
                
                console.log('🔍 Проверка ребенка:', {
                    dbName,
                    searchName,
                    dbAge,
                    buttonAge,
                    nameMatch: dbName === searchName || dbName.toLowerCase() === searchName.toLowerCase(),
                    ageMatch: Math.abs(dbAge - buttonAge) <= 1
                });
                
                return (dbName === searchName || dbName.toLowerCase() === searchName.toLowerCase()) && 
                       Math.abs(dbAge - buttonAge) <= 1;
            });
            
            if (!child) {
                console.error('❌ Ребенок не найден:', {
                    childName,
                    buttonAge,
                    availableChildren: state.data.children.map(c => ({
                        name: c.full_name,
                        age: moment().diff(moment(c.birth_date), 'years'),
                        id: c.id
                    })),
                    buttonText,
                    msgText: msg.text,
                    clientId: state.data.client_id
                });
                return bot.sendMessage(chatId, 
                    '❌ Ребенок не найден. Попробуйте выбрать из списка еще раз или введите вручную через запятую.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            console.log('✅ Ребенок найден:', { id: child.id, name: child.full_name });

            // Проверяем, выбран ли уже ребенок
            const existingIndex = state.data.selected_participants.findIndex(p => p.childId === child.id);
            if (existingIndex >= 0) {
                // Убираем из списка (повторное нажатие)
                state.data.selected_participants.splice(existingIndex, 1);
            } else {
                // Добавляем к участникам
                const age = moment().diff(moment(child.birth_date), 'years');
                state.data.selected_participants.push({
                    fullName: child.full_name,
                    birthYear: moment(child.birth_date).year(),
                    age: age,
                    childId: child.id
                });
            }
            userStates.set(chatId, state);

            // Показываем обновленный список участников
            return await showParticipantsList(chatId, state);
        }
    }

    // Глобальная обработка "Предложить тренировку"
    if (msg.text === '💡 Предложить тренировку') {
        console.log('Начало процесса предложения тренировки');
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (!client) {
            return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
        }
        userStates.set(chatId, {
            step: 'suggest_has_group',
            data: { 
                telegram_id: msg.from.id.toString(),
                client_id: client.id,
                is_suggestion: true
            }
        });
        return bot.sendMessage(chatId,
            '👥 *У вас есть своя компания и вы хотите все вместе приехать?*',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [['Да', 'Нет'], ['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }

    // Если состояние отсутствует, проверяем, не является ли это кнопкой участника, которая требует состояния
    if (!state) {
        if (msg.text && (msg.text.startsWith('👶') || msg.text.startsWith('✅') || msg.text === '👤 Себя' || msg.text === '✅ Себя')) {
            console.error('⚠️ Попытка обработать кнопку участника без состояния!', {
                text: msg.text,
                chatId
            });
            return bot.sendMessage(chatId,
                '❌ Произошла ошибка: состояние потеряно. Пожалуйста, начните запись заново через меню.',
                {
                    reply_markup: {
                        keyboard: [['📝 Записаться на тренировку'], ['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
        // Если это не кнопка участника и нет состояния, но пользователь отправил сообщение
        // Показываем главное меню
        console.log('⚠️ Сообщение без состояния:', msg.text);
        return showMainMenu(chatId);
    }
    
    console.log('🎯 Переход к switch-case:', {
        step: state.step,
        text: msg.text
    });

    switch (state.step) {
        case 'select_location': {
            if (msg.text === '🎿 Горнолыжный тренажер') {
                state.step = 'select_action';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '🎯 *Выберите действие:*\n\n' +
                    '• 📝 Записаться\n' +
                    '• 💡 Предложить тренировку',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['📝 Записаться'],
                                ['💡 Предложить тренировку'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            } else if (msg.text === '⛷ Кулига. естественный склон') {
                // Здесь будет логика для Кулиги
                return bot.sendMessage(chatId,
                    '⛷ *Функционал для Кулиги находится в разработке*\n\n' +
                    'Скоро здесь появится возможность записи на тренировки на естественном склоне.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }

        case 'select_action': {
            if (msg.text === '📝 Записаться') {
                state.step = 'training_type';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '🎿 *Выберите тип тренировки:*\n\n' +
                    '• Групповая - тренировка в группе с другими участниками\n' +
                    '• Индивидуальная - персональная тренировка',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['👥 Групповая'],
                                ['👤 Индивидуальная'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }

        case 'suggest_has_group': {
            if (msg.text === 'Да' || msg.text === 'Нет') {
                const state = userStates.get(chatId);
                state.data.has_group = msg.text === 'Да';
                
                if (msg.text === 'Да') {
                    state.step = 'suggest_group_size';
                    userStates.set(chatId, state);
                    return bot.sendMessage(chatId,
                        '👥 *Сколько человек в вашей группе?*\n\n' +
                        'Введите число от 2 до 12:',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад']],
                                resize_keyboard: true
                            }
                        }
                    );
                } else {
                    state.step = 'suggest_training_for';
                    userStates.set(chatId, state);
                    return bot.sendMessage(chatId,
                        '👤 *Для кого тренировка?*\n\n' +
                        '1. Для себя\n' +
                        '2. Для ребенка\n' +
                        '3. Для себя и ребенка',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['1. Для себя'],
                                    ['2. Для ребенка'],
                                    ['3. Для себя и ребенка'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            }
            break;
        }

        case 'suggest_group_size': {
            const groupSize = parseInt(msg.text);
            if (isNaN(groupSize) || groupSize < 2 || groupSize > 12) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, введите число от 2 до 12.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            const state = userStates.get(chatId);
            state.data.group_size = groupSize;
            state.step = 'suggest_training_for';
            userStates.set(chatId, state);
            
            return bot.sendMessage(chatId,
                '👤 *Для кого тренировка?*\n\n' +
                '1. Для себя\n' +
                '2. Для ребенка\n' +
                '3. Для себя и ребенка',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['1. Для себя'],
                            ['2. Для ребенка'],
                            ['3. Для себя и ребенка'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'suggest_training_for': {
            let trainingFor;
            if (msg.text === '1. Для себя') {
                trainingFor = 'self';
                userStates.set(chatId, {
                    step: 'suggest_training_frequency',
                    data: { ...state.data, training_for: trainingFor }
                });
                return bot.sendMessage(chatId,
                    '🔄 *Как часто планируете тренироваться?*\n\n' +
                    '1. Разово\n' +
                    '2. Регулярно',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['1. Разово'],
                                ['2. Регулярно'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            } else if (msg.text === '2. Для ребенка' || msg.text === '3. Для себя и ребенка') {
                trainingFor = msg.text === '2. Для ребенка' ? 'child' : 'both';
                
                // Получаем список детей клиента
                const childrenResult = await pool.query(
                    'SELECT id, full_name FROM children WHERE parent_id = $1',
                    [state.data.client_id]
                );

                if (childrenResult.rows.length === 0) {
                    return bot.sendMessage(chatId,
                        '❌ У вас нет добавленных людей в профиле.\n\n' +
                        'Пожалуйста, сначала добавьте человека через меню "Личный кабинет" -> "➕ Добавить человека"',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                let message = '👤 *Выберите человека:*\n\n';
                // Убираем пункт "Для себя" при выборе "для себя и ребенка"
                if (trainingFor === 'both') {
                    childrenResult.rows.forEach((child, index) => {
                        message += `${index + 1}. Для ребенка: ${child.full_name}\n`;
                    });
                } else {
                    message += '1. Для себя\n';
                    childrenResult.rows.forEach((child, index) => {
                        message += `${index + 2}. Для ребенка: ${child.full_name}\n`;
                    });
                }

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            // Убираем кнопку "Для себя" при выборе "для себя и ребенка"
                            ...(trainingFor === 'both' ? [] : [['1. Для себя']]),
                            ...childrenResult.rows.map(child => [`Для ребенка: ${child.full_name}`]),
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                });
            } else if (msg.text.startsWith('Для ребенка:')) {
                const childName = msg.text.replace('Для ребенка: ', '');
                const childrenResult = await pool.query(
                    'SELECT id, full_name FROM children WHERE parent_id = $1',
                    [state.data.client_id]
                );
                
                const selectedChild = childrenResult.rows.find(child => child.full_name === childName);
                
                if (!selectedChild) {
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при выборе ребенка. Пожалуйста, попробуйте еще раз.',
                        {
                            reply_markup: {
                                keyboard: [
                                    // Убираем кнопку "Для себя" при выборе "для себя и ребенка"
                                    ...(state.data.training_for === 'both' ? [] : [['1. Для себя']]),
                                    ...childrenResult.rows.map(child => [`Для ребенка: ${child.full_name}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                // Сохраняем training_for как 'both' если это был выбор "для себя и ребенка"
                const finalTrainingFor = state.data.training_for === 'both' ? 'both' : 'child';
                
                userStates.set(chatId, {
                    step: 'suggest_training_frequency',
                    data: { 
                        ...state.data, 
                        training_for: finalTrainingFor,
                        child_id: selectedChild.id,
                        child_name: selectedChild.full_name
                    }
                });
                return bot.sendMessage(chatId,
                    '🔄 *Как часто планируете тренироваться?*\n\n' +
                    '1. Разово\n' +
                    '2. Регулярно',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['1. Разово'],
                                ['2. Регулярно'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }

        case 'suggest_training_frequency': {
            if (msg.text === '1. Разово' || msg.text === '2. Регулярно') {
                const state = userStates.get(chatId);
                state.data.training_frequency = msg.text === '1. Разово' ? 'once' : 'regular';
                state.step = 'suggest_sport_type';
                userStates.set(chatId, state);
                
                return bot.sendMessage(chatId,
                    '🎿 *Выберите вид спорта:*\n\n' +
                    '1. Горные лыжи\n' +
                    '2. Сноуборд',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['1. Горные лыжи'],
                                ['2. Сноуборд'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }

        case 'suggest_sport_type': {
            if (msg.text === '1. Горные лыжи' || msg.text === '2. Сноуборд') {
                const state = userStates.get(chatId);
                state.data.sport_type = msg.text === '1. Горные лыжи' ? 'ski' : 'snowboard';
                state.step = 'suggest_skill_level';
                userStates.set(chatId, state);
                
                return bot.sendMessage(chatId,
                    '📊 *Укажите уровень подготовки:*\n\n' +
                    '1. Начинающий (1-3)\n' +
                    '2. Средний (4-7)\n' +
                    '3. Продвинутый (8-10)',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['1. Начинающий (1-3)'],
                                ['2. Средний (4-7)'],
                                ['3. Продвинутый (8-10)'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }

        case 'suggest_skill_level': {
            let skillLevel;
            if (msg.text === '1. Начинающий (1-3)') {
                skillLevel = 2;
            } else if (msg.text === '2. Средний (4-7)') {
                skillLevel = 5;
            } else if (msg.text === '3. Продвинутый (8-10)') {
                skillLevel = 8;
            } else {
                break;
            }

            const state = userStates.get(chatId);
            state.data.skill_level = skillLevel;
            state.step = 'suggest_preferred_date';
            userStates.set(chatId, state);
            
            return bot.sendMessage(chatId,
                '📅 *Выберите предпочтительную дату:*\n\n' +
                'Введите дату в формате ДД.ММ.ГГГГ\n' +
                'Например: 01.01.2024',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'suggest_preferred_date': {
            const validationResult = await validateDateWithHumor(msg.text, 'suggestion');
            if (!validationResult.valid) {
                return bot.sendMessage(chatId, validationResult.message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                });
            }

            const state = userStates.get(chatId);
            state.data.preferred_date = validationResult.date;
            state.data.preferred_date_display = msg.text;
            state.step = 'suggest_preferred_time';
            userStates.set(chatId, state);
            
            return bot.sendMessage(chatId,
                '⏰ *Выберите предпочтительное время:*\n\n' +
                'Введите время в формате ЧЧ:ММ\n' +
                'Например: 10:00',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'suggest_preferred_time': {
            const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (!timeRegex.test(msg.text)) {
                return bot.sendMessage(chatId,
                    '❌ Неверный формат времени. Пожалуйста, используйте формат ЧЧ:ММ\n' +
                    'Например: 10:00',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const state = userStates.get(chatId);
            state.data.preferred_time = msg.text;
            state.step = 'confirm_suggestion';
            userStates.set(chatId, state);

            // Формируем сообщение с подтверждением
            let message = '📝 *Проверьте данные заявки:*\n\n';
            message += `👥 Группа: ${state.data.has_group ? 'Да' : 'Нет'}\n`;
            if (state.data.has_group) {
                message += `👥 Размер группы: ${state.data.group_size} человек\n`;
            }
            message += `👤 Для кого: ${state.data.training_for === 'self' ? 'Для себя' : 
                state.data.training_for === 'child' ? `Для ребенка (${state.data.child_name})` : 
                'Для себя и ребенка'}\n`;
            message += `🔄 Частота: ${state.data.training_frequency === 'once' ? 'Разово' : 'Регулярно'}\n`;
            message += `🎿 Вид спорта: ${state.data.sport_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
            message += `📊 Уровень: ${state.data.skill_level}/10\n`;
            message += `📅 Дата: ${state.data.preferred_date_display || formatDate(state.data.preferred_date)}\n`;
            message += `⏰ Время: ${state.data.preferred_time}\n\n`;
            message += 'Всё верно?';

            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['✅ Отправить заявку'],
                        ['❌ Отменить'],
                        ['🔙 Назад в меню']
                    ],
                    resize_keyboard: true
                }
            });
        }

        case 'confirm_suggestion': {
            if (msg.text === '✅ Отправить заявку') {
                try {
                    const state = userStates.get(chatId);
                    
                    // Получаем информацию о клиенте
                    const clientResult = await pool.query(
                        'SELECT id, full_name, phone, telegram_username FROM clients WHERE telegram_id = $1',
                        [state.data.telegram_id]
                    );
                    const clientInfo = clientResult.rows[0];

                    // Получаем ID ребенка, если тренировка для ребенка
                    let childId = null;
                    if (state.data.training_for === 'child' || state.data.training_for === 'both') {
                        childId = state.data.child_id;
                    }

                    // Создаем запись о предложении тренировки
                    const result = await pool.query(
                        `INSERT INTO training_requests (
                            client_id, child_id, equipment_type, duration,
                            preferred_date, preferred_time, has_group, group_size,
                            training_frequency, skill_level
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        RETURNING id`,
                        [
                            clientInfo.id,
                            childId,
                            state.data.sport_type,
                            60, // стандартная длительность 60 минут
                            state.data.preferred_date,
                            state.data.preferred_time,
                            state.data.has_group,
                            state.data.group_size,
                            state.data.training_frequency,
                            state.data.skill_level
                        ]
                    );

                    // Отправляем уведомление администратору
                    await notifyNewTrainingRequest({
                        id: result.rows[0].id,
                        client_name: clientInfo.full_name,
                        client_phone: clientInfo.phone,
                        telegram_username: clientInfo.telegram_username,
                        date: state.data.preferred_date,
                        time: state.data.preferred_time,
                        type: state.data.has_group ? 'Групповая' : 'Индивидуальная',
                        group_name: state.data.has_group ? `Группа ${state.data.group_size} чел.` : null,
                        trainer_name: 'Будет назначен',
                        price: 'Будет рассчитана'
                    });

                    // Очищаем состояние
                    userStates.delete(chatId);

                    // Формируем сообщение об успешной отправке
                    const adminPhone = process.env.ADMIN_PHONE;
                    let successMessage = '✅ *Ваша заявка на формирование групповой тренировки успешно отправлена!*\n\n';
                    if (state.data.has_group) {
                        successMessage += 'Мы рассмотрим вашу заявку и свяжемся с вами в ближайшее время.\n\n';
                        successMessage += 'Вы также можете связаться с нами для уточнения деталей:\n';
                        successMessage += `📱 Телефон: ${adminPhone}\n`;
                    } else {
                        successMessage += 'Мы постараемся подобрать для вас группу, но это может занять некоторое время.';
                    }

                    return bot.sendMessage(chatId, successMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при отправке заявки:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            } else if (msg.text === '❌ Отменить') {
                userStates.delete(chatId);
                return showMainMenu(chatId);
            }
            break;
        }

        case 'wait_start': {
            if (msg.text === '🚀 Запуск сервиса Ski-instruktor') {
                state.step = 'full_name';
                return bot.sendMessage(chatId, 'Введите ваше полное имя (ФИО):');
            }
            break;
        }
        case 'full_name': {
            if (msg.text.length < 5) return bot.sendMessage(chatId, 'Имя должно содержать минимум 5 символов. Попробуйте еще раз:');
            state.data.full_name = msg.text;
            state.step = 'birth_date';
            return bot.sendMessage(chatId, 'Введите вашу дату рождения в формате ДД.ММ.ГГГГ:');
        }
        case 'birth_date': {
            const birthDate = validateDate(msg.text);
            if (!birthDate) return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
            state.data.birth_date = birthDate;
            state.step = 'phone';
            return bot.sendMessage(chatId, 'Введите ваш номер телефона в формате +79999999999:');
        }
        case 'phone': {
            const phone = validatePhone(msg.text);
            if (!phone) return bot.sendMessage(chatId, 'Неверный формат номера телефона. Используйте формат +79999999999:');
            state.data.phone = phone;
            state.step = 'email';
            return bot.sendMessage(chatId, 'Укажите свой email, на который вам необходимо отправлять чеки:');
        }
        case 'email': {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const email = msg.text.trim();
            if (!emailRegex.test(email)) {
                return bot.sendMessage(chatId, 'Неверный формат email. Пожалуйста, введите корректный email адрес (например: example@mail.ru):');
            }
            state.data.email = email;
            state.step = 'has_child';
            return bot.sendMessage(chatId, 'У вас есть ребенок, которого вы будете записывать на тренировки?', {
                reply_markup: {
                    keyboard: [['Да', 'Нет']],
                    resize_keyboard: true,
                    one_time_keyboard: false,
                    persistent: true
                }
            });
        }
        case 'kuliga_group_email': {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const email = msg.text.trim();
            if (!emailRegex.test(email)) {
                return bot.sendMessage(chatId, 'Неверный формат email. Пожалуйста, введите корректный email адрес (например: example@mail.ru):');
            }
            // Сохраняем email и продолжаем создание бронирования
            // Используем сохраненные данные из state для продолжения
            const savedData = state.data;
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                // Создаем клиента с email
                const newKuligaClientResult = await client.query(
                    `INSERT INTO clients (full_name, phone, email, telegram_id, birth_date)
                     VALUES ($1, $2, $3, $4, '1900-01-01')
                     RETURNING id`,
                    [savedData.participantName, savedData.normalizedPhone, email, msg.from.id.toString()]
                );
                const kuligaClientId = newKuligaClientResult.rows[0].id;
                
                // Продолжаем создание бронирования (копируем логику из callback обработчика)
                const selectedTraining = savedData.selectedTraining;
                const sportType = selectedTraining.sport_type || 'ski';
                
                const trainingInfo = await client.query(
                    `SELECT date, start_time, end_time FROM kuliga_group_trainings WHERE id = $1`,
                    [selectedTraining.id]
                );
                
                if (trainingInfo.rows.length === 0) {
                    await client.query('ROLLBACK');
                    client.release();
                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, '❌ Информация о тренировке не найдена.', {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    });
                }
                
                const trainingDetails = trainingInfo.rows[0];
                const pricePerPerson = parseFloat(selectedTraining.price || 0);
                
                // Создаем бронирование
                const bookingResult = await client.query(
                    `INSERT INTO kuliga_bookings (
                        client_id, booking_type, group_training_id,
                        date, start_time, end_time, sport_type,
                        participants_count, participants_names, participants_birth_years,
                        price_total, price_per_person,
                        status, notification_method, payer_rides
                    ) VALUES ($1, 'group', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', 'telegram', true)
                    RETURNING id`,
                    [
                        kuligaClientId,
                        selectedTraining.id,
                        trainingDetails.date,
                        trainingDetails.start_time,
                        trainingDetails.end_time,
                        sportType,
                        1,
                        [savedData.participantName],
                        [null],
                        pricePerPerson,
                        pricePerPerson,
                    ]
                );
                
                const bookingId = bookingResult.rows[0].id;
                
                // Увеличиваем счетчик участников
                await client.query(
                    `UPDATE kuliga_group_trainings
                     SET current_participants = current_participants + 1,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [selectedTraining.id]
                );
                
                // Создаем транзакцию для оплаты
                const walletResult = await client.query(
                    'SELECT id FROM wallets WHERE client_id = $1 LIMIT 1',
                    [kuligaClientId]
                );
                
                if (walletResult.rows.length === 0) {
                    // Создаем кошелек, если его нет
                    const walletNumber = await generateUniqueWalletNumber();
                    await client.query(
                        `INSERT INTO wallets (client_id, wallet_number, balance) 
                         VALUES ($1, $2, 0) RETURNING id`,
                        [kuligaClientId, walletNumber]
                    );
                }
                
                await client.query('COMMIT');
                client.release();
                userStates.delete(chatId);
                
                return bot.sendMessage(chatId,
                    `✅ Бронирование создано!\n\n` +
                    `Тренировка: ${selectedTraining.sport_type === 'ski' ? 'Лыжи' : 'Сноуборд'}\n` +
                    `Дата: ${trainingDetails.date}\n` +
                    `Время: ${trainingDetails.start_time}\n\n` +
                    `Для оплаты перейдите в раздел "Мои записи".`,
                    {
                        reply_markup: {
                            keyboard: [
                                ['📋 Мои записи'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            } catch (error) {
                await client.query('ROLLBACK');
                client.release();
                userStates.delete(chatId);
                console.error('Ошибка при создании бронирования после получения email:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при создании бронирования. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }
        case 'has_child': {
            if (msg.text === 'Да') {
                // Если это регистрация нового клиента (нет client_id), инициализируем объект child
                if (!state.data.client_id) {
                    state.data.child = {};
                }
                
                // Если детей нет или массив не определён — сразу просим ввести ФИО
                if (!state.data.children || state.data.children.length === 0) {
                    state.step = 'add_child_name';
                    userStates.set(chatId, state);
                    return bot.sendMessage(chatId, '👤 Введите ФИО человека:', {
                        reply_markup: {
                            keyboard: [['🔙 Отмена']],
                            resize_keyboard: true
                        }
                    });
                }
                // Если детей несколько — показываем выбор (этот кейс для личного кабинета)
                if (state.data.children.length > 1) {
                    const childrenList = state.data.children.map((child, index) =>
                        `${index + 1}. ${child.full_name} (${new Date(child.birth_date).toLocaleDateString()})`
                    ).join('\n');
                    state.step = 'select_child';
                    userStates.set(chatId, state);
                    return bot.sendMessage(chatId,
                        '👤 *Выберите человека из списка:*\n\n' + childrenList,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ...state.data.children.map((_, i) => [`${i + 1}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                // Если один ребенок — сразу переходим к выбору типа тренировки
                if (state.data.children.length === 1) {
                    const selectedChild = state.data.children[0];
                    userStates.set(chatId, {
                        step: 'training_type',
                        data: {
                            client_id: state.data.client_id,
                            is_child: true,
                            child_id: selectedChild.id,
                            child_name: selectedChild.full_name
                        }
                    });
                    return bot.sendMessage(chatId,
                        '🎿 *Выберите тип тренировки:*\n\n' +
                        '• Групповая - тренировка в группе с другими участниками\n' +
                        '• Индивидуальная - персональная тренировка',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['👥 Групповая'],
                                    ['👤 Индивидуальная'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            } else if (msg.text === 'Нет') {
                // Переходим к шагу согласия на обработку персональных данных
                userStates.set(chatId, {
                    step: 'privacy_consent',
                    data: state.data
                });
                
                // Удаляем клавиатуру с кнопками "Да/Нет"
                await bot.sendMessage(chatId, 'Убираем клавиатуру...', {
                    reply_markup: {
                        remove_keyboard: true
                    }
                });
                
                await showPrivacyConsent(chatId, state.data);
                return;
            }
            break;
        }
        case 'select_child': {
            const state = userStates.get(chatId);
            const childIndex = parseInt(msg.text) - 1;
            
            if (isNaN(childIndex) || childIndex < 0 || childIndex >= state.data.children.length) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите номер ребенка из списка.',
                    {
                        reply_markup: {
                            keyboard: [
                                ...state.data.children.map((_, i) => [`${i + 1}`]),
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const selectedChild = state.data.children[childIndex];
            userStates.set(chatId, {
                step: 'training_type',
                data: {
                    client_id: state.data.client_id,
                    is_child: true,
                    child_id: selectedChild.id,
                    child_name: selectedChild.full_name
                }
            });

            return bot.sendMessage(chatId,
                '🎿 *Выберите тип тренировки:*\n\n' +
                '• Групповая - тренировка в группе с другими участниками\n' +
                '• Индивидуальная - персональная тренировка',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['👥 Групповая'],
                            ['👤 Индивидуальная'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }
        case 'training_type': {
            if (msg.text === '👥 Групповая' || msg.text === '👤 Индивидуальная') {
                const state = userStates.get(chatId);
                state.data.training_type = msg.text === '👥 Групповая' ? 'group' : 'individual';
                if (msg.text === '👥 Групповая') {
                    try {
                        // Получаем доступные групповые тренировки на ближайшие 2 недели
                        const result = await pool.query(
                            `SELECT 
                                ts.id,
                                ts.session_date,
                                ts.start_time,
                                ts.end_time,
                                ts.duration,
                                g.name as group_name,
                                s.name as simulator_name,
                                t.full_name as trainer_name,
                                ts.max_participants,
                                ts.price,
                                ts.skill_level,
                                ts.equipment_type,
                                COUNT(CASE WHEN sp.status = 'confirmed' THEN 1 END) as current_participants
                            FROM training_sessions ts
                            LEFT JOIN groups g ON ts.group_id = g.id
                            LEFT JOIN simulators s ON ts.simulator_id = s.id
                            LEFT JOIN trainers t ON ts.trainer_id = t.id
                            LEFT JOIN session_participants sp ON ts.id = sp.session_id
                            WHERE ts.training_type = true
                            AND ts.session_date <= ((NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date + INTERVAL '14 days')
                            AND ts.status = 'scheduled'
                            AND (
                                ts.session_date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                                OR (
                                    ts.session_date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                                    AND ts.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                                )
                            )
                            GROUP BY ts.id, g.name, s.name, t.full_name
                            HAVING COUNT(CASE WHEN sp.status = 'confirmed' THEN 1 END) < ts.max_participants
                            ORDER BY ts.session_date, ts.start_time`
                        );

                        if (result.rows.length === 0) {
                            return bot.sendMessage(chatId,
                                '❌ К сожалению, на ближайшие 2 недели нет доступных групповых тренировок.\n\n' +
                                'Вы можете:\n' +
                                '• Предложить новую групповую тренировку\n' +
                                '• Записаться на индивидуальную тренировку',
                                {
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        keyboard: [
                                            ['💡 Предложить тренировку'],
                                            ['👤 Индивидуальная'],
                                            ['🔙 Назад в меню']
                                        ],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }

                        // Сохраняем список тренировок в состоянии
                        state.data.available_sessions = result.rows;
                        state.step = 'group_training_selection';
                        userStates.set(chatId, state);

                        // Формируем сообщение со списком тренировок
                        let message = '🎿 *Доступные групповые тренировки:*\n\n';
                        // Добавляем информацию о каждой тренировке
                        result.rows.forEach((session, index) => {
                            const date = new Date(session.session_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric', year: 'numeric', weekday: 'short' });
                            const weekday = date.split(',')[1].trim();
                            const dateStr = date.split(',')[0].trim();
                            const groupName = session.group_name || (session.equipment_type === 'ski' ? 'Горнолыжники' : (session.equipment_type === 'snowboard' ? 'Сноубордисты' : 'Группа')) + (session.group_name?.toLowerCase().includes('дети') ? ' дети' : ' взрослые');
                            const currentParticipants = session.current_participants || 0;
                            const maxParticipants = session.max_participants;
                            const price = parseFloat(session.price).toFixed(2);
                            const skillLevel = session.skill_level;
                            const trainerName = session.trainer_name || 'без тренера';
                            
                            // Форматируем время без секунд (HH:MM вместо HH:MM:SS)
                            const timeStr = session.start_time ? session.start_time.slice(0, 5) : '--:--';
                            
                            message += `${index + 1}. ${weekday} (${dateStr}) ${timeStr}\n`;
                            message += `   👥 ${groupName} (${currentParticipants}/${maxParticipants})\n`;
                            message += `   👨‍🏫 Тренер: ${trainerName}\n`;
                            message += `   📊 Уровень: ${skillLevel}/10\n`;
                            message += `   💰 ${price} руб.\n\n`;
                        });
                        message += "Чтобы выбрать тренировку, введите её номер в чат.\nНапример: 1 - для выбора первой тренировки\n\n";
                        message += "⚠️ При записи на тренировку убедитесь, что:\n• ваш баланс пополнен\n• ваш уровень подготовки соответствует или выше указанного уровня тренировки";
                        return bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: { keyboard: [['🔙 Назад в меню']], resize_keyboard: true } });
                    } catch (error) {
                        console.error('Ошибка при получении списка тренировок:', error);
                        return bot.sendMessage(chatId,
                            '❌ Произошла ошибка при получении списка тренировок. Пожалуйста, попробуйте позже.',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }
                } else if (msg.text === '👤 Индивидуальная') {
                    // Новый вызов функции выбора участника
                    await askIndividualForWhom(chatId, state.data.client_id);
                    return;
                }
            }
            break;
        }

        case 'individual_for_whom': {
            const state = userStates.get(chatId);
            const choice = parseInt(msg.text);
            if (isNaN(choice) || choice < 1 || choice > (state.data.children.length + 1)) {
                return bot.sendMessage(chatId, '❌ Пожалуйста, выберите один из предложенных вариантов.', {
                    reply_markup: {
                        keyboard: [
                            ['1. Для себя'],
                            ...state.data.children.map((child, idx) => [`${idx + 2}. ${child.full_name}`])
                        ],
                        resize_keyboard: true
                    }
                });
            }
            if (choice === 1) {
                // Для себя
                state.data.is_child = false;
            } else {
                // Для ребенка
                const selectedChild = state.data.children[choice - 2];
                state.data.is_child = true;
                state.data.child_id = selectedChild.id;
                state.data.child_name = selectedChild.full_name;
            }
            state.step = 'equipment_type';
            userStates.set(chatId, state);
            return bot.sendMessage(chatId,
                '🎿 *Выберите тип снаряжения:*\n\n• 🎿 Горные лыжи\n• 🏂 Сноуборд',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['🎿 Горные лыжи'],
                            ['🏂 Сноуборд'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'select_participant': {
            const state = userStates.get(chatId);
            const choice = parseInt(msg.text);
            
            if (isNaN(choice) || choice < 1 || choice > state.data.children.length + 1) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите один из предложенных вариантов.',
                    {
                        reply_markup: {
                            keyboard: [
                                ['1. Для себя'],
                                ...state.data.children.map(child => [`2. Для ребенка: ${child.full_name}`]),
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            if (choice === 1) {
                state.data.is_child = false;
            } else {
                const selectedChild = state.data.children[choice - 2];
                state.data.is_child = true;
                state.data.child_id = selectedChild.id;
                state.data.child_name = selectedChild.full_name;
            }
            
            state.step = 'equipment_type';
            userStates.set(chatId, state);
            
            return bot.sendMessage(chatId,
                '🎿 *Выберите тип снаряжения:*\n\n' +
                '• 🎿 Горные лыжи\n' +
                '• 🏂 Сноуборд',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['🎿 Горные лыжи'],
                            ['🏂 Сноуборд'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }
        case 'equipment_type': {
            if (msg.text === '🎿 Горные лыжи' || msg.text === '🏂 Сноуборд') {
                const state = userStates.get(chatId);
                state.data.equipment_type = msg.text === '🎿 Горные лыжи' ? 'ski' : 'snowboard';
                state.step = 'with_trainer';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '👨‍🏫 *Вы будете кататься с тренером или без тренера?*\n\n' +
                    '⚠️ *Важно:*\n' +
                    '• Без тренера только для опытных\n' +
                    '• Для индивидуальных занятий без тренера рекомендуем начинать с 30 минут\n' +
                    '• Если вы новичок и не имеете опыта катания, кататься без тренера запрещено',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['👨‍🏫 С тренером'],
                                ['👤 Без тренера'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }
        case 'with_trainer': {
            if (msg.text === '👨‍🏫 С тренером' || msg.text === '👤 Без тренера') {
                const state = userStates.get(chatId);
                state.data.with_trainer = msg.text === '👨‍🏫 С тренером';
                state.step = 'duration';
                userStates.set(chatId, state);

                try {
                    // Получаем цены из базы данных
                    const pricesResult = await pool.query(
                        `SELECT * FROM prices 
                        WHERE type = 'individual' 
                        AND with_trainer = $1 
                        ORDER BY duration`,
                        [state.data.with_trainer]
                    );

                    let message = '⏱ *Выберите длительность тренировки:*\n\n';
                    message += state.data.with_trainer ? '👨‍🏫 *С тренером:*\n' : '👤 *Без тренера:*\n';
                    
                    pricesResult.rows.forEach(price => {
                        message += `• ${price.duration} минут - ${price.price} руб.\n`;
                    });

                    message += '\nВыберите длительность:';

                    return bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['⏱ 30 минут'],
                                ['⏱ 60 минут'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при получении цен:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при получении цен. Пожалуйста, попробуйте позже.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            }
            break;
        }
        case 'duration': {
            if (msg.text === '⏱ 30 минут' || msg.text === '⏱ 60 минут') {
                const state = userStates.get(chatId);
                state.data.duration = msg.text === '⏱ 30 минут' ? 30 : 60;
                state.step = 'preferred_date';
                userStates.set(chatId, state);

                // Получаем цену для выбранной длительности
                try {
                    const priceResult = await pool.query(
                        `SELECT price FROM prices 
                        WHERE type = 'individual' 
                        AND with_trainer = $1 
                        AND duration = $2`,
                        [state.data.with_trainer, state.data.duration]
                    );
                    
                    state.data.price = priceResult.rows[0].price;
                    userStates.set(chatId, state);

                    return bot.sendMessage(chatId,
                        '📅 *Выберите предпочтительную дату в формате ДД.ММ.ГГГГ:*\n\n' +
                        'Например: 25.12.2024',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                } catch (error) {
                    console.error('Ошибка при получении цены:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при получении цены. Пожалуйста, попробуйте позже.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            }
            break;
        }
        case 'preferred_date': {
            const validationResult = await validateDateWithHumor(msg.text, 'individual');
            if (!validationResult.valid) {
                return bot.sendMessage(chatId, validationResult.message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                });
            }

            const state = userStates.get(chatId);
            state.data.preferred_date = validationResult.date;

            try {
                // Получаем информацию о тренажерах
                const simulatorsResult = await pool.query(
                    'SELECT id, name FROM simulators WHERE is_working = true'
                );
                const simulators = simulatorsResult.rows;

                // Получаем расписание на выбранную дату
                const scheduleResult = await pool.query(
                    `SELECT s.*, ts.id as training_id
                    FROM schedule s 
                    LEFT JOIN training_sessions ts ON s.simulator_id = ts.simulator_id 
                    AND s.date = ts.session_date 
                    AND s.start_time >= ts.start_time 
                    AND s.start_time < (ts.start_time + COALESCE(ts.duration, 30) * interval '1 minute')
                    WHERE s.date = $1 AND s.is_holiday = false
                    ORDER BY s.start_time`,
                    [validationResult.date]
                );

                // Группируем расписание по тренажерам
                const scheduleBySimulator = {};
                simulators.forEach(sim => {
                    scheduleBySimulator[sim.id] = scheduleResult.rows.filter(
                        s => s.simulator_id === sim.id
                    );
                });

                // Создаем клавиатуру с доступным временем
                const keyboard = [];
                const timeSlots = new Set();

                // Собираем все временные слоты
                scheduleResult.rows.forEach(slot => {
                    timeSlots.add(slot.start_time);
                });

                // Сортируем временные слоты
                const sortedTimeSlots = Array.from(timeSlots).sort();

                // Создаем строки клавиатуры
                sortedTimeSlots.forEach(time => {
                    const row = [];
                    simulators.forEach(sim => {
                        const slot = scheduleBySimulator[sim.id].find(s => s.start_time === time);
                        const isBooked = slot && (slot.is_booked || slot.training_id);
                        
                        // Форматируем время в HH:MM
                        const [hours, minutes] = time.split(':');
                        const formattedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
                        
                        row.push({
                            text: `${isBooked ? '⏰' : '✅'} ${formattedTime}`,
                            callback_data: isBooked ? 
                                'booked' : 
                                `time_${sim.id}_${time}`
                        });
                    });
                    keyboard.push(row);
                });

                // Добавляем кнопку "Назад"
                keyboard.push([{
                    text: '🔙 Назад',
                    callback_data: 'back_to_date'
                }]);

                state.step = 'select_time';
                userStates.set(chatId, state);

                // Формируем сообщение с информацией о тренажерах
                let message = '⏰ *Выберите удобное время:*\n\n';
                simulators.forEach((sim, index) => {
                    message += `${index + 1}. ${sim.name}\n`;
                });
                message += '\n✅ - время доступно\n⏰ - время занято';

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                });
            } catch (error) {
                console.error('Ошибка при получении расписания:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при получении расписания. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }
        case 'suggest_preferred_time': {
            const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (!timeRegex.test(msg.text)) {
                return bot.sendMessage(chatId,
                    '❌ Неверный формат времени. Пожалуйста, используйте формат ЧЧ:ММ\n' +
                    'Например: 10:00',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const state = userStates.get(chatId);
            state.data.preferred_time = msg.text;
            state.step = 'confirm_suggestion';
            userStates.set(chatId, state);

            // Формируем сообщение с подтверждением
            let message = '📝 *Проверьте данные заявки:*\n\n';
            message += `👥 Группа: ${state.data.has_group ? 'Да' : 'Нет'}\n`;
            if (state.data.has_group) {
                message += `👥 Размер группы: ${state.data.group_size} человек\n`;
            }
            message += `👤 Для кого: ${state.data.training_for === 'self' ? 'Для себя' : 
                state.data.training_for === 'child' ? `Для ребенка (${state.data.child_name})` : 
                'Для себя и ребенка'}\n`;
            message += `🔄 Частота: ${state.data.training_frequency === 'once' ? 'Разово' : 'Регулярно'}\n`;
            message += `🎿 Вид спорта: ${state.data.sport_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
            message += `📊 Уровень: ${state.data.skill_level}/10\n`;
            message += `📅 Дата: ${state.data.preferred_date_display || formatDate(state.data.preferred_date)}\n`;
            message += `⏰ Время: ${state.data.preferred_time}\n\n`;
            message += 'Всё верно?';

            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['✅ Отправить заявку'],
                        ['❌ Отменить'],
                        ['🔙 Назад в меню']
                    ],
                    resize_keyboard: true
                }
            });
        }

        case 'confirm_suggestion': {
            if (msg.text === '✅ Отправить заявку') {
                try {
                    const state = userStates.get(chatId);
                    
                    // Получаем информацию о клиенте
                    const clientResult = await pool.query(
                        'SELECT id, full_name, phone, telegram_username FROM clients WHERE telegram_id = $1',
                        [state.data.telegram_id]
                    );
                    const clientInfo = clientResult.rows[0];

                    // Получаем ID ребенка, если тренировка для ребенка
                    let childId = null;
                    if (state.data.training_for === 'child' || state.data.training_for === 'both') {
                        childId = state.data.child_id;
                    }

                    // Создаем запись о предложении тренировки
                    const result = await pool.query(
                        `INSERT INTO training_requests (
                            client_id, child_id, equipment_type, duration,
                            preferred_date, preferred_time, has_group, group_size,
                            training_frequency, skill_level
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        RETURNING id`,
                        [
                            clientInfo.id,
                            childId,
                            state.data.sport_type,
                            60, // стандартная длительность 60 минут
                            state.data.preferred_date,
                            state.data.preferred_time,
                            state.data.has_group,
                            state.data.group_size,
                            state.data.training_frequency,
                            state.data.skill_level
                        ]
                    );

                    // Отправляем уведомление администратору
                    await notifyNewTrainingRequest({
                        id: result.rows[0].id,
                        client_name: clientInfo.full_name,
                        client_phone: clientInfo.phone,
                        telegram_username: clientInfo.telegram_username,
                        date: state.data.preferred_date,
                        time: state.data.preferred_time,
                        type: state.data.has_group ? 'Групповая' : 'Индивидуальная',
                        group_name: state.data.has_group ? `Группа ${state.data.group_size} чел.` : null,
                        trainer_name: 'Будет назначен',
                        price: 'Будет рассчитана'
                    });

                    // Очищаем состояние
                    userStates.delete(chatId);

                    // Формируем сообщение об успешной отправке
                    const adminPhone = process.env.ADMIN_PHONE;
                    let successMessage = '✅ *Ваша заявка на формирование групповой тренировки успешно отправлена!*\n\n';
                    if (state.data.has_group) {
                        successMessage += 'Мы рассмотрим вашу заявку и свяжемся с вами в ближайшее время.\n\n';
                        successMessage += 'Вы также можете связаться с нами для уточнения деталей:\n';
                        successMessage += `📱 Телефон: ${adminPhone}\n`;
                    } else {
                        successMessage += 'Мы постараемся подобрать для вас группу, но это может занять некоторое время.';
                    }

                    return bot.sendMessage(chatId, successMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при отправке заявки:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            } else if (msg.text === '❌ Отменить') {
                userStates.delete(chatId);
                return showMainMenu(chatId);
            }
            break;
        }

        

        case 'individual_for_whom': {
            const state = userStates.get(chatId);
            const choice = parseInt(msg.text);
            if (isNaN(choice) || choice < 1 || choice > (state.data.children.length + 1)) {
                return bot.sendMessage(chatId, '❌ Пожалуйста, выберите один из предложенных вариантов.', {
                    reply_markup: {
                        keyboard: [
                            ['1. Для себя'],
                            ...state.data.children.map((child, idx) => [`${idx + 2}. ${child.full_name}`])
                        ],
                        resize_keyboard: true
                    }
                });
            }
            if (choice === 1) {
                // Для себя
                state.data.is_child = false;
            } else {
                // Для ребенка
                const selectedChild = state.data.children[choice - 2];
                state.data.is_child = true;
                state.data.child_id = selectedChild.id;
                state.data.child_name = selectedChild.full_name;
            }
            state.step = 'equipment_type';
            userStates.set(chatId, state);
            return bot.sendMessage(chatId,
                '🎿 *Выберите тип снаряжения:*\n\n• 🎿 Горные лыжи\n• 🏂 Сноуборд',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['🎿 Горные лыжи'],
                            ['🏂 Сноуборд'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'select_participant': {
            const state = userStates.get(chatId);
            const choice = parseInt(msg.text);
            
            if (isNaN(choice) || choice < 1 || choice > state.data.children.length + 1) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите один из предложенных вариантов.',
                    {
                        reply_markup: {
                            keyboard: [
                                ['1. Для себя'],
                                ...state.data.children.map(child => [`2. Для ребенка: ${child.full_name}`]),
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            if (choice === 1) {
                state.data.is_child = false;
            } else {
                const selectedChild = state.data.children[choice - 2];
                state.data.is_child = true;
                state.data.child_id = selectedChild.id;
                state.data.child_name = selectedChild.full_name;
            }
            
            state.step = 'equipment_type';
            userStates.set(chatId, state);
            
            return bot.sendMessage(chatId,
                '🎿 *Выберите тип снаряжения:*\n\n' +
                '• 🎿 Горные лыжи\n' +
                '• 🏂 Сноуборд',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['🎿 Горные лыжи'],
                            ['🏂 Сноуборд'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }
        case 'equipment_type': {
            if (msg.text === '🎿 Горные лыжи' || msg.text === '🏂 Сноуборд') {
                const state = userStates.get(chatId);
                state.data.equipment_type = msg.text === '🎿 Горные лыжи' ? 'ski' : 'snowboard';
                state.step = 'with_trainer';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '👨‍🏫 *Вы будете кататься с тренером или без тренера?*\n\n' +
                    '⚠️ *Важно:*\n' +
                    '• Без тренера только для опытных\n' +
                    '• Для индивидуальных занятий без тренера рекомендуем начинать с 30 минут\n' +
                    '• Если вы новичок и не имеете опыта катания, кататься без тренера запрещено',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['👨‍🏫 С тренером'],
                                ['👤 Без тренера'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }
        case 'with_trainer': {
            if (msg.text === '👨‍🏫 С тренером' || msg.text === '👤 Без тренера') {
                const state = userStates.get(chatId);
                state.data.with_trainer = msg.text === '👨‍🏫 С тренером';
                state.step = 'duration';
                userStates.set(chatId, state);

                try {
                    // Получаем цены из базы данных
                    const pricesResult = await pool.query(
                        `SELECT * FROM prices 
                        WHERE type = 'individual' 
                        AND with_trainer = $1 
                        ORDER BY duration`,
                        [state.data.with_trainer]
                    );

                    let message = '⏱ *Выберите длительность тренировки:*\n\n';
                    message += state.data.with_trainer ? '👨‍🏫 *С тренером:*\n' : '👤 *Без тренера:*\n';
                    
                    pricesResult.rows.forEach(price => {
                        message += `• ${price.duration} минут - ${price.price} руб.\n`;
                    });

                    message += '\nВыберите длительность:';

                    return bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['⏱ 30 минут'],
                                ['⏱ 60 минут'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при получении цен:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при получении цен. Пожалуйста, попробуйте позже.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            }
            break;
        }
        case 'duration': {
            if (msg.text === '⏱ 30 минут' || msg.text === '⏱ 60 минут') {
                const state = userStates.get(chatId);
                state.data.duration = msg.text === '⏱ 30 минут' ? 30 : 60;
                state.step = 'preferred_date';
                userStates.set(chatId, state);

                // Получаем цену для выбранной длительности
                try {
                    const priceResult = await pool.query(
                        `SELECT price FROM prices 
                        WHERE type = 'individual' 
                        AND with_trainer = $1 
                        AND duration = $2`,
                        [state.data.with_trainer, state.data.duration]
                    );
                    
                    state.data.price = priceResult.rows[0].price;
                    userStates.set(chatId, state);

                    return bot.sendMessage(chatId,
                        '📅 *Выберите предпочтительную дату в формате ДД.ММ.ГГГГ:*\n\n' +
                        'Например: 25.12.2024',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                } catch (error) {
                    console.error('Ошибка при получении цены:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при получении цены. Пожалуйста, попробуйте позже.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            }
            break;
        }
        case 'preferred_date': {
            const validationResult = await validateDateWithHumor(msg.text, 'individual');
            if (!validationResult.valid) {
                return bot.sendMessage(chatId, validationResult.message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                });
            }

            const state = userStates.get(chatId);
            state.data.preferred_date = validationResult.date;

            try {
                // Получаем информацию о тренажерах
                const simulatorsResult = await pool.query(
                    'SELECT id, name FROM simulators WHERE is_working = true'
                );
                const simulators = simulatorsResult.rows;

                // Получаем расписание на выбранную дату
                const scheduleResult = await pool.query(
                    `SELECT s.*, ts.id as training_id
                    FROM schedule s 
                    LEFT JOIN training_sessions ts ON s.simulator_id = ts.simulator_id 
                    AND s.date = ts.session_date 
                    AND s.start_time >= ts.start_time 
                    AND s.start_time < (ts.start_time + COALESCE(ts.duration, 30) * interval '1 minute')
                    WHERE s.date = $1 AND s.is_holiday = false
                    ORDER BY s.start_time`,
                    [validationResult.date]
                );

                // Группируем расписание по тренажерам
                const scheduleBySimulator = {};
                simulators.forEach(sim => {
                    scheduleBySimulator[sim.id] = scheduleResult.rows.filter(
                        s => s.simulator_id === sim.id
                    );
                });

                // Создаем клавиатуру с доступным временем
                const keyboard = [];
                const timeSlots = new Set();

                // Собираем все временные слоты
                scheduleResult.rows.forEach(slot => {
                    timeSlots.add(slot.start_time);
                });

                // Сортируем временные слоты
                const sortedTimeSlots = Array.from(timeSlots).sort();

                // Создаем строки клавиатуры
                sortedTimeSlots.forEach(time => {
                    const row = [];
                    simulators.forEach(sim => {
                        const slot = scheduleBySimulator[sim.id].find(s => s.start_time === time);
                        const isBooked = slot && (slot.is_booked || slot.training_id);
                        
                        // Форматируем время в HH:MM
                        const [hours, minutes] = time.split(':');
                        const formattedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
                        
                        row.push({
                            text: `${isBooked ? '⏰' : '✅'} ${formattedTime}`,
                            callback_data: isBooked ? 
                                'booked' : 
                                `time_${sim.id}_${time}`
                        });
                    });
                    keyboard.push(row);
                });

                // Добавляем кнопку "Назад"
                keyboard.push([{
                    text: '🔙 Назад',
                    callback_data: 'back_to_date'
                }]);

                state.step = 'select_time';
                userStates.set(chatId, state);

                // Формируем сообщение с информацией о тренажерах
                let message = '⏰ *Выберите удобное время:*\n\n';
                simulators.forEach((sim, index) => {
                    message += `${index + 1}. ${sim.name}\n`;
                });
                message += '\n✅ - время доступно\n⏰ - время занято';

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                });
            } catch (error) {
                console.error('Ошибка при получении расписания:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при получении расписания. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }
        case 'suggest_preferred_time': {
            const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (!timeRegex.test(msg.text)) {
                return bot.sendMessage(chatId,
                    '❌ Неверный формат времени. Пожалуйста, используйте формат ЧЧ:ММ\n' +
                    'Например: 10:00',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const state = userStates.get(chatId);
            state.data.preferred_time = msg.text;
            state.step = 'confirm_suggestion';
            userStates.set(chatId, state);

            // Формируем сообщение с подтверждением
            let message = '📝 *Проверьте данные заявки:*\n\n';
            message += `👥 Группа: ${state.data.has_group ? 'Да' : 'Нет'}\n`;
            if (state.data.has_group) {
                message += `👥 Размер группы: ${state.data.group_size} человек\n`;
            }
            message += `👤 Для кого: ${state.data.training_for === 'self' ? 'Для себя' : 
                state.data.training_for === 'child' ? `Для ребенка (${state.data.child_name})` : 
                'Для себя и ребенка'}\n`;
            message += `🔄 Частота: ${state.data.training_frequency === 'once' ? 'Разово' : 'Регулярно'}\n`;
            message += `🎿 Вид спорта: ${state.data.sport_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
            message += `📊 Уровень: ${state.data.skill_level}/10\n`;
            message += `📅 Дата: ${state.data.preferred_date_display || formatDate(state.data.preferred_date)}\n`;
            message += `⏰ Время: ${state.data.preferred_time}\n\n`;
            message += 'Всё верно?';

            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['✅ Отправить заявку'],
                        ['❌ Отменить'],
                        ['🔙 Назад в меню']
                    ],
                    resize_keyboard: true
                }
            });
        }

        case 'confirm_suggestion': {
            if (msg.text === '✅ Отправить заявку') {
                try {
                    const state = userStates.get(chatId);
                    
                    // Получаем информацию о клиенте
                    const clientResult = await pool.query(
                        'SELECT id, full_name, phone, telegram_username FROM clients WHERE telegram_id = $1',
                        [state.data.telegram_id]
                    );
                    const clientInfo = clientResult.rows[0];

                    // Получаем ID ребенка, если тренировка для ребенка
                    let childId = null;
                    if (state.data.training_for === 'child' || state.data.training_for === 'both') {
                        childId = state.data.child_id;
                    }

                    // Создаем запись о предложении тренировки
                    const result = await pool.query(
                        `INSERT INTO training_requests (
                            client_id, child_id, equipment_type, duration,
                            preferred_date, preferred_time, has_group, group_size,
                            training_frequency, skill_level
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        RETURNING id`,
                        [
                            clientInfo.id,
                            childId,
                            state.data.sport_type,
                            60, // стандартная длительность 60 минут
                            state.data.preferred_date,
                            state.data.preferred_time,
                            state.data.has_group,
                            state.data.group_size,
                            state.data.training_frequency,
                            state.data.skill_level
                        ]
                    );

                    // Отправляем уведомление администратору
                    await notifyNewTrainingRequest({
                        id: result.rows[0].id,
                        client_name: clientInfo.full_name,
                        client_phone: clientInfo.phone,
                        telegram_username: clientInfo.telegram_username,
                        date: state.data.preferred_date,
                        time: state.data.preferred_time,
                        type: state.data.has_group ? 'Групповая' : 'Индивидуальная',
                        group_name: state.data.has_group ? `Группа ${state.data.group_size} чел.` : null,
                        trainer_name: 'Будет назначен',
                        price: 'Будет рассчитана'
                    });

                    // Очищаем состояние
                    userStates.delete(chatId);

                    // Формируем сообщение об успешной отправке
                    const adminPhone = process.env.ADMIN_PHONE;
                    let successMessage = '✅ *Ваша заявка на формирование групповой тренировки успешно отправлена!*\n\n';
                    if (state.data.has_group) {
                        successMessage += 'Мы рассмотрим вашу заявку и свяжемся с вами в ближайшее время.\n\n';
                        successMessage += 'Вы также можете связаться с нами для уточнения деталей:\n';
                        successMessage += `📱 Телефон: ${adminPhone}\n`;
                    } else {
                        successMessage += 'Мы постараемся подобрать для вас группу, но это может занять некоторое время.';
                    }

                    return bot.sendMessage(chatId, successMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при отправке заявки:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            } else if (msg.text === '❌ Отменить') {
                userStates.delete(chatId);
                return showMainMenu(chatId);
            }
            break;
        }

        case 'has_group': {
            console.log('Обработка состояния has_group:', {
                message: msg.text,
                currentState: state
            });
            
            if (msg.text === 'Да') {
                const newState = {
                    step: 'group_size',
                    data: { 
                        ...state.data,
                        has_group: true
                    }
                };
                console.log('Установка нового состояния:', newState);
                userStates.set(chatId, newState);
                return bot.sendMessage(chatId,
                    '👥 *Сколько человек в вашей группе?*\n\n' +
                    'Введите число от 2 до 12 человек.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад']],
                            resize_keyboard: true
                        }
                    }
                );
            } else if (msg.text === 'Нет') {
                const newState = {
                    step: 'training_for',
                    data: { 
                        ...state.data,
                        has_group: false
                    }
                };
                console.log('Установка нового состояния:', newState);
                userStates.set(chatId, newState);
                return bot.sendMessage(chatId,
                    '👤 *Для кого тренировка?*\n\n' +
                    '1. Для себя\n' +
                    '2. Для ребенка\n' +
                    '3. Для себя и ребенка',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['1. Для себя'],
                                ['2. Для ребенка'],
                                ['3. Для себя и ребенка'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }
        case 'group_size': {
            const size = parseInt(msg.text);
            if (isNaN(size) || size < 2 || size > 12) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, введите число от 2 до 12 человек.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            // Проверяем, что мы в правильном состоянии
            if (!state.data.has_group) {
                console.error('Ошибка состояния: has_group не установлен');
                userStates.delete(chatId);
                return showMainMenu(chatId);
            }

            const newState = {
                step: 'training_for',
                data: { 
                    ...state.data,
                    group_size: size
                }
            };
            console.log('Установка нового состояния:', newState);
            userStates.set(chatId, newState);
            return bot.sendMessage(chatId,
                '👤 *Для кого тренировка?*\n\n' +
                '1. Для себя\n' +
                '2. Для ребенка\n' +
                '3. Для себя и ребенка',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['1. Для себя'],
                            ['2. Для ребенка'],
                            ['3. Для себя и ребенка'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }
        case 'training_for': {
            let trainingFor;
            if (msg.text === '1. Для себя') {
                trainingFor = 'self';
                userStates.set(chatId, {
                    step: 'suggest_training_frequency',
                    data: { ...state.data, training_for: trainingFor }
                });
                return bot.sendMessage(chatId,
                    '🔄 *Как часто планируете тренироваться?*\n\n' +
                    '1. Разово\n' +
                    '2. Регулярно',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['1. Разово'],
                                ['2. Регулярно'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            } else if (msg.text.startsWith('Для ребенка:')) {
                // Получаем ID клиента по telegram_id
                const clientResult = await pool.query(
                    'SELECT id FROM clients WHERE telegram_id = $1',
                    [state.data.telegram_id]
                );
                
                if (!clientResult.rows[0]) {
                    return bot.sendMessage(chatId,
                        '❌ Ошибка: клиент не найден. Пожалуйста, обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                const clientId = clientResult.rows[0].id;

                // Получаем информацию о детях клиента
                const childrenResult = await pool.query(
                    'SELECT id, full_name FROM children WHERE parent_id = $1',
                    [clientId]
                );
                
                if (childrenResult.rows.length === 0) {
                    return bot.sendMessage(chatId,
                        '❌ У вас нет зарегистрированных детей. Пожалуйста, выберите другой вариант.',
                        {
                            reply_markup: {
                                keyboard: [
                                    ['1. Для себя'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                // Извлекаем имя ребенка из сообщения
                const childName = msg.text.split(': ')[1];
                const selectedChild = childrenResult.rows.find(child => child.full_name === childName);
                
                if (!selectedChild) {
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при выборе ребенка. Пожалуйста, попробуйте еще раз.',
                        {
                            reply_markup: {
                                keyboard: [
                                    ['1. Для себя'],
                                    ...childrenResult.rows.map(child => [`Для ребенка: ${child.full_name}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                trainingFor = 'child';
                userStates.set(chatId, {
                    step: 'suggest_training_frequency',
                    data: { 
                        ...state.data, 
                        training_for: trainingFor,
                        child_id: selectedChild.id,
                        child_name: selectedChild.full_name
                    }
                });
                return bot.sendMessage(chatId,
                    '🔄 *Как часто планируете тренироваться?*\n\n' +
                    '1. Разово\n' +
                    '2. Регулярно',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['1. Разово'],
                                ['2. Регулярно'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            } else if (msg.text === '🔙 Назад в меню') {
                userStates.delete(chatId);
                return showMainMenu(chatId);
            } else {
                // Получаем ID клиента по telegram_id
                const clientResult = await pool.query(
                    'SELECT id FROM clients WHERE telegram_id = $1',
                    [state.data.telegram_id]
                );
                
                if (!clientResult.rows[0]) {
                    return bot.sendMessage(chatId,
                        '❌ Ошибка: клиент не найден. Пожалуйста, обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                const clientId = clientResult.rows[0].id;

                // Получаем информацию о детях клиента
                const childrenResult = await pool.query(
                    'SELECT id, full_name FROM children WHERE parent_id = $1',
                    [clientId]
                );
                
                if (childrenResult.rows.length === 0) {
                    return bot.sendMessage(chatId,
                        '❌ У вас нет зарегистрированных детей. Пожалуйста, выберите другой вариант.',
                        {
                            reply_markup: {
                                keyboard: [
                                    ['1. Для себя'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                // Формируем сообщение с списком детей
                let message = '👤 *Для кого тренировка?*\n\n';
                message += '1. Для себя\n';
                childrenResult.rows.forEach((child, index) => {
                    message += `${index + 2}. Для ребенка: ${child.full_name}\n`;
                });

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['1. Для себя'],
                            ...childrenResult.rows.map(child => [`Для ребенка: ${child.full_name}`]),
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                });
            }
            break;
        }
        case 'training_frequency': {
            let frequency;
            if (msg.text === '1. Разово') frequency = 'once';
            else if (msg.text === '2. Регулярно') frequency = 'regular';
            else {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите один из предложенных вариантов.',
                    {
                        reply_markup: {
                            keyboard: [
                                ['1. Разово'],
                                ['2. Регулярно'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            userStates.set(chatId, {
                step: 'sport_type',
                data: { ...state.data, training_frequency: frequency }
            });
            return bot.sendMessage(chatId,
                '🎿 *Выберите тип спорта:*\n\n' +
                '1. Горные лыжи\n' +
                '2. Сноуборд',
                { 
                    parse_mode: 'Markdown', 
                    reply_markup: { 
                        keyboard: [
                            ['1. Горные лыжи'],
                            ['2. Сноуборд'],
                            ['🔙 Назад в меню']
                        ], 
                        resize_keyboard: true 
                    } 
                }
            );
        }
        case 'sport_type': {
            let sportType;
            if (msg.text === '1. Горные лыжи') sportType = 'ski';
            else if (msg.text === '2. Сноуборд') sportType = 'snowboard';
            else {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите один из предложенных вариантов.',
                    {
                        reply_markup: {
                            keyboard: [
                                ['1. Горные лыжи'],
                                ['2. Сноуборд'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            userStates.set(chatId, {
                step: 'skill_level',
                data: { ...state.data, sport_type: sportType }
            });
            return bot.sendMessage(chatId,
                '📊 *Оцените ваш уровень подготовки от 0 до 10:*\n\n' +
                '0 - Начинающий\n' +
                '10 - Профессионал',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
        case 'skill_level': {
            const level = parseInt(msg.text);
            if (isNaN(level) || level < 0 || level > 10) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, введите число от 0 до 10.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            userStates.set(chatId, {
                step: 'suggest_preferred_date',
                data: { ...state.data, skill_level: level }
            });
            return bot.sendMessage(chatId,
                '📅 *Выберите предпочтительную дату в формате ДД.ММ.ГГГГ:*\n\n' +
                'Например: 25.12.2024',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
        case 'suggest_skill_level': {
            const level = parseInt(msg.text);
            if (isNaN(level) || level < 0 || level > 10) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, введите число от 0 до 10.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            userStates.set(chatId, {
                step: 'suggest_preferred_date',
                data: { ...state.data, skill_level: level }
            });
            return bot.sendMessage(chatId,
                '📊 *Оцените ваш уровень подготовки от 0 до 10:*\n\n' +
                '0 - Начинающий\n' +
                '10 - Профессионал',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
        case 'group_training_selection': {
            const selectedIndex = parseInt(msg.text) - 1;
            const state = userStates.get(chatId);
            
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.data.available_sessions.length) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите тренировку из списка.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            try {
                const selectedSession = state.data.available_sessions[selectedIndex];
                
                // Получаем данные клиента
                const clientResult = await pool.query(
                    `SELECT c.*, 
                        EXTRACT(YEAR FROM AGE(CURRENT_DATE, c.birth_date)) as age,
                        w.balance
                    FROM clients c
                    LEFT JOIN wallets w ON c.id = w.client_id
                    WHERE c.id = $1`,
                    [state.data.client_id]
                );
                
                const client = clientResult.rows[0];
                const clientAge = Math.floor(client.age);

                // Определяем тип тренировки по названию группы
                const isChildrenTraining = selectedSession.group_name.toLowerCase().includes('дети');
                const isAdultTraining = selectedSession.group_name.toLowerCase().includes('взрослые');
                const isGeneralTraining = !isChildrenTraining && !isAdultTraining;

                // Проверяем возрастные ограничения
                if (isChildrenTraining) {
                    if (clientAge >= 18) {
                        // Проверяем наличие детей у клиента
                        const childrenResult = await pool.query(
                            `SELECT id, full_name, 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age,
                                skill_level
                            FROM children 
                            WHERE parent_id = $1 AND 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) < 18`,
                            [state.data.client_id]
                        );

                        if (childrenResult.rows.length === 0) {
                            return bot.sendMessage(chatId,
                                '❌ На данную тренировку можно записать только детей до 18 лет.\n\n' +
                                'У вас нет детей младше 18 лет или вы не добавили их в профиль.\n\n' +
                                'Вы можете:\n' +
                                '• Выбрать другую тренировку\n' +
                                '• Добавить человека в профиль',
                                {
                                    reply_markup: {
                                        keyboard: [
                                            ['🎿 Выбрать другую тренировку'],
                                            ['👤 Добавить человека'],
                                            ['🔙 Назад в меню']
                                        ],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }

                        // Если есть дети, предлагаем выбрать ребенка
                        state.data.selected_session = selectedSession;
                        state.data.available_children = childrenResult.rows;
                        state.data.training_type = 'children';
                        state.step = 'select_child_for_training';
                        userStates.set(chatId, state);

                        let message = '👤 *Выберите человека для записи на тренировку:*\n\n';
                        childrenResult.rows.forEach((child, index) => {
                            message += `${index + 1}. ${child.full_name} (${Math.floor(child.age)} лет, ${child.skill_level} уровень)\n`;
                        });

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ...childrenResult.rows.map((child, i) => [`${i + 1}. ${child.full_name} (${child.skill_level} ур.)`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        });
                    }
                    // Если клиент младше 18 лет, он может записаться сам
                } else if (isAdultTraining) {
                    if (clientAge < 18) {
                        // Проверяем, есть ли у клиента дети старше 18 лет
                        const childrenResult = await pool.query(
                            `SELECT id, full_name, 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age
                            FROM children 
                            WHERE parent_id = $1 AND 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) >= 18`,
                            [state.data.client_id]
                        );

                        if (childrenResult.rows.length === 0) {
                            return bot.sendMessage(chatId,
                                '❌ На данную тренировку можно записаться только с 18 лет.\n\n' +
                                'Пожалуйста, выберите детскую тренировку или тренировку без возрастных ограничений.',
                                {
                                    reply_markup: {
                                        keyboard: [['🔙 Назад в меню']],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }

                        // Если есть дети старше 18 лет, предлагаем выбрать ребенка
                        state.data.selected_session = selectedSession;
                        state.data.available_children = childrenResult.rows;
                        state.data.training_type = 'children';
                        state.step = 'select_child_for_training';
                        userStates.set(chatId, state);

                        let message = '👤 *Выберите человека для записи на тренировку:*\n\n';
                        childrenResult.rows.forEach((child, index) => {
                            message += `${index + 1}. ${child.full_name} (${Math.floor(child.age)} лет)\n`;
                        });

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ...childrenResult.rows.map((child, i) => [`${i + 1}. ${child.full_name}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        });
                    }
                    // Если клиент старше 18 лет, он может записаться сам
                }
                // Для общей тренировки нет возрастных ограничений
                
                // Для общих тренировок предлагаем выбор участника
                if (isGeneralTraining) {
                    // Проверяем наличие детей у клиента
                    const childrenResult = await pool.query(
                        `SELECT id, full_name, 
                            EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age,
                            skill_level
                        FROM children 
                        WHERE parent_id = $1`,
                        [state.data.client_id]
                    );

                    if (childrenResult.rows.length > 0) {
                        // Если есть дети, предлагаем выбрать участника
                        state.data.selected_session = selectedSession;
                        state.data.available_children = childrenResult.rows;
                        state.data.training_type = 'general';
                        state.step = 'select_child_for_training';
                        userStates.set(chatId, state);

                        let message = '👤 *Выберите участника для записи на тренировку:*\n\n';
                        message += `1. Для себя (${client.full_name})\n`;
                        childrenResult.rows.forEach((child, index) => {
                            message += `${index + 2}. Для ребенка: ${child.full_name} (${Math.floor(child.age)} лет, ${child.skill_level} уровень)\n`;
                        });

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['1. Для себя'],
                                    ...childrenResult.rows.map((child, i) => [`${i + 2}. Для ребенка: ${child.full_name}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        });
                    }
                    // Если детей нет, продолжаем с записью для клиента
                }

                // Форматируем дату и время
                const date = new Date(selectedSession.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = selectedSession.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;

                // Безопасное форматирование цены
                let formattedPrice = '—';
                try {
                    const price = parseFloat(selectedSession.price);
                    if (!isNaN(price)) {
                        formattedPrice = price.toFixed(2);
                    }
                } catch (e) {
                    console.error('Ошибка при форматировании цены:', e);
                }

                // Безопасное форматирование баланса
                let formattedBalance = '—';
                try {
                    const balance = parseFloat(client.balance);
                    if (!isNaN(balance)) {
                        formattedBalance = balance.toFixed(2);
                    }
                } catch (e) {
                    console.error('Ошибка при форматировании баланса:', e);
                }

                // Формируем сообщение с деталями тренировки
                let message = '📋 *Проверьте данные перед записью на тренировку:*\n\n';
                message += `👤 *ФИО участника:* ${client.full_name}\n`;
                message += `📅 *Дата тренировки:* ${formattedDate} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${formattedTime}\n`;
                message += `👥 *Группа:* ${selectedSession.group_name}\n`;
                message += `👥 *Участников:* ${selectedSession.current_participants}/${selectedSession.max_participants}\n`;
                message += `📊 *Уровень:* ${selectedSession.skill_level}/10\n`;
                message += `🎿 *Тренажер:* ${selectedSession.simulator_name}\n`;
                message += `👨‍🏫 *Тренер:* ${selectedSession.trainer_name || 'без тренера'}\n`;
                message += `💰 *Цена:* ${formattedPrice} руб.\n`;
                message += `💳 *Баланс:* ${formattedBalance} руб.\n\n`;

                // Добавляем блок про уровень
                const clientLevel = client.skill_level || 0;
                if (clientLevel >= selectedSession.skill_level) {
                    message += `✅ Ваш текущий уровень: ${clientLevel}/10 — вы можете записаться на эту тренировку! Отличный выбор! 😎🎿\n\n`;
                } else {
                    message += `⚠️ Ваш уровень: ${clientLevel}/10. Для этой тренировки требуется уровень ${selectedSession.skill_level}/10.\n`;
                    message += `К сожалению, пока вы не можете записаться на эту тренировку. Не расстраивайтесь — попробуйте выбрать другую или прокачайте свой скилл! 💪😉\n`;
                    message += `Если подходящих тренировок нет, вы всегда можете предложить свою через меню «💡 Предложить тренировку».\n\n`;
                }

                message += 'Выберите действие:';

                // Сохраняем выбранную тренировку в состоянии
                state.data.selected_session = selectedSession;
                state.step = 'confirm_group_training';
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['✅ Записаться'],
                            ['💳 Пополнить баланс'],
                            ['❌ Я передумал'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                });
            } catch (error) {
                console.error('Ошибка при проверке тренировки:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при проверке тренировки. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }

        case 'select_child_for_training': {
            const state = userStates.get(chatId);
            
            // Обработка выбора "Для себя" в общих тренировках
            if (msg.text === '1. Для себя') {
                const selectedSession = state.data.selected_session;

                // Получаем данные клиента
                const clientResult = await pool.query(
                    `SELECT c.*, w.balance 
                    FROM clients c 
                    LEFT JOIN wallets w ON c.id = w.client_id 
                    WHERE c.id = $1`,
                    [state.data.client_id]
                );
                
                const client = clientResult.rows[0];
                const balance = parseFloat(client.balance || 0);

                // Форматируем дату и время
                const date = new Date(selectedSession.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = selectedSession.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;
                const price = parseFloat(selectedSession.price);

                // Формируем сообщение с деталями тренировки для клиента
                let message = '📋 *Проверьте данные перед записью на тренировку:*\n\n';
                message += `👤 *ФИО участника:* ${client.full_name}\n`;
                message += `📅 *Дата тренировки:* ${formattedDate} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${formattedTime}\n`;
                message += `👥 *Группа:* ${selectedSession.group_name}\n`;
                message += `👥 *Участников:* ${selectedSession.current_participants}/${selectedSession.max_participants}\n`;
                message += `📊 *Уровень:* ${selectedSession.skill_level}/10\n`;
                message += `🎿 *Тренажер:* ${selectedSession.simulator_name}\n`;
                message += `👨‍🏫 *Тренер:* ${selectedSession.trainer_name || 'без тренера'}\n`;
                message += `💰 *Цена:* ${price.toFixed(2)} руб.\n`;
                message += `💳 *Баланс:* ${balance.toFixed(2)} руб.\n\n`;

                // Добавляем блок про уровень клиента
                const clientLevel = client.skill_level || 0;
                if (clientLevel >= selectedSession.skill_level) {
                    message += `✅ Ваш текущий уровень: ${clientLevel}/10 — вы можете записаться на эту тренировку! Отличный выбор! 😎🎿\n\n`;
                } else {
                    message += `⚠️ Ваш уровень: ${clientLevel}/10. Для этой тренировки требуется уровень ${selectedSession.skill_level}/10.\n`;
                    message += `К сожалению, пока вы не можете записаться на эту тренировку. Не расстраивайтесь — попробуйте выбрать другую или прокачайте свой скилл! 💪😉\n`;
                    message += `Если подходящих тренировок нет, вы всегда можете предложить свою через меню «💡 Предложить тренировку».\n\n`;
                }

                message += 'Выберите действие:';

                // НЕ сохраняем selected_child - это означает запись для самого клиента
                state.step = 'confirm_group_training';
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['✅ Записаться'],
                            ['💳 Пополнить баланс'],
                            ['❌ Я передумал'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                });
            }

            // Обработка выбора ребенка с учетом типа тренировки
            const selectedIndex = state.data.training_type === 'children' 
                ? parseInt(msg.text) - 1  // Детские тренировки: 1,2,3 → 0,1,2
                : parseInt(msg.text) - 2; // Общие тренировки: 1="Для себя", 2,3 → 0,1
            
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.data.available_children.length) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите участника из списка.',
                    {
                        reply_markup: {
                            keyboard: [
                                ['1. Для себя'],
                                ...state.data.available_children.map((child, i) => [`${i + 2}. Для ребенка: ${child.full_name}`]),
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const selectedChild = state.data.available_children[selectedIndex];
            const selectedSession = state.data.selected_session;

            // Проверяем уровень подготовки ребенка
            if (selectedChild.skill_level < selectedSession.skill_level) {
                return bot.sendMessage(chatId,
                    `❌ Нельзя записать ребенка на эту тренировку.\n\n` +
                    `Уровень подготовки ребенка (${selectedChild.skill_level}) ниже требуемого уровня тренировки (${selectedSession.skill_level}).\n\n` +
                    `Пожалуйста, выберите тренировку с подходящим уровнем или подождите, пока уровень подготовки ребенка повысится.`,
                    {
                        reply_markup: {
                            keyboard: [
                                ['🎿 Выбрать другую тренировку'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Получаем баланс клиента
            const balanceResult = await pool.query(
                'SELECT balance FROM wallets WHERE client_id = $1',
                [state.data.client_id]
            );
            const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
            
            // Сохраняем баланс в состоянии
            state.data.client_balance = balance;

            // Форматируем дату и время
            const date = new Date(selectedSession.session_date);
            const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
            const [hours, minutes] = selectedSession.start_time.split(':');
            const formattedTime = `${hours}:${minutes}`;

            // Преобразуем цену в число
            const price = parseFloat(selectedSession.price);

            // Формируем сообщение с деталями тренировки
            let message = '📋 *Проверьте данные перед записью на тренировку:*\n\n';
            message += `👤 *ФИО участника:* ${selectedChild.full_name}\n`;
            message += `📅 *Дата тренировки:* ${formattedDate} (${dayOfWeek})\n`;
            message += `⏰ *Время:* ${formattedTime}\n`;
            message += `👥 *Группа:* ${selectedSession.group_name}\n`;
            message += `👥 *Участников:* ${selectedSession.current_participants}/${selectedSession.max_participants}\n`;
            message += `📊 *Уровень:* ${selectedSession.skill_level}/10\n`;
            message += `🎿 *Тренажер:* ${selectedSession.simulator_name}\n`;
            message += `👨‍🏫 *Тренер:* ${selectedSession.trainer_name || 'без тренера'}\n`;
            message += `💰 *Цена:* ${price.toFixed(2)} руб.\n`;
            message += `💳 *Баланс:* ${balance.toFixed(2)} руб.\n\n`;

            // Добавляем блок про уровень ребенка
            const childLevel = selectedChild.skill_level || 0;
            if (childLevel >= selectedSession.skill_level) {
                message += `✅ Уровень вашего ребенка: ${childLevel}/10 — можно записаться на эту тренировку! Молодцы! 🏅👶\n\n`;
            } else {
                message += `⚠️ Уровень ребенка: ${childLevel}/10. Для этой тренировки требуется уровень ${selectedSession.skill_level}/10.\n`;
                message += `Пока нельзя записаться на эту тренировку. Не переживайте — выберите другую или подождите, пока уровень подрастет! 🚀😉\n`;
                message += `Если подходящих тренировок нет, вы всегда можете предложить свою через меню «💡 Предложить тренировку».\n\n`;
            }

            message += 'Выберите действие:';

            // Сохраняем выбранного ребенка в состоянии
            state.data.selected_child = selectedChild;
            state.step = 'confirm_group_training';
            userStates.set(chatId, state);

            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['✅ Записаться'],
                        ['💳 Пополнить баланс'],
                        ['❌ Я передумал'],
                        ['🔙 Назад']
                    ],
                    resize_keyboard: true
                }
            });
        }
        case 'natural_slope_group_training_selection': {
            const selectedIndex = parseInt(msg.text) - 1;
            const state = userStates.get(chatId);
            
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= (state.data.available_group_trainings?.length || 0)) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите тренировку из списка.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            try {
                const selectedTraining = state.data.available_group_trainings[selectedIndex];
                
                // Получаем client_id из состояния
                if (!state.data.client_id) {
                    const client = await getClientByTelegramId(msg.from.id.toString());
                    if (!client) {
                        return bot.sendMessage(chatId, '❌ Клиент не найден. Пожалуйста, зарегистрируйтесь.');
                    }
                    state.data.client_id = client.id;
                    userStates.set(chatId, state);
                }
                const clientId = state.data.client_id;
                
                // Получаем данные клиента
                const clientResult = await pool.query(
                    `SELECT c.*, 
                        EXTRACT(YEAR FROM AGE(CURRENT_DATE, c.birth_date)) as age,
                        COALESCE(w.balance, 0) as balance
                    FROM clients c
                    LEFT JOIN wallets w ON c.id = w.client_id
                    WHERE c.id = $1`,
                    [clientId]
                );
                
                if (!clientResult.rows[0]) {
                    return bot.sendMessage(chatId, '❌ Клиент не найден.');
                }
                
                const client = clientResult.rows[0];
                const clientAge = Math.floor(client.age);

                // Определяем тип тренировки по названию группы
                const isChildrenTraining = selectedTraining.group_name?.toLowerCase().includes('дети');
                const isAdultTraining = selectedTraining.group_name?.toLowerCase().includes('взрослые');
                const isGeneralTraining = !isChildrenTraining && !isAdultTraining;

                // Проверяем возрастные ограничения
                if (isChildrenTraining) {
                    if (clientAge >= 18) {
                        // Проверяем наличие детей у клиента
                        const childrenResult = await pool.query(
                            `SELECT id, full_name, 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age,
                                skill_level
                            FROM children 
                            WHERE parent_id = $1 AND 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) < 18`,
                            [clientId]
                        );

                        if (childrenResult.rows.length === 0) {
                            return bot.sendMessage(chatId,
                                '❌ На данную тренировку можно записать только детей до 18 лет.\n\n' +
                                'У вас нет детей младше 18 лет или вы не добавили их в профиль.\n\n' +
                                'Вы можете:\n' +
                                '• Выбрать другую тренировку\n' +
                                '• Добавить человека в профиль',
                                {
                                    reply_markup: {
                                        keyboard: [
                                            ['🏔️ Выбрать другую тренировку'],
                                            ['👤 Добавить человека'],
                                            ['🔙 Назад в меню']
                                        ],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }

                        // Если есть дети, предлагаем выбрать ребенка
                        state.data.selected_training = selectedTraining;
                        state.data.available_children = childrenResult.rows;
                        state.data.training_type = 'children';
                        state.step = 'select_child_for_natural_slope_training';
                        userStates.set(chatId, state);

                        let message = '👤 *Выберите человека для записи на тренировку:*\n\n';
                        childrenResult.rows.forEach((child, index) => {
                            message += `${index + 1}. ${child.full_name} (${Math.floor(child.age)} лет, ${child.skill_level || '-'} уровень)\n`;
                        });

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ...childrenResult.rows.map((child, i) => [`${i + 1}. ${child.full_name} (${child.skill_level || '-'} ур.)`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        });
                    }
                    // Если клиент младше 18 лет, он может записаться сам
                } else if (isAdultTraining) {
                    if (clientAge < 18) {
                        // Проверяем, есть ли у клиента дети старше 18 лет
                        const childrenResult = await pool.query(
                            `SELECT id, full_name, 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age
                            FROM children 
                            WHERE parent_id = $1 AND 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) >= 18`,
                            [clientId]
                        );

                        if (childrenResult.rows.length === 0) {
                            return bot.sendMessage(chatId,
                                '❌ На данную тренировку можно записаться только с 18 лет.\n\n' +
                                'Пожалуйста, выберите детскую тренировку или тренировку без возрастных ограничений.',
                                {
                                    reply_markup: {
                                        keyboard: [['🔙 Назад в меню']],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }

                        // Если есть дети старше 18 лет, предлагаем выбрать ребенка
                        state.data.selected_training = selectedTraining;
                        state.data.available_children = childrenResult.rows;
                        state.data.training_type = 'children';
                        state.step = 'select_child_for_natural_slope_training';
                        userStates.set(chatId, state);

                        let message = '👤 *Выберите человека для записи на тренировку:*\n\n';
                        childrenResult.rows.forEach((child, index) => {
                            message += `${index + 1}. ${child.full_name} (${Math.floor(child.age)} лет)\n`;
                        });

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ...childrenResult.rows.map((child, i) => [`${i + 1}. ${child.full_name}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        });
                    }
                    // Если клиент старше 18 лет, он может записаться сам
                }
                // Для общей тренировки нет возрастных ограничений
                
                // Для общих тренировок предлагаем выбор участника
                if (isGeneralTraining) {
                    // Проверяем наличие детей у клиента
                    const childrenResult = await pool.query(
                        `SELECT id, full_name, 
                            EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age,
                            skill_level
                        FROM children 
                        WHERE parent_id = $1`,
                        [clientId]
                    );

                    if (childrenResult.rows.length > 0) {
                        // Если есть дети, предлагаем выбрать участника
                        state.data.selected_training = selectedTraining;
                        state.data.available_children = childrenResult.rows;
                        state.data.training_type = 'general';
                        state.step = 'select_child_for_natural_slope_training';
                        userStates.set(chatId, state);

                        let message = '👤 *Выберите участника для записи на тренировку:*\n\n';
                        message += `1. Для себя (${client.full_name})\n`;
                        childrenResult.rows.forEach((child, index) => {
                            message += `${index + 2}. Для ребенка: ${child.full_name} (${Math.floor(child.age)} лет, ${child.skill_level || '-'} уровень)\n`;
                        });

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['1. Для себя'],
                                    ...childrenResult.rows.map((child, i) => [`${i + 2}. Для ребенка: ${child.full_name}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        });
                    }
                    // Если детей нет, продолжаем с записью для клиента
                }

                // Форматируем дату и время
                const date = new Date(selectedTraining.date);
                const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const timeStr = String(selectedTraining.start_time).substring(0, 5);
                const balance = parseFloat(client.balance || 0);
                const pricePerPerson = selectedTraining.max_participants > 0 && selectedTraining.price 
                    ? (parseFloat(selectedTraining.price) / selectedTraining.max_participants) 
                    : 0;

                // Формируем сообщение с деталями тренировки
                let message = '📋 *Проверьте данные перед записью на тренировку:*\n\n';
                message += `👤 *ФИО участника:* ${client.full_name}\n`;
                message += `📅 *Дата тренировки:* ${dateStr} (${dayName})\n`;
                message += `⏰ *Время:* ${timeStr}\n`;
                message += `👥 *Группа:* ${selectedTraining.group_name || 'Групповая тренировка'}\n`;
                message += `👥 *Мест:* ${selectedTraining.current_participants || 0}/${selectedTraining.max_participants}\n`;
                message += `📊 *Уровень:* ${selectedTraining.skill_level || '-'}/10\n`;
                const location = selectedTraining.location || state.data?.location || 'kuliga';
                message += `🏔️ *Место:* ${getLocationDisplayName(location)}\n`;
                if (selectedTraining.trainer_name) {
                    message += `👨‍🏫 *Тренер:* ${selectedTraining.trainer_name}\n`;
                }
                message += `💰 *Цена за человека:* ${pricePerPerson.toFixed(2)} ₽\n`;
                message += `💳 *Баланс:* ${balance.toFixed(2)} ₽\n\n`;

                // Добавляем блок про уровень
                const clientLevel = client.skill_level || 0;
                const requiredLevel = selectedTraining.skill_level || 0;
                if (clientLevel >= requiredLevel) {
                    message += `✅ Ваш текущий уровень: ${clientLevel}/10 — вы можете записаться на эту тренировку! Отличный выбор! 😎🎿\n\n`;
                } else {
                    message += `⚠️ Ваш уровень: ${clientLevel}/10. Для этой тренировки требуется уровень ${requiredLevel}/10.\n`;
                    message += `К сожалению, пока вы не можете записаться на эту тренировку. Не расстраивайтесь — попробуйте выбрать другую или прокачайте свой скилл! 💪😉\n\n`;
                }

                message += 'Выберите действие:';

                // Сохраняем выбранную тренировку в состоянии
                state.data.selected_training = selectedTraining;
                if (!state.data.client_id) {
                    state.data.client_id = clientId;
                }
                state.step = 'confirm_natural_slope_group_training';
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['✅ Записаться'],
                            ['💳 Пополнить баланс'],
                            ['❌ Я передумал'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                });
            } catch (error) {
                console.error('Ошибка при проверке тренировки естественного склона:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при проверке тренировки. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }

        case 'select_child_for_natural_slope_training': {
            const state = userStates.get(chatId);
            
            // Обработка кнопки "🔙 Назад" и "🔙 Назад в меню"
            if (msg.text === '🔙 Назад' || msg.text === '🔙 Назад в меню') {
                if (msg.text === '🔙 Назад в меню') {
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                }
                state.step = 'natural_slope_group_training_selection';
                userStates.set(chatId, state);
                return showAvailableGroupTrainings(chatId, state.data.client_id);
            }
            
            // Обработка выбора "Для себя" в общих тренировках
            if (msg.text === '1. Для себя') {
                const selectedTraining = state.data.selected_training;

                // Получаем данные клиента
                const clientResult = await pool.query(
                    `SELECT c.*, COALESCE(w.balance, 0) as balance 
                    FROM clients c 
                    LEFT JOIN wallets w ON c.id = w.client_id 
                    WHERE c.id = $1`,
                    [state.data.client_id]
                );
                
                const client = clientResult.rows[0];
                const balance = parseFloat(client.balance || 0);
                const pricePerPerson = selectedTraining.max_participants > 0 && selectedTraining.price 
                    ? (parseFloat(selectedTraining.price) / selectedTraining.max_participants) 
                    : 0;

                // Форматируем дату и время
                const date = new Date(selectedTraining.date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const timeStr = String(selectedTraining.start_time).substring(0, 5);

                // Формируем сообщение с деталями тренировки для клиента
                let message = '📋 *Проверьте данные перед записью на тренировку:*\n\n';
                message += `👤 *ФИО участника:* ${client.full_name}\n`;
                message += `📅 *Дата тренировки:* ${dateStr} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${timeStr}\n`;
                message += `👥 *Группа:* ${selectedTraining.group_name || 'Групповая тренировка'}\n`;
                message += `👥 *Мест:* ${selectedTraining.current_participants || 0}/${selectedTraining.max_participants}\n`;
                message += `📊 *Уровень:* ${selectedTraining.skill_level || '-'}/10\n`;
                const location = selectedTraining.location || state.data?.location || 'kuliga';
                message += `🏔️ *Место:* ${getLocationDisplayName(location)}\n`;
                if (selectedTraining.trainer_name) {
                    message += `👨‍🏫 *Тренер:* ${selectedTraining.trainer_name}\n`;
                }
                message += `💰 *Цена за человека:* ${pricePerPerson.toFixed(2)} ₽\n`;
                message += `💳 *Баланс:* ${balance.toFixed(2)} ₽\n\n`;

                // Добавляем блок про уровень клиента
                const clientLevel = client.skill_level || 0;
                const requiredLevel = selectedTraining.skill_level || 0;
                if (clientLevel >= requiredLevel) {
                    message += `✅ Ваш текущий уровень: ${clientLevel}/10 — вы можете записаться на эту тренировку! Отличный выбор! 😎🎿\n\n`;
                } else {
                    message += `⚠️ Ваш уровень: ${clientLevel}/10. Для этой тренировки требуется уровень ${requiredLevel}/10.\n`;
                    message += `К сожалению, пока вы не можете записаться на эту тренировку. Не расстраивайтесь — попробуйте выбрать другую или прокачайте свой скилл! 💪😉\n\n`;
                }

                message += 'Выберите действие:';

                // НЕ сохраняем selected_child - это означает запись для самого клиента
                state.step = 'confirm_natural_slope_group_training';
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['✅ Записаться'],
                            ['💳 Пополнить баланс'],
                            ['❌ Я передумал'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                });
            }

            // Обработка выбора ребенка с учетом типа тренировки
            const selectedIndex = state.data.training_type === 'children' 
                ? parseInt(msg.text) - 1  // Детские тренировки: 1,2,3 → 0,1,2
                : parseInt(msg.text) - 2; // Общие тренировки: 1="Для себя", 2,3 → 0,1
            
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.data.available_children.length) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите участника из списка.',
                    {
                        reply_markup: {
                            keyboard: [
                                ['1. Для себя'],
                                ...state.data.available_children.map((child, i) => [`${i + 2}. Для ребенка: ${child.full_name}`]),
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const selectedChild = state.data.available_children[selectedIndex];
            const selectedTraining = state.data.selected_training;

            // Проверяем уровень подготовки ребенка
            const childLevel = selectedChild.skill_level || 0;
            const requiredLevel = selectedTraining.skill_level || 0;
            if (childLevel < requiredLevel) {
                return bot.sendMessage(chatId,
                    `❌ Нельзя записать ребенка на эту тренировку.\n\n` +
                    `Уровень подготовки ребенка (${childLevel}) ниже требуемого уровня тренировки (${requiredLevel}).\n\n` +
                    `Пожалуйста, выберите тренировку с подходящим уровнем или подождите, пока уровень подготовки ребенка повысится.`,
                    {
                        reply_markup: {
                            keyboard: [
                                ['🏔️ Выбрать другую тренировку'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Получаем баланс клиента
            const balanceResult = await pool.query(
                'SELECT COALESCE(balance, 0) as balance FROM wallets WHERE client_id = $1',
                [state.data.client_id]
            );
            const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
            
            // Сохраняем баланс в состоянии
            state.data.client_balance = balance;

            // Форматируем дату и время
            const date = new Date(selectedTraining.date);
            const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
            const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
            const timeStr = String(selectedTraining.start_time).substring(0, 5);

            // Преобразуем цену в число
            const pricePerPerson = selectedTraining.max_participants > 0 && selectedTraining.price 
                ? (parseFloat(selectedTraining.price) / selectedTraining.max_participants) 
                : 0;

            // Формируем сообщение с деталями тренировки
            let message = '📋 *Проверьте данные перед записью на тренировку:*\n\n';
            message += `👤 *ФИО участника:* ${selectedChild.full_name}\n`;
            message += `📅 *Дата тренировки:* ${dateStr} (${dayOfWeek})\n`;
            message += `⏰ *Время:* ${timeStr}\n`;
            message += `👥 *Группа:* ${selectedTraining.group_name || 'Групповая тренировка'}\n`;
            message += `👥 *Мест:* ${selectedTraining.current_participants || 0}/${selectedTraining.max_participants}\n`;
            message += `📊 *Уровень:* ${selectedTraining.skill_level || '-'}/10\n`;
            const location = selectedTraining.location || state.data?.location || 'kuliga';
            message += `🏔️ *Место:* ${getLocationDisplayName(location)}\n`;
            if (selectedTraining.trainer_name) {
                message += `👨‍🏫 *Тренер:* ${selectedTraining.trainer_name}\n`;
            }
            message += `💰 *Цена за человека:* ${pricePerPerson.toFixed(2)} ₽\n`;
            message += `💳 *Баланс:* ${balance.toFixed(2)} ₽\n\n`;

            // Добавляем блок про уровень ребенка
            if (childLevel >= requiredLevel) {
                message += `✅ Уровень вашего ребенка: ${childLevel}/10 — можно записаться на эту тренировку! Молодцы! 🏅👶\n\n`;
            } else {
                message += `⚠️ Уровень ребенка: ${childLevel}/10. Для этой тренировки требуется уровень ${requiredLevel}/10.\n`;
                message += `Пока нельзя записаться на эту тренировку. Не переживайте — выберите другую или подождите, пока уровень подрастет! 🚀😉\n\n`;
            }

            message += 'Выберите действие:';

            // Сохраняем выбранного ребенка в состоянии
            state.data.selected_child = selectedChild;
            state.step = 'confirm_natural_slope_group_training';
            userStates.set(chatId, state);

            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['✅ Записаться'],
                        ['💳 Пополнить баланс'],
                        ['❌ Я передумал'],
                        ['🔙 Назад']
                    ],
                    resize_keyboard: true
                }
            });
        }

        case 'confirm_natural_slope_group_training': {
            const state = userStates.get(chatId);
            
            if (msg.text === '🔙 Назад') {
                // Если был выбран ребенок, возвращаемся к выбору участника
                if (state.data.selected_child || state.data.available_children) {
                    state.step = 'select_child_for_natural_slope_training';
                    userStates.set(chatId, state);
                    return bot.sendMessage(chatId,
                        '👤 *Выберите участника для записи на тренировку:*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['1. Для себя'],
                                    ...(state.data.available_children || []).map((child, i) => [`${i + 2}. Для ребенка: ${child.full_name}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                } else {
                    // Иначе возвращаемся к списку тренировок
                    state.step = 'natural_slope_group_training_selection';
                    userStates.set(chatId, state);
                    return showAvailableGroupTrainings(chatId, state.data.client_id);
                }
            }

            if (msg.text === '❌ Я передумал') {
                userStates.delete(chatId);
                return showMainMenu(chatId);
            }

            if (msg.text === '✅ Записаться') {
                const selectedTraining = state.data.selected_training;
                const client = await pool.connect();

                try {
                    await client.query('BEGIN');

                    // Получаем данные клиента
                    const clientResult = await client.query(
                        `SELECT c.*, COALESCE(w.balance, 0) as balance 
                        FROM clients c 
                        LEFT JOIN wallets w ON c.id = w.client_id 
                        WHERE c.id = $1`,
                        [state.data.client_id]
                    );
                    
                    if (!clientResult.rows[0]) {
                        throw new Error('Клиент не найден');
                    }
                    
                    const clientData = clientResult.rows[0];
                    const balance = parseFloat(clientData.balance || 0);
                    // В kuliga_group_trainings уже есть price_per_person
                    const pricePerPerson = parseFloat(selectedTraining.price || 0);

                    // Проверяем наличие активного абонемента для групповых зимних тренировок
                    let useSubscription = false;
                    let subscriptionInfo = null;
                    
                    const subscriptionsCheck = await client.query(
                        `SELECT 
                            ns.*,
                            st.name as subscription_name,
                            st.sessions_count as total_sessions,
                            st.price_per_session
                         FROM natural_slope_subscriptions ns
                         JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
                         WHERE ns.client_id = $1
                            AND ns.status = 'active'
                            AND ns.remaining_sessions > 0
                            AND ns.expires_at >= CURRENT_DATE
                         ORDER BY ns.expires_at ASC, ns.purchased_at ASC
                         LIMIT 1`,
                        [state.data.client_id]
                    );

                    if (subscriptionsCheck.rows.length > 0) {
                        useSubscription = true;
                        subscriptionInfo = subscriptionsCheck.rows[0];
                        console.log(`✅ Используется абонемент ID ${subscriptionInfo.id} для клиента ${state.data.client_id}`);
                    }

                    // Проверяем баланс только если нет абонемента
                    if (!useSubscription && balance < pricePerPerson) {
                        await client.query('ROLLBACK');
                        return bot.sendMessage(chatId,
                            `❌ Недостаточно средств на балансе.\n\n` +
                            `Требуется: ${pricePerPerson.toFixed(2)} руб.\n` +
                            `Доступно: ${balance.toFixed(2)} руб.\n\n` +
                            `Пожалуйста, пополните баланс.`,
                            {
                                reply_markup: {
                                    keyboard: [
                                        ['💳 Пополнить баланс'],
                                        // ['🎫 Абонементы'], // Временно закомментировано
                                        ['🔙 Назад в меню']
                                    ],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Проверяем уровень подготовки (для клиента или ребенка)
                    let participantLevel = 0;
                    let participantName = clientData.full_name;
                    
                    if (state.data.selected_child) {
                        // Если выбран ребенок, проверяем его уровень
                        participantLevel = state.data.selected_child.skill_level || 0;
                        participantName = state.data.selected_child.full_name;
                    } else {
                        // Если выбран клиент, проверяем его уровень
                        participantLevel = clientData.skill_level || 0;
                    }
                    
                    // Для kuliga_group_trainings уровень хранится в поле level как текст, не как число
                    // Пока пропускаем проверку уровня (можно добавить позже)
                    // const requiredLevel = selectedTraining.level || 0;

                    // Проверяем количество участников в kuliga_group_trainings
                    const trainingCheck = await client.query(
                        `SELECT current_participants, max_participants, status 
                         FROM kuliga_group_trainings 
                         WHERE id = $1 
                         FOR UPDATE`,
                        [selectedTraining.id]
                    );
                    
                    if (trainingCheck.rows.length === 0) {
                        await client.query('ROLLBACK');
                        return bot.sendMessage(chatId,
                            '❌ Тренировка не найдена.',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    const trainingData = trainingCheck.rows[0];
                    
                    if (trainingData.current_participants >= trainingData.max_participants) {
                        await client.query('ROLLBACK');
                        return bot.sendMessage(chatId,
                            '❌ К сожалению, все места на эту тренировку уже заняты.',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    if (trainingData.status !== 'open' && trainingData.status !== 'confirmed') {
                        await client.query('ROLLBACK');
                        return bot.sendMessage(chatId,
                            '❌ Запись на эту тренировку временно недоступна.',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }
                    
                    // МИГРАЦИЯ 033: Создаем или находим клиента в clients (не kuliga_clients)
                    const clientPhone = clientData.phone || '';
                    const normalizedPhone = clientPhone.replace(/[^0-9+]/g, '');
                    
                    let kuligaClientId;
                    const kuligaClientCheck = await client.query(
                        `SELECT id, email FROM clients WHERE phone = $1 LIMIT 1`,
                        [normalizedPhone]
                    );
                    
                    if (kuligaClientCheck.rows.length > 0) {
                        kuligaClientId = kuligaClientCheck.rows[0].id;
                        // Если у клиента нет email, используем email из clientData (если клиент зарегистрирован в боте)
                        if (!kuligaClientCheck.rows[0].email && clientData.email) {
                            await client.query(
                                `UPDATE clients SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                                [clientData.email, kuligaClientId]
                            );
                        }
                    } else {
                        // Клиент не найден, проверяем наличие email
                        let clientEmail = clientData.email;
                        if (!clientEmail) {
                            // Если email нет, запрашиваем его у пользователя
                            await client.query('ROLLBACK');
                            client.release();
                            // Сохраняем состояние для запроса email
                            userStates.set(chatId, {
                                step: 'kuliga_group_email',
                                data: {
                                    ...state.data,
                                    participantName: participantName,
                                    normalizedPhone: normalizedPhone,
                                    selectedTraining: selectedTraining,
                                    clientData: clientData
                                }
                            });
                            return bot.sendMessage(chatId, 
                                'Укажите свой email, на который вам необходимо отправлять чеки:',
                                {
                                    reply_markup: {
                                        keyboard: [['🔙 Назад в меню']],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }
                        // Создаем нового клиента с email
                        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                        if (!emailRegex.test(clientEmail.trim())) {
                            await client.query('ROLLBACK');
                            client.release();
                            return bot.sendMessage(chatId, 
                                'Неверный формат email. Пожалуйста, введите корректный email адрес.',
                                {
                                    reply_markup: {
                                        keyboard: [['🔙 Назад в меню']],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }
                        const newKuligaClientResult = await client.query(
                            `INSERT INTO clients (full_name, phone, email, telegram_id, birth_date)
                             VALUES ($1, $2, $3, $4, '1900-01-01')
                             RETURNING id`,
                            [participantName, normalizedPhone, clientEmail.trim(), msg.from.id.toString()]
                        );
                        kuligaClientId = newKuligaClientResult.rows[0].id;
                    }
                    
                    // Определяем sport_type из тренировки
                    const sportType = selectedTraining.sport_type || 'ski';
                    
                    // Получаем информацию о тренировке для создания бронирования
                    const trainingInfo = await client.query(
                        `SELECT date, start_time, end_time FROM kuliga_group_trainings WHERE id = $1`,
                        [selectedTraining.id]
                    );
                    
                    if (trainingInfo.rows.length === 0) {
                        throw new Error('Информация о тренировке не найдена');
                    }
                    
                    const trainingDetails = trainingInfo.rows[0];
                    
                    // Создаем бронирование в kuliga_bookings
                    const bookingResult = await client.query(
                        `INSERT INTO kuliga_bookings (
                            client_id, booking_type, group_training_id,
                            date, start_time, end_time, sport_type,
                            participants_count, participants_names, participants_birth_years,
                            price_total, price_per_person,
                            status, notification_method, payer_rides
                        ) VALUES ($1, 'group', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', 'telegram', true)
                        RETURNING id`,
                        [
                            kuligaClientId,
                            selectedTraining.id,
                            trainingDetails.date,
                            trainingDetails.start_time,
                            trainingDetails.end_time,
                            sportType,
                            1, // participants_count
                            [participantName], // participants_names - передаем массив напрямую
                            [null], // participants_birth_years (можно добавить позже) - передаем массив напрямую
                            pricePerPerson, // price_total
                            pricePerPerson, // price_per_person
                        ]
                    );
                    
                    const bookingId = bookingResult.rows[0].id;
                    
                    // Увеличиваем счетчик участников в kuliga_group_trainings
                        await client.query(
                        `UPDATE kuliga_group_trainings
                         SET current_participants = current_participants + 1,
                             updated_at = CURRENT_TIMESTAMP
                             WHERE id = $1`,
                        [selectedTraining.id]
                    );

                    let amountCharged = 0;
                    let usedSubscriptionId = null;
                    let remainingAfter = null;
                    let totalSessions = null;

                    // TODO: Абонементы для групповых тренировок Кулиги пока не поддерживаются
                    // Логика абонементов работает только для старой системы training_sessions
                    // Для kuliga_group_trainings используем только оплату через баланс
                    useSubscription = false;
                    
                    if (useSubscription) {
                        // Эта ветка не будет выполнена для kuliga_group_trainings
                        // Оставлено для совместимости с будущей реализацией
                        usedSubscriptionId = subscriptionInfo.id;
                        remainingAfter = subscriptionInfo.remaining_sessions - 1;
                        totalSessions = subscriptionInfo.total_sessions;
                        amountCharged = 0;

                        // Получаем id кошелька для создания транзакции
                        const walletRes = await client.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                        const walletId = walletRes.rows[0]?.id;
                        
                        if (walletId) {
                            // Формируем дату и время для описания
                            const date = new Date(selectedTraining.date);
                            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                            const timeStr = String(selectedTraining.start_time).substring(0, 5);
                            
                            // Создаем запись в транзакциях с типом subscription_usage
                            await client.query(
                                'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                                [
                                    walletId, 
                                    0, 
                                    'subscription_usage', 
                                    `Запись по абонементу: Групповая тренировка в ${getLocationDisplayName(selectedTraining.location || state.data?.location || 'kuliga')}, ${participantName}, Дата: ${formattedDate}, Время: ${timeStr}, Длительность: 60 мин. Занятий осталось: ${remainingAfter}/${totalSessions}`
                                ]
                            );
                        }

                        console.log(`✅ Использован абонемент ${subscriptionInfo.subscription_name}. Осталось занятий: ${remainingAfter}/${totalSessions}`);
                    } else {
                        // Списываем средства с баланса
                        await client.query(
                            'UPDATE wallets SET balance = balance - $1 WHERE client_id = $2',
                            [pricePerPerson, state.data.client_id]
                        );

                        amountCharged = pricePerPerson;

                        // Получаем id кошелька для создания транзакции
                        const walletRes = await client.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                        const walletId = walletRes.rows[0]?.id;
                        
                        if (walletId) {
                            // Формируем дату и время для описания
                            const date = new Date(selectedTraining.date);
                            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                            const timeStr = String(selectedTraining.start_time).substring(0, 5);
                            
                            // Создаем запись в транзакциях (используем уже объявленную participantName)
                            await client.query(
                                'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                                [walletId, pricePerPerson, 'payment', `Запись: Групповая тренировка в ${getLocationDisplayName(selectedTraining.location || state.data?.location || 'kuliga')}, ${participantName}, Дата: ${formattedDate}, Время: ${timeStr}, Длительность: 60 мин.`]
                            );
                        }
                    }

                    await client.query('COMMIT');

                    // Проверяем и обновляем реферальный статус после записи на тренировку (включая запись по абонементу)
                    try {
                        const { updateReferralStatusOnTraining, isFirstTraining } = require('../services/referral-service');
                        const isFirst = await isFirstTraining(state.data.client_id);
                        if (isFirst) {
                            console.log(`🎁 Это первая тренировка клиента ${state.data.client_id}, проверяем реферальный бонус...`);
                            await updateReferralStatusOnTraining(state.data.client_id);
                        }
                    } catch (error) {
                        console.error('❌ Ошибка при проверке реферального бонуса:', error);
                        // Не прерываем основной процесс
                    }

                    // Проверяем milestone бонусы (посещение N тренировок)
                    try {
                        const { checkMilestoneBonuses } = require('../services/bonus-system');
                        await checkMilestoneBonuses(state.data.client_id);
                    } catch (error) {
                        console.error('❌ Ошибка при проверке milestone бонусов:', error);
                        // Не прерываем основной процесс
                    }

                    // Отправляем сообщение об успешной записи
                    const date = new Date(selectedTraining.date);
                    const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const timeStr = String(selectedTraining.start_time).substring(0, 5);
                    const newBalance = balance - amountCharged;

                    // Формируем сообщение в зависимости от способа оплаты
                    const location = selectedTraining.location || state.data?.location || 'kuliga';
                    const locationName = getLocationDisplayName(location);
                    let message = `✅ *Тренировка в ${locationName} успешно забронирована!*\n\n` +
                        `👤 *Участник:* ${participantName}\n` +
                        `📅 *Дата:* ${dateStr} (${dayName})\n` +
                        `⏰ *Время:* ${timeStr}\n` +
                        `👥 *Группа:* ${selectedTraining.group_name || 'Групповая тренировка'}\n` +
                        `👥 *Мест:* ${parseInt(participantsResult.rows[0].count) + 1}/${selectedTraining.max_participants}\n` +
                        `🏔️ *Место:* ${locationName}\n`;
                    
                    if (useSubscription) {
                        message += `🎫 *Оплата:* По абонементу "${subscriptionInfo.subscription_name}"\n` +
                            `📊 *Занятий осталось:* ${remainingAfter}/${totalSessions}\n` +
                            `💳 *Баланс:* ${balance.toFixed(2)} ₽\n\n` +
                            '🎿 Удачной тренировки!';
                    } else {
                        message += `💰 *Стоимость:* ${pricePerPerson.toFixed(2)} ₽\n` +
                            `💳 *Остаток на балансе:* ${newBalance.toFixed(2)} ₽\n\n` +
                            '🎿 Удачной тренировки!';
                    }

                    // Отправляем уведомление администратору
                    try {
                        const { notifyAdminWinterGroupTrainingCreated } = require('./admin-notify');
                        // Рассчитываем стоимость занятия по абонементу
                        // Используем price_per_session из типа абонемента, если он есть, иначе вычисляем: цена абонемента / количество занятий
                        let subscriptionPricePerSession = null;
                        if (useSubscription) {
                            if (subscriptionInfo.price_per_session) {
                                subscriptionPricePerSession = parseFloat(subscriptionInfo.price_per_session);
                            } else if (subscriptionInfo.total_paid && subscriptionInfo.total_sessions) {
                                subscriptionPricePerSession = parseFloat(subscriptionInfo.total_paid) / parseInt(subscriptionInfo.total_sessions);
                            }
                        }
                        
                        await notifyAdminWinterGroupTrainingCreated({
                            used_subscription: useSubscription,
                            subscription_name: useSubscription ? subscriptionInfo.subscription_name : null,
                            remaining_sessions: useSubscription ? remainingAfter : null,
                            total_sessions: useSubscription ? totalSessions : null,
                            subscription_price_per_session: subscriptionPricePerSession,
                            ...selectedTraining,
                            client_name: clientData.full_name,
                            client_phone: clientData.phone,
                            child_name: state.data.selected_child ? state.data.selected_child.full_name : null,
                            current_participants: parseInt(participantsResult.rows[0].count) + 1
                        });
                    } catch (error) {
                        console.error('Ошибка при отправке уведомления администратору:', error);
                    }

                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    });

                } catch (error) {
                    await client.query('ROLLBACK');
                    console.error('Ошибка при записи на групповую тренировку естественного склона:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при записи на тренировку. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                } finally {
                    client.release();
                }
            }
            break;
        }

        case 'confirm_group_training': {
            if (msg.text === '🔙 Назад') {
                state.step = 'group_training_selection';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '🎿 *Выберите тренировку:*\n\n' +
                    'Введите номер тренировки из списка.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            if (msg.text === '❌ Я передумал') {
                userStates.delete(chatId);
                return showMainMenu(chatId);
            }

            if (msg.text === '✅ Записаться') {
                const state = userStates.get(chatId);
                const selectedSession = state.data.selected_session;
                const client = await pool.connect();

                try {
                    await client.query('BEGIN');

                    // Получаем данные клиента
                    const clientResult = await client.query(
                        `SELECT c.*, w.balance 
                        FROM clients c 
                        LEFT JOIN wallets w ON c.id = w.client_id 
                        WHERE c.id = $1`,
                        [state.data.client_id]
                    );
                    
                    if (!clientResult.rows[0]) {
                        throw new Error('Клиент не найден');
                    }
                    
                    const clientData = clientResult.rows[0];
                    const balance = parseFloat(clientData.balance || 0);
                    const price = parseFloat(selectedSession.price);

                    // Проверяем баланс
                    if (balance < price) {
                        await client.query('ROLLBACK');
                        return bot.sendMessage(chatId,
                            `❌ Недостаточно средств на балансе.\n\n` +
                            `Требуется: ${price.toFixed(2)} руб.\n` +
                            `Доступно: ${balance.toFixed(2)} руб.\n\n` +
                            `Пожалуйста, пополните баланс и попробуйте записаться снова.`,
                            {
                                reply_markup: {
                                    keyboard: [
                                        ['💳 Пополнить баланс'],
                                        ['🔙 Назад в меню']
                                    ],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Проверяем уровень подготовки для взрослых
                    if (!state.data.selected_child && clientData.skill_level < selectedSession.skill_level) {
                        await client.query('ROLLBACK');
                        return bot.sendMessage(chatId,
                            `❌ Нельзя записаться на эту тренировку.\n\n` +
                            `Ваш уровень подготовки (${clientData.skill_level}) ниже требуемого уровня тренировки (${selectedSession.skill_level}).\n\n` +
                            `Пожалуйста, выберите тренировку с подходящим уровнем или подождите, пока ваш уровень подготовки повысится.`,
                            {
                                reply_markup: {
                                    keyboard: [
                                        ['🎿 Выбрать другую тренировку'],
                                        ['🔙 Назад в меню']
                                    ],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Проверяем количество участников
                    const participantsResult = await client.query(
                        'SELECT COUNT(*) as count FROM session_participants WHERE session_id = $1 AND status = $2',
                        [selectedSession.id, 'confirmed']
                    );
                    
                    if (parseInt(participantsResult.rows[0].count) >= selectedSession.max_participants) {
                        await client.query('ROLLBACK');
                        return bot.sendMessage(chatId,
                            '❌ К сожалению, все места на эту тренировку уже заняты.',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Списываем средства
                    await client.query(
                        'UPDATE wallets SET balance = balance - $1 WHERE client_id = $2',
                        [price, state.data.client_id]
                    );

                    // Получаем id кошелька для создания транзакции
                    const walletRes = await client.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                    const walletId = walletRes.rows[0]?.id;
                    
                    if (walletId) {
                        // Формируем дату и время для описания
                        const date = new Date(selectedSession.session_date);
                        const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                        const [hours, minutes] = selectedSession.start_time.split(':');
                        const formattedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
                        
                        // Получаем ФИО участника
                        const participantName = state.data.selected_child 
                            ? state.data.selected_child.full_name 
                            : clientData.full_name;
                        
                        // Создаем запись в транзакциях
                        await client.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [walletId, price, 'payment', `Запись: Групповая, ${participantName}, Дата: ${formattedDate}, Время: ${formattedTime}, Длительность: 60 мин.`]
                        );
                    }

                    // Записываем на тренировку
                    console.log('[DEBUG] Перед вставкой в session_participants:', {
                        session_id: selectedSession.id,
                        client_id: state.data.client_id,
                        child_id: state.data.selected_child ? state.data.selected_child.id : null
                    });

                    const participantResult = await client.query(
                        `INSERT INTO session_participants 
                        (session_id, client_id, child_id, is_child, status) 
                        VALUES ($1, $2, $3, $4, $5) 
                        RETURNING id`,
                        [
                            selectedSession.id,
                            state.data.client_id,
                            state.data.selected_child ? state.data.selected_child.id : null,
                            !!state.data.selected_child,
                            'confirmed'
                        ]
                    );

                    console.log('[DEBUG] Вставка в session_participants прошла успешно');

                    await client.query('COMMIT');

                    // Проверяем и обновляем реферальный статус после записи на тренировку
                    try {
                        const { updateReferralStatusOnTraining, isFirstTraining } = require('../services/referral-service');
                        const isFirst = await isFirstTraining(state.data.client_id);
                        if (isFirst) {
                            console.log(`🎁 Это первая тренировка клиента ${state.data.client_id}, проверяем реферальный бонус...`);
                            await updateReferralStatusOnTraining(state.data.client_id);
                        }
                    } catch (error) {
                        console.error('❌ Ошибка при проверке реферального бонуса:', error);
                        // Не прерываем основной процесс
                    }

                    // Проверяем milestone бонусы (посещение N тренировок)
                    try {
                        const { checkMilestoneBonuses } = require('../services/bonus-system');
                        await checkMilestoneBonuses(state.data.client_id);
                    } catch (error) {
                        console.error('❌ Ошибка при проверке milestone бонусов:', error);
                        // Не прерываем основной процесс
                    }

                    // Отправляем сообщение об успешной записи
                    const participantName = state.data.selected_child 
                        ? state.data.selected_child.full_name 
                        : clientData.full_name;

                    const message = '✅ Вы успешно записались на тренировку!\n\n' +
                        'Детали тренировки:\n' +
                        `👤 *Участник:* ${participantName}\n` +
                        `📅 *Дата:* ${formatDate(selectedSession.session_date)}\n` +
                        `⏰ *Время:* ${selectedSession.start_time}\n` +
                        `👥 *Группа:* ${selectedSession.group_name}\n` +
                        `👥 *Участников:* ${parseInt(participantsResult.rows[0].count) + 1}/${selectedSession.max_participants}\n` +
                        `📊 *Уровень:* ${selectedSession.skill_level}/10\n` +
                        `🎿 *Тренажер:* ${selectedSession.simulator_name}\n` +
                        `👨‍🏫 *Тренер:* ${selectedSession.trainer_name || 'без тренера'}\n` +
                        `💰 *Стоимость:* ${price.toFixed(2)} руб.\n\n` +
                        'Ждем вас на тренировке!';

                    // Отправляем уведомление администратору
                    try {
                        const { notifyNewGroupTrainingParticipant } = require('./admin-notify');
                        await notifyNewGroupTrainingParticipant({
                            ...selectedSession,
                            client_name: clientData.full_name,
                            client_phone: clientData.phone,
                            child_name: state.data.selected_child ? state.data.selected_child.full_name : null,
                            current_participants: parseInt(participantsResult.rows[0].count) + 1
                        });
                    } catch (error) {
                        console.error('[DEBUG] Ошибка при отправке уведомления:', error);
                    }

                    return bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    });

                } catch (error) {
                    await client.query('ROLLBACK');
                    console.error('Ошибка при записи на групповую тренировку:', error, {
                        session_id: selectedSession.id,
                        client_id: state.data.client_id,
                        child_id: state.data.selected_child ? state.data.selected_child.id : null
                    });
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при записи на тренировку. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                } finally {
                    client.release();
                }
            }
            break;
        }
        case 'main_menu': {
            if (msg.text === '📋 Мои записи') {
                try {
                    // Получаем групповые тренировки на тренажере
                    const groupResult = await pool.query(
                        `SELECT 
                                sp.id,
                                sp.session_id,
                                sp.child_id,
                                COALESCE(c.full_name, cl.full_name) as participant_name,
                                ts.session_date,
                                ts.start_time,
                                ts.duration,
                                ts.equipment_type,
                                s.name as simulator_name,
                                g.name as group_name,
                                t.full_name as trainer_name,
                                ts.skill_level,
                                ts.price,
                                ts.max_participants,
                                (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id AND status = 'confirmed') as current_participants,
                                'group' as session_type,
                                'simulator' as slope_type
                            FROM session_participants sp
                            JOIN training_sessions ts ON sp.session_id = ts.id
                            JOIN simulators s ON ts.simulator_id = s.id
                            LEFT JOIN groups g ON ts.group_id = g.id
                            LEFT JOIN trainers t ON ts.trainer_id = t.id
                            LEFT JOIN children c ON sp.child_id = c.id
                            JOIN clients cl ON sp.client_id = cl.id
                            WHERE sp.client_id = $1
                            AND ts.status = 'scheduled'
                            AND sp.status = 'confirmed'
                            AND ts.simulator_id IS NOT NULL
                            AND (
                              (ts.session_date::timestamp + ts.start_time::interval + (ts.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
                            )
                        ORDER BY ts.session_date, ts.start_time`,
                        [state.data.client_id]
                    );
                    
                    // Получаем групповые тренировки на естественном склоне
                    const winterGroupResult = await pool.query(
                        `SELECT 
                            sp.id,
                            sp.session_id,
                            sp.child_id,
                            COALESCE(c.full_name, cl.full_name) as participant_name,
                            CASE 
                                WHEN c.birth_date IS NOT NULL 
                                THEN (EXTRACT(YEAR FROM AGE(c.birth_date)) < 18)
                                ELSE false
                            END as is_child,
                            c.birth_date as participant_birth_date,
                            ts.session_date,
                            ts.start_time,
                            ts.duration,
                            ts.equipment_type,
                            NULL as simulator_name,
                            g.name as group_name,
                            t.full_name as trainer_name,
                            ts.skill_level,
                            ts.price,
                            ts.max_participants,
                            (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id AND status = 'confirmed') as current_participants,
                            'group_winter' as session_type,
                            'natural_slope' as slope_type,
                            CASE WHEN nsu.id IS NOT NULL THEN true ELSE false END as used_subscription,
                            st.name as subscription_name,
                            ns.remaining_sessions as subscription_remaining_sessions,
                            st.sessions_count as subscription_total_sessions
                        FROM session_participants sp
                        JOIN training_sessions ts ON sp.session_id = ts.id
                        LEFT JOIN groups g ON ts.group_id = g.id
                        LEFT JOIN trainers t ON ts.trainer_id = t.id
                        LEFT JOIN children c ON sp.child_id = c.id
                        JOIN clients cl ON sp.client_id = cl.id
                        LEFT JOIN natural_slope_subscription_usage nsu ON nsu.session_participant_id = sp.id
                        LEFT JOIN natural_slope_subscriptions ns ON nsu.subscription_id = ns.id
                        LEFT JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
                        WHERE sp.client_id = $1
                        AND ts.status = 'scheduled'
                        AND sp.status = 'confirmed'
                        AND ts.simulator_id IS NULL
                        AND ts.group_id IS NOT NULL
                        AND (
                          (ts.session_date::timestamp + ts.start_time::interval + (ts.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
                        )
                        ORDER BY ts.session_date, ts.start_time`,
                        [state.data.client_id]
                    );

                    // Получаем индивидуальные тренировки
                    const individualResult = await pool.query(
                        `SELECT 
                            its.id,
                            its.child_id,
                            its.simulator_id,
                            COALESCE(ch.full_name, cl.full_name) as participant_name,
                            CASE 
                                WHEN ch.birth_date IS NOT NULL 
                                THEN (EXTRACT(YEAR FROM AGE(ch.birth_date)) < 18)
                                ELSE false
                            END as is_child,
                            ch.birth_date as participant_birth_date,
                            its.preferred_date as session_date,
                            its.preferred_time as start_time,
                            (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
                            its.duration,
                            its.equipment_type,
                            s.name as simulator_name,
                            NULL as group_name,
                            NULL as trainer_name,
                            NULL as skill_level,
                            its.price,
                            1 as max_participants,
                            1 as current_participants,
                            'individual' as session_type,
                            its.with_trainer
                        FROM individual_training_sessions its
                        JOIN simulators s ON its.simulator_id = s.id
                        LEFT JOIN children ch ON its.child_id = ch.id
                        JOIN clients cl ON its.client_id = cl.id
                        WHERE (its.client_id = $1 OR ch.parent_id = $1)
                        AND (its.preferred_date::timestamp + its.preferred_time::interval + (its.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
                        ORDER BY its.preferred_date, its.preferred_time`,
                        [state.data.client_id]
                    );

                    // Получаем индивидуальные тренировки естественного склона
                    const naturalSlopeIndividualResult = await pool.query(
                        `SELECT 
                            sp.id,
                            sp.session_id,
                            sp.child_id,
                            COALESCE(c.full_name, cl.full_name) as participant_name,
                            CASE 
                                WHEN c.birth_date IS NOT NULL 
                                THEN (EXTRACT(YEAR FROM AGE(c.birth_date)) < 18)
                                ELSE false
                            END as is_child,
                            c.birth_date as participant_birth_date,
                            ts.session_date,
                            ts.start_time,
                            ts.end_time,
                            ts.duration,
                            ts.equipment_type,
                            NULL as simulator_name,
                            NULL as group_name,
                            t.full_name as trainer_name,
                            NULL as skill_level,
                            ts.price,
                            1 as max_participants,
                            1 as current_participants,
                            'individual_natural_slope' as session_type,
                            ts.with_trainer,
                            'natural_slope' as slope_type
                        FROM session_participants sp
                        JOIN training_sessions ts ON sp.session_id = ts.id
                        LEFT JOIN trainers t ON ts.trainer_id = t.id
                        LEFT JOIN children c ON sp.child_id = c.id
                        JOIN clients cl ON sp.client_id = cl.id
                        WHERE sp.client_id = $1
                        AND ts.status = 'scheduled'
                        AND sp.status = 'confirmed'
                        AND ts.training_type = FALSE
                        AND ts.slope_type = 'natural_slope'
                        AND (
                          (ts.session_date::timestamp + ts.start_time::interval + (ts.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
                        )
                        ORDER BY ts.session_date, ts.start_time`,
                        [state.data.client_id]
                    );

                    const groupSessions = groupResult.rows;
                    const winterGroupSessions = winterGroupResult.rows;
                    const individualSessions = individualResult.rows;
                    const naturalSlopeIndividualSessions = naturalSlopeIndividualResult.rows;

                    if (groupSessions.length === 0 && winterGroupSessions.length === 0 && individualSessions.length === 0 && naturalSlopeIndividualSessions.length === 0) {
                        return bot.sendMessage(chatId,
                            'У вас пока нет записей на тренировки.',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 В главное меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Формируем сообщение для каждой записи
                    let message = `📋 *Ваши записи на тренировки:*\n\n`;
                    let allSessions = [];
                    let counter = 1;
                    if (groupSessions.length > 0) {
                        message += '\n👥 *Групповые тренировки (тренажер):*\n';
                        groupSessions.forEach(session => {
                            const date = new Date(session.session_date);
                            const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                            const [hours, minutes] = session.start_time.split(':');
                            const formattedTime = `${hours}:${minutes}`;
                            const participantDisplayName = session.is_child 
                                ? `${session.participant_name} (ребенок)` 
                                : session.participant_name;
                            message += `\n${counter}. 👤 *Участник:* ${participantDisplayName}\n`;
                            message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                            message += `⏰ *Время:* ${formattedTime}\n`;
                            message += `👥 *Группа:* ${session.group_name}\n`;
                            message += `🎿 *Тренажер:* ${session.simulator_name}\n`;
                            if (session.trainer_name) message += `👨‍🏫 *Тренер:* ${session.trainer_name}\n`;
                            if (session.skill_level) message += `📊 *Уровень:* ${session.skill_level}\n`;
                            message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n`;
                            allSessions.push({ ...session, session_type: 'group' });
                            counter++;
                        });
                    }
                    if (winterGroupSessions.length > 0) {
                        // Группируем по location для заголовков
                        const groupedByLocation = {};
                        winterGroupSessions.forEach(session => {
                            const loc = session.location || 'kuliga';
                            if (!groupedByLocation[loc]) {
                                groupedByLocation[loc] = [];
                            }
                            groupedByLocation[loc].push(session);
                        });
                        
                        Object.entries(groupedByLocation).forEach(([loc, sessions]) => {
                            const locationName = getLocationDisplayName(loc);
                            message += `\n👥 *Групповые тренировки (${locationName}):*\n`;
                            sessions.forEach(session => {
                                const date = new Date(session.session_date);
                                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                                const [hours, minutes] = session.start_time.split(':');
                                const formattedTime = `${hours}:${minutes}`;
                                const pricePerPerson = session.max_participants ? (Number(session.price) / session.max_participants).toFixed(2) : Number(session.price).toFixed(2);
                                const participantDisplayName = session.is_child 
                                    ? `${session.participant_name} (ребенок)` 
                                    : session.participant_name;
                                message += `\n${counter}. 👤 *Участник:* ${participantDisplayName}\n`;
                                message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                                message += `⏰ *Время:* ${formattedTime}\n`;
                                message += `👥 *Группа:* ${session.group_name}\n`;
                                if (session.trainer_name) message += `👨‍🏫 *Тренер:* ${session.trainer_name}\n`;
                                if (session.skill_level) message += `📊 *Уровень:* ${session.skill_level}\n`;
                                const sessionLocation = session.location || loc;
                                message += `🏔️ *Место:* ${getLocationDisplayName(sessionLocation)}\n`;
                            if (session.used_subscription) {
                                message += `🎫 *Оплата:* По абонементу "${session.subscription_name}"\n`;
                                if (session.subscription_remaining_sessions != null && session.subscription_total_sessions != null) {
                                    message += `📊 *Занятий осталось:* ${session.subscription_remaining_sessions}/${session.subscription_total_sessions}\n`;
                                }
                            } else {
                                message += `💰 *Стоимость:* ${pricePerPerson} руб.\n`;
                            }
                            allSessions.push({ ...session, session_type: 'group_winter' });
                            counter++;
                            });
                        });
                    }
                    if (individualSessions.length > 0) {
                        message += '\n👤 *Индивидуальные тренировки (тренажер):*\n';
                        individualSessions.forEach(session => {
                            const date = new Date(session.session_date);
                            const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                            const [hours, minutes] = session.start_time.split(':');
                            const formattedTime = `${hours}:${minutes}`;
                            const participantDisplayName = session.is_child 
                                ? `${session.participant_name} (ребенок)` 
                                : session.participant_name;
                            message += `\n${counter}. 👤 *Участник:* ${participantDisplayName}\n`;
                            message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                            message += `⏰ *Время:* ${formattedTime}\n`;
                            message += `🎿 *Снаряжение:* ${session.equipment_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂'}\n`;
                            message += `👨‍🏫 *${session.with_trainer ? 'С тренером' : 'Без тренера'}*\n`;
                            message += `🎿 *Тренажер:* ${session.simulator_name}\n`;
                            message += `⏱ *Длительность:* ${session.duration} мин\n`;
                            message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n`;
                            allSessions.push({ ...session, session_type: 'individual_simulator' });
                            counter++;
                        });
                    }
                    if (naturalSlopeIndividualSessions.length > 0) {
                        // Группируем по location для заголовков
                        const groupedByLocation = {};
                        naturalSlopeIndividualSessions.forEach(session => {
                            const loc = session.location || 'kuliga';
                            if (!groupedByLocation[loc]) {
                                groupedByLocation[loc] = [];
                            }
                            groupedByLocation[loc].push(session);
                        });
                        
                        Object.entries(groupedByLocation).forEach(([loc, sessions]) => {
                            const locationName = getLocationDisplayName(loc);
                            message += `\n🏔️ *Индивидуальные тренировки (${locationName}):*\n`;
                            sessions.forEach(session => {
                                const date = new Date(session.session_date);
                                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                                const [hours, minutes] = session.start_time.split(':');
                                const formattedTime = `${hours}:${minutes}`;
                                const participantDisplayName = session.is_child 
                                    ? `${session.participant_name} (ребенок)` 
                                    : session.participant_name;
                                message += `\n${counter}. 👤 *Участник:* ${participantDisplayName}\n`;
                                message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                                message += `⏰ *Время:* ${formattedTime}\n`;
                                message += `🎿 *Снаряжение:* Горные лыжи 🎿\n`;
                                message += `👨‍🏫 *С тренером*\n`;
                                const sessionLocation = session.location || loc;
                                message += `🏔️ *Место:* ${getLocationDisplayName(sessionLocation)}\n`;
                            message += `⏱ *Длительность:* ${session.duration} мин\n`;
                            message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n`;
                            allSessions.push({ ...session, session_type: 'individual_natural_slope' });
                            counter++;
                            });
                        });
                    }
                    message += '\nДля отмены тренировки нажмите "Отменить тренировку"';
                    // Сохраняем оба списка в состоянии
                    userStates.set(chatId, { 
                        step: 'view_sessions', 
                        data: { 
                            client_id: state.data.client_id,
                            sessions: allSessions 
                        } 
                    });
                    await bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['❌ Отменить тренировку'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при получении записей:', error);
                    await bot.sendMessage(chatId, 'Произошла ошибка при получении записей. Пожалуйста, попробуйте позже.', {
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    });
                }
            }
            // ... existing code ...
        }
        case 'view_sessions': {
            if (msg.text === '❌ Отменить тренировку') {
                if (!state.data.sessions || state.data.sessions.length === 0) {
                    return bot.sendMessage(chatId,
                        'У вас нет активных записей на тренировки.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                // Формируем список тренировок для отмены
                let message = 'Выберите тренировку для отмены:\n\n';
                state.data.sessions.forEach((session, index) => {
                    // Для kuliga тренировок используется поле 'date', для остальных 'session_date'
                    const dateStr = session.date || session.session_date;
                    if (!dateStr) {
                        console.error('Ошибка: дата не найдена в сессии', session);
                        return;
                    }
                    
                    const date = new Date(dateStr);
                    if (isNaN(date.getTime())) {
                        console.error('Ошибка: некорректная дата', dateStr);
                        return;
                    }
                    
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    
                    // Для kuliga тренировок используется поле 'start_time', для остальных тоже 'start_time'
                    const timeStr = session.start_time || '';
                    const [hours, minutes] = timeStr ? timeStr.split(':') : ['', ''];
                    const formattedTime = hours && minutes ? `${hours}:${minutes}` : '';

                    const participantName = session.participant_name || 'Участник';
                    message += `${index + 1}. ${participantName} - ${formattedDate} (${dayOfWeek})${formattedTime ? ' ' + formattedTime : ''}\n`;
                });

                state.step = 'cancel_training_selection';
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    reply_markup: {
                        keyboard: [
                            ...state.data.sessions.map((_, i) => [`${i + 1}`]),
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                });
            } else if (msg.text === '🔙 В главное меню') {
                state.step = 'main_menu';
                userStates.set(chatId, state);
                return showMainMenu(chatId);
            }
            break;
        }

        case 'cancel_training_selection': {
            if (msg.text === '🔙 Назад') {
                state.step = 'view_sessions';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId, 'Выберите действие:', {
                    reply_markup: {
                        keyboard: [
                            ['❌ Отменить тренировку'],
                            ['🔙 В главное меню']
                        ],
                        resize_keyboard: true
                    }
                });
            }

            const selectedIndex = parseInt(msg.text) - 1;
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.data.sessions.length) {
                return bot.sendMessage(chatId, 'Пожалуйста, выберите номер тренировки из списка.');
            }

            const selectedSession = state.data.sessions[selectedIndex];
            try {
                if (selectedSession.session_type === 'group') {
                    // Получаем данные участника
                    const participantRes = await pool.query(
                        `SELECT sp.child_id, sp.client_id, c.full_name as client_name, c.phone as client_phone, ch.full_name as child_name
                         FROM session_participants sp
                         LEFT JOIN clients c ON sp.client_id = c.id
                         LEFT JOIN children ch ON sp.child_id = ch.id
                         WHERE sp.id = $1`,
                        [selectedSession.id]
                    );
                    const participant = participantRes.rows[0];

                    // Получаем данные о тренировке
                    const groupInfoRes = await pool.query(
                        `SELECT ts.session_date, ts.start_time, ts.group_id, ts.trainer_id, ts.simulator_id, ts.price, ts.max_participants,
                                g.name as group_name, t.full_name as trainer_name, s.name as simulator_name
                         FROM training_sessions ts
                         LEFT JOIN groups g ON ts.group_id = g.id
                         LEFT JOIN trainers t ON ts.trainer_id = t.id
                         LEFT JOIN simulators s ON ts.simulator_id = s.id
                         WHERE ts.id = $1`,
                        [selectedSession.session_id]
                    );
                    const groupInfo = groupInfoRes.rows[0];

                    // Считаем сколько мест осталось после удаления (ТОЛЬКО подтвержденные участники!)
                    const seatsRes = await pool.query(
                        'SELECT COUNT(*) FROM session_participants WHERE session_id = $1 AND status = $2',
                        [selectedSession.session_id, 'confirmed']
                    );
                    const currentParticipants = parseInt(seatsRes.rows[0].count) - 1;
                    const maxParticipants = groupInfo.max_participants;
                    const seatsLeft = `${currentParticipants}/${maxParticipants}`;

                    // Формируем participant_name только если есть child_id
                    const participantName = participant.child_id ? participant.child_name : null;

                    // Уведомляем админа
                    await notifyAdminGroupTrainingCancellation({
                        client_name: participant.client_name,
                        participant_name: participantName,
                        client_phone: participant.client_phone,
                        date: groupInfo.session_date,
                        time: groupInfo.start_time,
                        group_name: groupInfo.group_name,
                        trainer_name: groupInfo.trainer_name,
                        simulator_name: groupInfo.simulator_name,
                        seats_left: seatsLeft,
                        refund: selectedSession.price
                    });

                    // Вместо удаления меняем статус на 'cancelled'
                    await pool.query('UPDATE session_participants SET status = $1 WHERE id = $2', ['cancelled', selectedSession.id]);

                    // Проверяем, остались ли еще участники в группе (только с подтвержденным статусом)
                    const remainingParticipants = await pool.query(
                        'SELECT COUNT(*) FROM session_participants WHERE session_id = $1 AND status = $2',
                        [selectedSession.session_id, 'confirmed']
                    );

                    // Возвращаем средства
                    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE client_id = $2', [selectedSession.price, state.data.client_id]);

                    // Получаем id кошелька
                    const walletRes = await pool.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                    const walletId = walletRes.rows[0]?.id;
                    if (walletId) {
                        // Форматируем дату и время для описания
                        const date = new Date(selectedSession.session_date);
                        const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                        const [hours, minutes] = selectedSession.start_time.split(':');
                        const formattedTime = `${hours}:${minutes}`;
                        
                        // Создаем запись о возврате с тем же форматом, что и оплата
                        await pool.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [
                                walletId,
                                selectedSession.price,
                                'amount',
                                `Группа: ${groupInfo.group_name}, ${selectedSession.participant_name}, Дата: ${formattedDate}, Время: ${formattedTime}, Длительность: ${selectedSession.duration} мин.`
                            ]
                        );
                    }
                    // Форматируем дату для сообщения клиенту
                    const date = new Date(selectedSession.session_date);
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const [hours, minutes] = selectedSession.start_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    // Сообщение для клиента
                    const clientMessage = 
                        '✅ *Тренировка успешно отменена!*\n\n' +
                        `👤 *Участник:* ${selectedSession.participant_name}\n` +
                        `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n` +
                        `⏰ *Время:* ${formattedTime}\n` +
                        `💰 *Возвращено:* ${Number(selectedSession.price).toFixed(2)} руб.\n\n` +
                        'Средства возвращены на ваш баланс.';

                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, clientMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['📋 Мои записи'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } else if (selectedSession.session_type === 'individual_simulator') {
                    // --- отмена индивидуальной тренировки ---
                    const date = new Date(selectedSession.session_date);
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const [hours, minutes] = selectedSession.start_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    // Получаем данные клиента
                    const clientRes = await pool.query(
                        `SELECT c.*, 
                            EXTRACT(YEAR FROM AGE(CURRENT_DATE, c.birth_date)) as age
                        FROM clients c
                        WHERE c.id = $1`,
                        [state.data.client_id]
                    );
                    const client = clientRes.rows[0];

                    // Освобождаем слоты в расписании
                    let endTime = selectedSession.end_time;
                    if (!endTime) {
                        // Вычисляем время окончания: start_time + duration минут
                        const startTime = selectedSession.start_time;
                        const duration = selectedSession.duration || 30;
                        const [hours, minutes] = startTime.split(':').map(Number);
                        const startMinutes = hours * 60 + minutes;
                        const endMinutes = startMinutes + duration;
                        const endHours = Math.floor(endMinutes / 60);
                        const endMins = endMinutes % 60;
                        endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;
                    }
                    
                    await pool.query(
                        `UPDATE schedule 
                         SET is_booked = false 
                         WHERE simulator_id = $1 
                         AND date = $2 
                         AND start_time >= $3 
                         AND start_time < $4`,
                        [
                            selectedSession.simulator_id,
                            selectedSession.session_date,
                            selectedSession.start_time,
                            endTime
                        ]
                    );

                    // Удаляем тренировку и возвращаем средства
                    await pool.query('DELETE FROM individual_training_sessions WHERE id = $1', [selectedSession.id]);
                    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE client_id = $2', [selectedSession.price, state.data.client_id]);
                    // Получаем id кошелька
                    const walletRes = await pool.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                    const walletId = walletRes.rows[0]?.id;
                    if (walletId) {
                        // Запись в transactions для индивидуальной
                        await pool.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [walletId, selectedSession.price, 'amount', `Возврат: Индивидуальная, ${selectedSession.participant_name}, Дата: ${formattedDate}, Время: ${formattedTime}, Длительность: ${selectedSession.duration} мин.`]
                        );
                    }

                    // Отправляем уведомление администратору
                    await notifyAdminIndividualTrainingCancellation({
                        client_name: client.full_name,
                        participant_name: selectedSession.participant_name,
                        participant_age: Math.floor(client.age),
                        client_phone: client.phone,
                        date: selectedSession.session_date,
                        time: selectedSession.start_time,
                        trainer_name: selectedSession.with_trainer ? 'С тренером' : 'Без тренера',
                        price: selectedSession.price
                    });

                    const clientMessage =
                        '✅ *Тренировка успешно отменена!*\n\n' +
                        `👤 *Участник:* ${selectedSession.participant_name}\n` +
                        `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n` +
                        `⏰ *Время:* ${formattedTime}\n` +
                        `💰 *Возвращено:* ${Number(selectedSession.price).toFixed(2)} руб.\n\n` +
                        'Средства возвращены на ваш баланс.';
                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, clientMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['📋 Мои записи'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } else if (selectedSession.session_type === 'group_winter') {
                    // --- отмена зимней групповой тренировки ---
                    const date = new Date(selectedSession.session_date);
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const [hours, minutes] = selectedSession.start_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    // Получаем информацию о тренировке
                    const groupInfoRes = await pool.query(
                        `SELECT ts.*, g.name as group_name, t.full_name as trainer_name
                         FROM training_sessions ts
                         LEFT JOIN groups g ON ts.group_id = g.id
                         LEFT JOIN trainers t ON ts.trainer_id = t.id
                         WHERE ts.id = $1`,
                        [selectedSession.session_id]
                    );
                    const groupInfo = groupInfoRes.rows[0];

                    // Получаем информацию об участнике
                    const participantRes = await pool.query(
                        `SELECT sp.*, 
                            COALESCE(ch.full_name, c.full_name) as participant_name,
                            c.full_name as client_name,
                            c.phone as client_phone,
                            ch.id as child_id,
                            ch.full_name as child_name
                         FROM session_participants sp
                         JOIN clients c ON sp.client_id = c.id
                         LEFT JOIN children ch ON sp.child_id = ch.id
                         WHERE sp.id = $1`,
                        [selectedSession.id]
                    );
                    const participant = participantRes.rows[0];

                    // Рассчитываем цену за одного участника
                    const pricePerPerson = groupInfo.max_participants 
                        ? (Number(groupInfo.price) / groupInfo.max_participants)
                        : Number(groupInfo.price);

                    // Подсчитываем оставшихся участников
                    const seatsRes = await pool.query(
                        'SELECT COUNT(*) FROM session_participants WHERE session_id = $1 AND status = $2',
                        [selectedSession.session_id, 'confirmed']
                    );
                    const currentParticipants = parseInt(seatsRes.rows[0].count) - 1;
                    const maxParticipants = groupInfo.max_participants;
                    const seatsLeft = `${currentParticipants}/${maxParticipants}`;

                    // Формируем participant_name только если есть child_id
                    const participantName = participant.child_id ? participant.child_name : null;

                    // Проверяем, использовался ли абонемент (нужно до уведомления админу)
                    const subscriptionUsageCheckBefore = await pool.query(
                        `SELECT 
                            nsu.*,
                            st.name as subscription_name
                         FROM natural_slope_subscription_usage nsu
                         JOIN natural_slope_subscriptions ns ON nsu.subscription_id = ns.id
                         JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
                         WHERE nsu.training_session_id = $1`,
                        [selectedSession.session_id]
                    );

                    // Уведомляем админа об отмене групповой зимней тренировки
                    try {
                        const { notifyAdminGroupTrainingCancellation } = require('./admin-notify');
                        await notifyAdminGroupTrainingCancellation({
                            client_name: participant.client_name,
                            participant_name: participantName,
                            client_phone: participant.client_phone,
                            date: groupInfo.session_date,
                            time: groupInfo.start_time,
                            group_name: groupInfo.group_name,
                            trainer_name: groupInfo.trainer_name,
                            simulator_name: null, // Групповые зимние тренировки не на тренажере
                            seats_left: seatsLeft,
                            refund: pricePerPerson,
                            used_subscription: subscriptionUsageCheckBefore.rows.length > 0
                        });
                    } catch (error) {
                        console.error('Ошибка при отправке уведомления администратору об отмене групповой зимней тренировки:', error);
                    }

                    // Вместо удаления меняем статус на 'cancelled'
                    await pool.query('UPDATE session_participants SET status = $1 WHERE id = $2', ['cancelled', selectedSession.id]);

                    // Освобождаем слот в winter_schedule если все участники отменили
                    // Проверяем, есть ли запись в winter_schedule для этой тренировки
                    const remainingCheck = await pool.query(
                        'SELECT COUNT(*) FROM session_participants WHERE session_id = $1 AND status = $2',
                        [selectedSession.session_id, 'confirmed']
                    );
                    if (parseInt(remainingCheck.rows[0].count) === 0) {
                        // Проверяем, есть ли запись в winter_schedule для этого времени
                        const timeSlot = String(selectedSession.start_time).substring(0, 5);
                        const slotCheck = await pool.query(
                            `SELECT id, is_group_training FROM winter_schedule 
                             WHERE date = $1 AND time_slot = $2::time LIMIT 1`,
                            [selectedSession.session_date, timeSlot]
                        );
                        
                        // Если есть запись в winter_schedule и это групповая тренировка
                        if (slotCheck.rows.length > 0 && slotCheck.rows[0].is_group_training) {
                            // Правильно обновляем: при is_group_training = false должно быть is_individual_training = true
                            await pool.query(
                                `UPDATE winter_schedule 
                                 SET is_available = true, 
                                     current_participants = 0,
                                     is_group_training = false,
                                     is_individual_training = true,
                                     group_id = NULL,
                                     trainer_id = NULL,
                                     max_participants = 1,
                                     updated_at = NOW()
                                 WHERE id = $1`,
                                [slotCheck.rows[0].id]
                            );
                        }
                    }

                    // Проверяем, использовался ли абонемент для этого конкретного участника
                    const subscriptionUsageCheck = await pool.query(
                        `SELECT 
                            nsu.*,
                            ns.remaining_sessions,
                            ns.status as subscription_status,
                            st.name as subscription_name,
                            st.sessions_count as total_sessions
                         FROM natural_slope_subscription_usage nsu
                         JOIN natural_slope_subscriptions ns ON nsu.subscription_id = ns.id
                         JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
                         WHERE nsu.session_participant_id = $1
                         AND ns.client_id = $2`,
                        [selectedSession.id, state.data.client_id]
                    );

                    let refundMessage = '';
                    let returnedSubscription = null;

                    if (subscriptionUsageCheck.rows.length > 0) {
                        // Использовался абонемент - возвращаем занятие
                        const subscriptionUsage = subscriptionUsageCheck.rows[0];
                        
                        // Возвращаем занятие в абонемент
                        await pool.query(
                            `UPDATE natural_slope_subscriptions 
                             SET remaining_sessions = remaining_sessions + 1,
                                 status = CASE 
                                    WHEN expires_at >= CURRENT_DATE THEN 'active'
                                    ELSE status
                                 END
                             WHERE id = $1`,
                            [subscriptionUsage.subscription_id]
                        );

                        // Удаляем запись использования
                        await pool.query(
                            `DELETE FROM natural_slope_subscription_usage 
                             WHERE id = $1`,
                            [subscriptionUsage.id]
                        );

                        returnedSubscription = {
                            name: subscriptionUsage.subscription_name,
                            remaining: subscriptionUsage.remaining_sessions + 1,
                            total: subscriptionUsage.total_sessions
                        };

                        refundMessage = `🎫 *Абонемент:* Занятие возвращено в "${returnedSubscription.name}"\n` +
                            `📊 *Занятий осталось:* ${returnedSubscription.remaining}/${returnedSubscription.total}\n`;
                        
                        // Создаем транзакцию для отчетности при возврате занятия в абонемент
                        const walletRes = await pool.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                        const walletId = walletRes.rows[0]?.id;
                        if (walletId) {
                            // Создаем запись о возврате занятия в абонемент
                            await pool.query(
                                'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                                [
                                    walletId,
                                    0,
                                    'subscription_return',
                                    `Возврат занятия в абонемент: Группа ${getLocationDisplayName(selectedSession.location || groupInfo?.location || 'kuliga')}: ${groupInfo.group_name}, ${selectedSession.participant_name}, Дата: ${formattedDate}, Время: ${formattedTime}, Длительность: ${selectedSession.duration} мин. Занятий осталось: ${returnedSubscription.remaining}/${returnedSubscription.total}`
                                ]
                            );
                        }
                        
                        console.log(`✅ Возвращено занятие в абонемент ID ${subscriptionUsage.subscription_id} для клиента ${state.data.client_id}`);
                    } else {
                        // Не использовался абонемент - возвращаем деньги
                        await pool.query('UPDATE wallets SET balance = balance + $1 WHERE client_id = $2', [pricePerPerson, state.data.client_id]);

                        // Получаем id кошелька
                        const walletRes = await pool.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                        const walletId = walletRes.rows[0]?.id;
                        if (walletId) {
                            // Создаем запись о возврате
                            await pool.query(
                                'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                                [
                                    walletId,
                                    pricePerPerson,
                                    'amount',
                                    `Возврат: Группа ${getLocationDisplayName(selectedSession.location || groupInfo?.location || 'kuliga')}: ${groupInfo.group_name}, ${selectedSession.participant_name}, Дата: ${formattedDate}, Время: ${formattedTime}, Длительность: ${selectedSession.duration} мин.`
                                ]
                            );
                        }

                        refundMessage = `💰 *Возвращено:* ${pricePerPerson.toFixed(2)} руб.\n`;
                    }

                    // Сообщение для клиента
                    const location = selectedSession.location || groupInfo?.location || 'kuliga';
                    const locationName = getLocationDisplayName(location);
                    const clientMessage = 
                        `✅ *Тренировка в ${locationName} успешно отменена!*\n\n` +
                        `👤 *Участник:* ${selectedSession.participant_name}\n` +
                        `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n` +
                        `⏰ *Время:* ${formattedTime}\n` +
                        `👥 *Группа:* ${groupInfo.group_name}\n` +
                        `🏔️ *Место:* ${locationName}\n` +
                        refundMessage +
                        '\n' + (returnedSubscription ? 'Занятие возвращено в абонемент.' : 'Средства возвращены на ваш баланс.');

                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, clientMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['📋 Мои записи'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } else if (selectedSession.session_type === 'individual_natural_slope') {
                    // --- отмена индивидуальной тренировки естественного склона ---
                    const date = new Date(selectedSession.session_date);
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const [hours, minutes] = selectedSession.start_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    // Получаем данные клиента
                    const clientRes = await pool.query(
                        `SELECT c.*, 
                            EXTRACT(YEAR FROM AGE(CURRENT_DATE, c.birth_date)) as age
                        FROM clients c
                        WHERE c.id = $1`,
                        [state.data.client_id]
                    );
                    const client = clientRes.rows[0];

                    // Уведомляем админа
                    await notifyAdminNaturalSlopeTrainingCancellation({
                        client_name: client.full_name,
                        participant_name: selectedSession.participant_name,
                        client_phone: client.phone,
                        date: selectedSession.session_date,
                        time: selectedSession.start_time,
                        trainer_name: selectedSession.trainer_name,
                        refund: selectedSession.price
                    });

                    // Освобождаем слот в winter_schedule
                    await pool.query(
                        `UPDATE winter_schedule 
                         SET is_available = true, current_participants = 0
                         WHERE date = $1 
                         AND time_slot = $2 
                         AND is_individual_training = true`,
                        [selectedSession.session_date, selectedSession.start_time]
                    );

                    // Удаляем участника из session_participants
                    await pool.query('DELETE FROM session_participants WHERE id = $1', [selectedSession.id]);
                    
                    // Удаляем саму тренировку из training_sessions
                    await pool.query('DELETE FROM training_sessions WHERE id = $1', [selectedSession.session_id]);

                    // Возвращаем средства
                    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE client_id = $2', [selectedSession.price, state.data.client_id]);

                    // Получаем id кошелька
                    const walletRes = await pool.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                    const walletId = walletRes.rows[0]?.id;
                    if (walletId) {
                        // Запись в transactions для естественного склона
                        await pool.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [walletId, selectedSession.price, 'amount', `Возврат: Индивидуальная тренировка на естественном склоне, ${selectedSession.participant_name}, Дата: ${formattedDate}, Время: ${formattedTime}, Длительность: ${selectedSession.duration} мин.`]
                        );
                    }

                    // Сообщение для клиента
                    const location = selectedSession.location || 'kuliga';
                    const locationName = getLocationDisplayName(location);
                    const clientMessage = 
                        `✅ *Тренировка в ${locationName} успешно отменена!*\n\n` +
                        `👤 *Участник:* ${selectedSession.participant_name}\n` +
                        `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n` +
                        `⏰ *Время:* ${formattedTime}\n` +
                        `🏔️ *Место:* ${locationName}\n` +
                        `💰 *Возвращено:* ${Number(selectedSession.price).toFixed(2)} руб.\n\n` +
                        'Средства возвращены на ваш баланс.';

                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, clientMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['📋 Мои записи'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } else if (selectedSession.session_type === 'kuliga_individual') {
                    // --- отмена индивидуальной тренировки Кулиги ---
                    const date = new Date(selectedSession.date);
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const [hours, minutes] = selectedSession.start_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    // МИГРАЦИЯ 033: Получаем данные клиента из clients (не kuliga_clients)
                    const kuligaClientRes = await pool.query(
                        'SELECT * FROM clients WHERE telegram_id = $1',
                        [chatId.toString()]
                    );
                    const kuligaClient = kuligaClientRes.rows[0];

                    if (!kuligaClient) {
                        return bot.sendMessage(chatId, 'Ошибка: клиент не найден.', {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        });
                    }

                    // Получаем информацию о бронировании
                    const bookingRes = await pool.query(
                        `SELECT kb.*, ki.telegram_id as instructor_telegram_id, ki.full_name as instructor_name, ki.admin_percentage 
                         FROM kuliga_bookings kb
                         LEFT JOIN kuliga_instructors ki ON kb.instructor_id = ki.id
                         WHERE kb.id = $1`,
                        [selectedSession.id]
                    );
                    const booking = bookingRes.rows[0];

                    if (!booking) {
                        return bot.sendMessage(chatId, 'Ошибка: бронирование не найдено.', {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        });
                    }

                    // Уведомляем админа
                    await notifyAdminNaturalSlopeTrainingCancellation({
                        client_name: kuligaClient.full_name,
                        participant_name: selectedSession.participant_name,
                        client_phone: kuligaClient.phone,
                        date: selectedSession.date,
                        time: selectedSession.start_time,
                        trainer_name: booking.instructor_name || 'Не указан',
                        refund: selectedSession.price_total
                    });

                    // Уведомляем инструктора об отмене
                    if (booking.instructor_telegram_id) {
                        try {
                            const { notifyInstructorKuligaTrainingCancellation } = require('./admin-notify');
                            await notifyInstructorKuligaTrainingCancellation({
                                participant_name: selectedSession.participant_name,
                                client_name: kuligaClient.full_name,
                                client_phone: kuligaClient.phone,
                                date: selectedSession.date,
                                time: selectedSession.start_time,
                                instructor_name: booking.instructor_name,
                                instructor_telegram_id: booking.instructor_telegram_id
                            });
                        } catch (error) {
                            console.error('Ошибка при уведомлении инструктора об отмене:', error);
                        }
                    }

                    // Освобождаем слот в kuliga_schedule_slots
                    if (selectedSession.slot_id) {
                        await pool.query(
                            'UPDATE kuliga_schedule_slots SET status = $1 WHERE id = $2',
                            ['available', selectedSession.slot_id]
                        );
                    }

                    // Обновляем статус бронирования
                    await pool.query(
                        'UPDATE kuliga_bookings SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
                        ['cancelled', selectedSession.id]
                    );

                    // Возвращаем средства на баланс кошелька
                    await pool.query(
                        'UPDATE wallets SET balance = balance + $1 WHERE client_id = $2',
                        [selectedSession.price_total, kuligaClient.id]
                    );

                    // Получаем id кошелька и создаем транзакцию
                    const walletRes = await pool.query('SELECT id FROM wallets WHERE client_id = $1', [kuligaClient.id]);
                    const walletId = walletRes.rows[0]?.id;
                    if (walletId) {
                        await pool.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [
                                walletId,
                                selectedSession.price_total,
                                'amount',
                                `Возврат: Индивидуальная тренировка Кулига, ${selectedSession.participant_name}, Дата: ${formattedDate}, Время: ${formattedTime}`
                            ]
                        );
                    }

                    // Сообщение для клиента
                    const location = selectedSession.location || 'kuliga';
                    const locationName = getLocationDisplayName(location);
                    const clientMessage = 
                        `✅ *Тренировка в ${locationName} успешно отменена!*\n\n` +
                        `👤 *Участник:* ${selectedSession.participant_name}\n` +
                        `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n` +
                        `⏰ *Время:* ${formattedTime}\n` +
                        `🏔️ *Место:* ${locationName}\n` +
                        `💰 *Возвращено:* ${Number(selectedSession.price_total).toFixed(2)} руб.\n\n` +
                        'Средства возвращены на ваш баланс.';

                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, clientMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['📋 Мои записи'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } else if (selectedSession.session_type === 'kuliga_group') {
                    // --- отмена групповой тренировки Кулиги ---
                    const date = new Date(selectedSession.date);
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const [hours, minutes] = selectedSession.start_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    // МИГРАЦИЯ 033: Получаем данные клиента из clients (не kuliga_clients)
                    const kuligaClientRes = await pool.query(
                        'SELECT * FROM clients WHERE telegram_id = $1',
                        [chatId.toString()]
                    );
                    const kuligaClient = kuligaClientRes.rows[0];

                    if (!kuligaClient) {
                        return bot.sendMessage(chatId, 'Ошибка: клиент не найден.', {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        });
                    }

                    // Получаем информацию о групповой тренировке с данными инструктора
                    const groupTrainingRes = await pool.query(
                        `SELECT kgt.*, ki.telegram_id as instructor_telegram_id, ki.full_name as instructor_name, ki.admin_percentage 
                         FROM kuliga_group_trainings kgt
                         LEFT JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
                         WHERE kgt.id = $1`,
                        [selectedSession.group_training_id]
                    );
                    const groupTraining = groupTrainingRes.rows[0];

                    if (!groupTraining) {
                        return bot.sendMessage(chatId, 'Ошибка: групповая тренировка не найдена.', {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        });
                    }

                    // Формируем список всех участников для уведомлений
                    const participantsList = selectedSession.participants_names && Array.isArray(selectedSession.participants_names)
                        ? selectedSession.participants_names.join(', ')
                        : selectedSession.participant_name || 'Участник';
                    const participantsCount = selectedSession.participants_count || 1;

                    // Уведомляем инструктора об отмене
                    if (groupTraining.instructor_telegram_id) {
                        try {
                            const { notifyInstructorKuligaTrainingCancellation } = require('./admin-notify');
                            await notifyInstructorKuligaTrainingCancellation({
                                participant_name: participantsList,
                                client_name: kuligaClient.full_name,
                                client_phone: kuligaClient.phone,
                                date: selectedSession.date,
                                time: selectedSession.start_time,
                                instructor_name: groupTraining.instructor_name,
                                instructor_telegram_id: groupTraining.instructor_telegram_id
                            });
                        } catch (error) {
                            console.error('Ошибка при уведомлении инструктора об отмене:', error);
                        }
                    }

                    // Обновляем статус бронирования ПЕРЕД пересчетом участников
                    await pool.query(
                        'UPDATE kuliga_bookings SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2',
                        ['cancelled', selectedSession.id]
                    );

                    // Пересчитываем количество участников на основе активных бронирований (более надежно, чем просто уменьшать на 1)
                    const participantsCountRes = await pool.query(
                        `SELECT COALESCE(SUM(participants_count), 0) as total_participants
                         FROM kuliga_bookings
                         WHERE group_training_id = $1 AND status = 'confirmed'`,
                        [selectedSession.group_training_id]
                    );
                    const remainingParticipants = parseInt(participantsCountRes.rows[0].total_participants || 0);

                    // Получаем информацию о групповой тренировке (включая is_private)
                    const trainingInfoRes = await pool.query(
                        `SELECT slot_id, is_private, current_participants 
                         FROM kuliga_group_trainings 
                         WHERE id = $1`,
                        [selectedSession.group_training_id]
                    );
                    const trainingInfo = trainingInfoRes.rows[0];
                    
                    if (!trainingInfo) {
                        console.error(`❌ Групповая тренировка ${selectedSession.group_training_id} не найдена`);
                    } else {
                        // Обновляем количество участников в групповой тренировке
                        const updatedTrainingRes = await pool.query(
                            `UPDATE kuliga_group_trainings 
                             SET current_participants = $1, updated_at = CURRENT_TIMESTAMP 
                             WHERE id = $2 
                             RETURNING slot_id, current_participants, is_private`,
                            [remainingParticipants, selectedSession.group_training_id]
                        );
                        const updatedTraining = updatedTrainingRes.rows[0];

                        // Если это приватная тренировка (is_private = TRUE) "У меня своя группа",
                        // освобождаем слот при отмене, независимо от количества участников
                        // потому что к приватной тренировке нельзя добавляться
                        if (updatedTraining && updatedTraining.is_private && updatedTraining.slot_id) {
                            await pool.query(
                                'UPDATE kuliga_schedule_slots SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                                ['available', updatedTraining.slot_id]
                            );
                            console.log(`✅ Слот ${updatedTraining.slot_id} освобожден (приватная тренировка отменена)`);
                            
                            // Также обновляем статус групповой тренировки на 'cancelled'
                            await pool.query(
                                `UPDATE kuliga_group_trainings 
                                 SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
                                 WHERE id = $1`,
                                [selectedSession.group_training_id]
                            );
                        } else if (remainingParticipants <= 0 && updatedTraining && updatedTraining.slot_id) {
                            // Для не-приватных тренировок: если участников не осталось, освобождаем слот
                            await pool.query(
                                'UPDATE kuliga_schedule_slots SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                                ['available', updatedTraining.slot_id]
                            );
                            console.log(`✅ Слот ${updatedTraining.slot_id} освобожден, участников не осталось`);
                        } else if (updatedTraining && updatedTraining.slot_id) {
                            console.log(`ℹ️ Слот ${updatedTraining.slot_id} остается занятым, участников осталось: ${remainingParticipants}`);
                        }
                    }

                    // ВАЖНО: Возвращаем price_total (общую стоимость), а не price_per_person
                    const refundAmount = Number(selectedSession.price_total || selectedSession.price_per_person || 0);
                    
                    // Возвращаем средства на баланс кошелька
                    await pool.query(
                        'UPDATE wallets SET balance = balance + $1 WHERE client_id = $2',
                        [refundAmount, kuligaClient.id]
                    );

                    // Получаем id кошелька и создаем транзакцию
                    const walletRes = await pool.query('SELECT id FROM wallets WHERE client_id = $1', [kuligaClient.id]);
                    const walletId = walletRes.rows[0]?.id;
                    
                    if (walletId) {
                        await pool.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [
                                walletId,
                                refundAmount,
                                'amount',
                                `Возврат: Групповая тренировка Кулига (${participantsCount} участников), Дата: ${formattedDate}, Время: ${formattedTime}`
                            ]
                        );
                    }

                    // Уведомляем администратора об отмене
                    setImmediate(async () => {
                        try {
                            const { notifyAdminNaturalSlopeTrainingCancellation } = require('./admin-notify');
                            await notifyAdminNaturalSlopeTrainingCancellation({
                                client_name: kuligaClient.full_name,
                                client_phone: kuligaClient.phone,
                                participant_name: participantsList,
                                participants_count: participantsCount,
                                date: selectedSession.date,
                                time: formattedTime,
                                instructor_name: groupTraining.instructor_name || 'Не указан',
                                booking_type: 'group',
                                refund: refundAmount,
                                sport_type: selectedSession.sport_type === 'ski' ? 'лыжи' : 'сноуборд'
                            });
                        } catch (error) {
                            console.error('Ошибка при уведомлении администратора об отмене:', error);
                        }
                    });

                    // Сообщение для клиента
                    const location = selectedSession.location || groupInfo?.location || 'kuliga';
                    const locationName = getLocationDisplayName(location);
                    const clientMessage = 
                        `✅ *Групповая тренировка в ${locationName} успешно отменена!*\n\n` +
                        `👤 *Участники (${participantsCount}):* ${participantsList}\n` +
                        `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n` +
                        `⏰ *Время:* ${formattedTime}\n` +
                        `🏔️ *Место:* ${locationName}\n` +
                        `💰 *Возвращено:* ${refundAmount.toFixed(2)} руб.\n\n` +
                        'Средства возвращены на ваш баланс.';

                    userStates.delete(chatId);
                    return bot.sendMessage(chatId, clientMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['📋 Мои записи'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                }
            } catch (error) {
                console.error('Ошибка при отмене тренировки:', error);
                return bot.sendMessage(chatId,
                    'Произошла ошибка при отмене тренировки. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }
        case 'add_child_name': {
            if (msg.text === '🔙 Отмена') {
                userStates.delete(chatId);
                return showPersonalCabinet(chatId);
            }

            if (msg.text.length < 2) {
                return bot.sendMessage(chatId,
                    '❌ Имя должно содержать минимум 2 символа. Пожалуйста, попробуйте еще раз.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Отмена']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Если это регистрация нового клиента, сохраняем в объекте child
            if (state.data.child) {
                state.data.child.full_name = msg.text;
            }
            
            userStates.set(chatId, {
                step: 'add_child_birth_date',
                data: { ...state.data, child_name: msg.text }
            });

            return bot.sendMessage(chatId,
                '📅 *Введите дату рождения в формате ДД.ММ.ГГГГ:*\n\n' +
                'Например: 01.01.2015',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Отмена']],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'add_child_birth_date': {
            if (msg.text === '🔙 Отмена') {
                userStates.delete(chatId);
                return showPersonalCabinet(chatId);
            }

            const birthDate = validateDate(msg.text);
            if (!birthDate) {
                return bot.sendMessage(chatId,
                    '❌ Неверный формат даты. Пожалуйста, используйте формат ДД.ММ.ГГГГ\n' +
                    'Например: 01.01.2015',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Отмена']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Если это регистрация нового клиента, сохраняем дату в объекте child и переходим к согласию
            if (state.data.child) {
                state.data.child.birth_date = birthDate;
                // Переходим к шагу согласия на обработку персональных данных
                userStates.set(chatId, {
                    step: 'privacy_consent',
                    data: state.data
                });
                await showPrivacyConsent(chatId, state.data);
                return;
            }

            // Если это добавление ребенка через личный кабинет, используем существующую логику
            try {
                await pool.query(
                    'INSERT INTO children (parent_id, full_name, birth_date, sport_type, skill_level) VALUES ($1, $2, $3, $4, $5)',
                    [state.data.client_id, state.data.child_name, birthDate, 'ski', 1]
                );

                userStates.delete(chatId);
                await bot.sendMessage(chatId,
                    '✅ *Человек успешно добавлен!*',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    }
                );
                return showPersonalCabinet(chatId);
            } catch (error) {
                console.error('Ошибка при добавлении человека:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при добавлении человека. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }

        case 'privacy_consent': {
            // Этот case обрабатывается через callback_query, а не через текстовые сообщения
            break;
        }

        case 'training_type': {
            if (msg.text === '👥 Групповая') {
                // Если есть дети, предлагаем выбрать для кого тренировка
                if (state.data.children && state.data.children.length > 0) {
                    let message = '👤 *Для кого тренировка?*\n\n';
                    message += '1. Для себя\n';
                    state.data.children.forEach((child, index) => {
                        message += `${index + 2}. Для ребенка: ${child.full_name}\n`;
                    });

                    userStates.set(chatId, {
                        step: 'group_training_for',
                        data: { ...state.data }
                    });

                    return bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['1. Для себя'],
                                ...state.data.children.map(child => [`Для ребенка: ${child.full_name}`]),
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } else {
                    // Если детей нет, сразу для себя
                    userStates.set(chatId, {
                        step: 'group_equipment_type',
                        data: { 
                            ...state.data,
                            is_child: false
                        }
                    });

                    return bot.sendMessage(chatId,
                        '🎿 *Выберите тип снаряжения:*\n\n' +
                        '• 🎿 Горные лыжи\n' +
                        '• 🏂 Сноуборд',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['🎿 Горные лыжи'],
                                    ['🏂 Сноуборд'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            } else if (msg.text === '👤 Индивидуальная') {
                // Для индивидуальной тренировки используем существующую функцию
                return askIndividualForWhom(chatId, state.data.client_id);
            } else if (msg.text === '💡 Предложить тренировку') {
                console.log('Начало процесса предложения тренировки');
                userStates.set(chatId, {
                    step: 'suggest_has_group',
                    data: { 
                        telegram_id: msg.from.id.toString(),
                        client_id: state.data.client_id,
                        is_suggestion: true
                    }
                });
                return bot.sendMessage(chatId,
                    '👥 *У вас есть своя компания и вы хотите все вместе приехать?*',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['Да', 'Нет'], ['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            break;
        }

        case 'group_training_for': {
            if (msg.text === '1. Для себя') {
                userStates.set(chatId, {
                    step: 'group_equipment_type',
                    data: { 
                        ...state.data,
                        is_child: false
                    }
                });

                return bot.sendMessage(chatId,
                    '🎿 *Выберите тип снаряжения:*\n\n' +
                    '• 🎿 Горные лыжи\n' +
                    '• 🏂 Сноуборд',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🎿 Горные лыжи'],
                                ['🏂 Сноуборд'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            } else {
                // Для ребенка
                const childName = msg.text.replace('Для ребенка: ', '');
                const selectedChild = state.data.children.find(child => child.full_name === childName);
                
                if (!selectedChild) {
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при выборе ребенка. Пожалуйста, попробуйте еще раз.',
                        {
                            reply_markup: {
                                keyboard: [
                                    ['1. Для себя'],
                                    ...state.data.children.map(child => [`Для ребенка: ${child.full_name}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                userStates.set(chatId, {
                    step: 'group_equipment_type',
                    data: { 
                        ...state.data,
                        is_child: true,
                        child_id: selectedChild.id,
                        child_name: selectedChild.full_name
                    }
                });

                return bot.sendMessage(chatId,
                    '🎿 *Выберите тип снаряжения:*\n\n' +
                    '• 🎿 Горные лыжи\n' +
                    '• 🏂 Сноуборд',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🎿 Горные лыжи'],
                                ['🏂 Сноуборд'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }

        case 'confirm_booking': {
            if (msg.text === '✅ Записаться на тренировку') {
                try {
                    // Получаем баланс клиента
                    const balanceResult = await pool.query(
                        'SELECT balance FROM wallets WHERE client_id = $1',
                        [state.data.client_id]
                    );
                    const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
                    const price = parseFloat(state.data.price);

                    // Проверяем баланс
                    if (balance < price) {
                        return bot.sendMessage(chatId,
                            `❌ На вашем балансе недостаточно средств для записи на тренировку.\n\n` +
                            `Требуется: ${price.toFixed(2)} руб.\n` +
                            `Доступно: ${balance.toFixed(2)} руб.\n\n` +
                            `Пожалуйста, пополните баланс и попробуйте снова.`,
                            {
                                reply_markup: {
                                    keyboard: [['💳 Пополнить баланс'], ['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Получаем время и длительность
                    const startTime = state.data.preferred_time;
                    const duration = state.data.duration;
                    const slotsNeeded = Math.ceil(duration / 30); // Количество необходимых 30-минутных слотов

                    // Проверяем доступность всех необходимых слотов
                    const slotsToBook = await pool.query(
                        `SELECT id, start_time, is_booked FROM schedule 
                        WHERE simulator_id = $1 
                        AND date = $2 
                        AND start_time >= $3 
                        AND start_time < ($3::time + ($4 * interval '1 minute'))
                        ORDER BY start_time`,
                        [state.data.simulator_id, state.data.preferred_date, startTime, duration]
                    );

                    // Проверяем, что все необходимые слоты свободны
                    if (slotsToBook.rows.length < slotsNeeded) {
                        console.error('Недостаточно свободных слотов:', {
                            needed: slotsNeeded,
                            available: slotsToBook.rows.length,
                            simulator_id: state.data.simulator_id,
                            date: state.data.preferred_date,
                            time: startTime
                        });
                        return bot.sendMessage(chatId,
                            '❌ Выбранное время недоступно для записи.\n' +
                            'Пожалуйста, выберите другое время или уменьшите длительность тренировки до 30 минут.',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Проверяем, что все слоты свободны
                    const hasBookedSlots = slotsToBook.rows.some(slot => slot.is_booked);
                    if (hasBookedSlots) {
                        console.error('Найдены занятые слоты:', {
                            simulator_id: state.data.simulator_id,
                            date: state.data.preferred_date,
                            time: startTime,
                            slots: slotsToBook.rows
                        });
                        return bot.sendMessage(chatId,
                            '❌ Выбранное время недоступно для записи.\n' +
                            'Пожалуйста, выберите другое время или уменьшите длительность тренировки до 30 минут.',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Создаем запись об индивидуальной тренировке
                    // Триггер автоматически забронирует слоты
                    const result = await pool.query(
                        `INSERT INTO individual_training_sessions (
                            client_id, child_id, equipment_type, with_trainer,
                            duration, preferred_date, preferred_time, simulator_id, price
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        RETURNING id`,
                        [
                            state.data.client_id,
                            state.data.is_child ? state.data.child_id : null,
                            state.data.equipment_type,
                            state.data.with_trainer,
                            state.data.duration,
                            state.data.preferred_date,
                            startTime,
                            state.data.simulator_id,
                            state.data.price
                        ]
                    );

                    // Списываем средства с кошелька
                    await pool.query(
                        'UPDATE wallets SET balance = balance - $1 WHERE client_id = $2',
                        [state.data.price, state.data.client_id]
                    );

                    // Формируем дату и время для описания
                    const [year, month, day] = state.data.preferred_date.split('-');
                    const formattedDate = `${day}.${month}.${year}`;
                    const [hours, minutes] = startTime.split(':');
                    const formattedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
                    
                    // Получаем ФИО участника
                    let participantName = '';
                    console.log('Начинаем получение имени участника. state.data.is_child:', state.data.is_child);
                    
                    if (state.data.is_child) {
                        participantName = state.data.child_name;
                        console.log('Участник - ребёнок. participantName:', participantName);
                    } else {
                        const clientRes = await pool.query('SELECT full_name FROM clients WHERE id = $1', [state.data.client_id]);
                        participantName = clientRes.rows[0].full_name;
                        console.log('Участник - взрослый. participantName:', participantName);
                    }

                    // Получаем id кошелька для создания транзакции
                    const walletRes = await pool.query('SELECT id FROM wallets WHERE client_id = $1', [state.data.client_id]);
                    const walletId = walletRes.rows[0]?.id;
                    
                    if (walletId) {
                        // Создаем запись в транзакциях
                        await pool.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [walletId, state.data.price, 'payment', `Запись: Индивидуальная, ${participantName}, Дата: ${formattedDate}, Время: ${formattedTime}, Длительность: ${state.data.duration} мин.`]
                        );
                    }

                    // Проверяем и обновляем реферальный статус после записи на индивидуальную тренировку
                    try {
                        const { updateReferralStatusOnTraining, isFirstTraining } = require('../services/referral-service');
                        const isFirst = await isFirstTraining(state.data.client_id);
                        if (isFirst) {
                            console.log(`🎁 Это первая тренировка клиента ${state.data.client_id}, проверяем реферальный бонус...`);
                            await updateReferralStatusOnTraining(state.data.client_id);
                        }
                    } catch (error) {
                        console.error('❌ Ошибка при проверке реферального бонуса:', error);
                        // Не прерываем основной процесс
                    }

                    // Проверяем milestone бонусы (посещение N тренировок)
                    try {
                        const { checkMilestoneBonuses } = require('../services/bonus-system');
                        await checkMilestoneBonuses(state.data.client_id);
                    } catch (error) {
                        console.error('❌ Ошибка при проверке milestone бонусов:', error);
                        // Не прерываем основной процесс
                    }

                    // Получаем данные клиента для уведомления
                    const clientRes2 = await pool.query('SELECT full_name, birth_date, phone FROM clients WHERE id = $1', [state.data.client_id]);
                    const client = clientRes2.rows[0];
                    
                    // Вычисляем возраст
                    const birthDate = new Date(client.birth_date);
                    const today = new Date();
                    let age = today.getFullYear() - birthDate.getFullYear();
                    const m = today.getMonth() - birthDate.getMonth();
                    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
                    
                    // Отправляем уведомление администратору (используем уже объявленные переменные)
                    console.log('Перед отправкой уведомления. participantName:', participantName);
                    try {
                        await notifyNewIndividualTraining({
                            client_name: participantName,
                            client_age: age,
                            client_phone: client.phone,
                            date: formattedDate,
                            time: formattedTime,
                            trainer_name: state.data.with_trainer ? 'С тренером' : 'Без тренера',
                            price: state.data.price,
                            duration: state.data.duration,
                            equipment_type: state.data.equipment_type
                        });
                        console.log('Уведомление администратору отправлено успешно');
                    } catch (notifyError) {
                        console.error('Ошибка при отправке уведомления администратору:', notifyError);
                    }

                    // Очищаем состояние
                    userStates.delete(chatId);

                    // Формируем сообщение об успешной записи (используем уже объявленные переменные)
                    let successMessage = '✅ *Вы успешно записались на индивидуальную тренировку!*\n\n';
                    successMessage += `📅 Дата: ${formattedDate}\n`;
                    successMessage += `⏰ Время: ${formattedTime}\n`;
                    successMessage += `⏱ Длительность: ${state.data.duration} минут\n`;
                    successMessage += `🎿 Снаряжение: ${state.data.equipment_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
                    successMessage += `👨‍🏫 Тренер: ${state.data.with_trainer ? 'С тренером' : 'Без тренера'}\n`;
                    successMessage += `💰 Стоимость: ${state.data.price} руб.\n\n`;
                    successMessage += 'Ждем вас на тренировке!';

                    return bot.sendMessage(chatId, successMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при записи на тренировку:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при записи на тренировку. Пожалуйста, попробуйте позже.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            } else if (msg.text === '💳 Пополнить баланс') {
                return handleTopUpBalance(chatId, state.data.client_id);
            } else if (msg.text === '❌ Я передумал') {
                userStates.delete(chatId);
                return showMainMenu(chatId);
            }
            break;
        }

        // ==================== ОБРАБОТКА СОСТОЯНИЙ СЕРТИФИКАТОВ ====================
        
        case 'certificates_menu': {
            const clientId = state.data.client_id;
            
            if (msg.text === '💝 Подарить сертификат') {
                return showCertificateIntro(chatId, clientId);
            } else if (msg.text === '🔑 Активировать сертификат') {
                return showCertificateActivation(chatId, clientId);
            } else if (msg.text === '📋 Мои сертификаты') {
                return showUserCertificates(chatId, clientId);
            }
            break;
        }

        case 'certificate_intro': {
            const clientId = state.data.client_id;
            
            if (msg.text === 'Да, покупаю!') {
                return showNominalSelection(chatId, clientId);
            } else if (msg.text === 'Вернуться в меню') {
                return showCertificatesMenu(chatId);
            }
            break;
        }

        case 'certificate_nominal_selection': {
            const clientId = state.data.client_id;
            let nominalValue = 0;

            console.log(`[certificate_nominal_selection] Обработка выбора суммы. Текст: "${msg.text}", clientId: ${clientId}`);

            // Нормализуем текст (убираем лишние пробелы, приводим к нижнему регистру для сравнения)
            const normalizedText = msg.text.trim().toLowerCase();

            // Обрабатываем выбор номинала (проверяем разными способами)
            if (msg.text.includes('2 500') || normalizedText.includes('2500') || msg.text.includes('2,500')) {
                nominalValue = 2500;
            } else if (msg.text.includes('3 000') || normalizedText.includes('3000') || msg.text.includes('3,000')) {
                nominalValue = 3000;
            } else if (msg.text.includes('5 000') || normalizedText.includes('5000') || msg.text.includes('5,000')) {
                nominalValue = 5000;
            } else if (msg.text.includes('6 000') || normalizedText.includes('6000') || msg.text.includes('6,000')) {
                nominalValue = 6000;
            } else if (msg.text.includes('10 000') || normalizedText.includes('10000') || msg.text.includes('10,000')) {
                nominalValue = 10000;
            } else if (msg.text.includes('15 000') || normalizedText.includes('15000') || msg.text.includes('15,000')) {
                nominalValue = 15000;
            } else if (msg.text === '💳 Произвольная сумма' || normalizedText.includes('произвольная')) {
                userStates.set(chatId, {
                    step: 'certificate_custom_amount',
                    data: { client_id: clientId }
                });
                return bot.sendMessage(chatId,
                    '💳 **ПРОИЗВОЛЬНАЯ СУММА**\n\nВведите сумму сертификата (от 500 до 50 000 руб.):\n\n**Пример:** 7500',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад']],
                            resize_keyboard: true
                        }
                    }
                );
            } else if (msg.text === '🔙 Назад') {
                return showCertificatesMenu(chatId);
            }

            if (nominalValue > 0) {
                console.log(`[certificate_nominal_selection] Выбран номинал: ${nominalValue}, вызываем showDesignSelection`);
                try {
                    return await showDesignSelection(chatId, clientId, nominalValue);
                } catch (error) {
                    console.error('[certificate_nominal_selection] Ошибка в showDesignSelection:', error);
                    return bot.sendMessage(chatId, 
                        '❌ Произошла ошибка при загрузке дизайнов. Попробуйте позже или обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [
                                    ['💰 2 500 руб.', '💰 3 000 руб.'],
                                    ['💰 5 000 руб.', '💰 6 000 руб.'],
                                    ['💰 10 000 руб.', '💰 15 000 руб.'],
                                    ['💳 Произвольная сумма'],
                                    ['🔙 Назад']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            }
            
            // Если не распознан выбор, отправляем подсказку
            console.log(`[certificate_nominal_selection] Не распознан выбор суммы: "${msg.text}"`);
            return bot.sendMessage(chatId, 
                '❓ Не удалось распознать выбор.\n\nПожалуйста, выберите номинал из предложенных вариантов или нажмите "🔙 Назад".',
                {
                    reply_markup: {
                        keyboard: [
                            ['💰 2 500 руб.', '💰 3 000 руб.'],
                            ['💰 5 000 руб.', '💰 6 000 руб.'],
                            ['💰 10 000 руб.', '💰 15 000 руб.'],
                            ['💳 Произвольная сумма'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'certificate_custom_amount': {
            const clientId = state.data.client_id;
            
            if (msg.text === '🔙 Назад') {
                return showNominalSelection(chatId, clientId);
            }

            const amount = parseFloat(msg.text);
            if (isNaN(amount) || amount < 500 || amount > 50000) {
                return bot.sendMessage(chatId,
                    '❌ **Неверная сумма!**\n\nВведите сумму от 500 до 50 000 руб.\n\n**Пример:** 7500',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            return showDesignSelection(chatId, clientId, amount);
        }

        case 'certificate_design_selection': {
            const { client_id, nominal_value } = state.data;
            
            if (msg.text === '🔙 Назад') {
                return showNominalSelection(chatId, client_id);
            }

            // Извлекаем номер дизайна из сообщения
            const designMatch = msg.text.match(/^(\d+)️⃣/);
            if (designMatch) {
                const designId = parseInt(designMatch[1]);
                return showRecipientForm(chatId, client_id, nominal_value, designId);
            }
            break;
        }

        case 'certificate_recipient_data': {
            const { client_id, nominal_value, design_id } = state.data;
            
            if (msg.text === '🔙 Назад') {
                return showDesignSelection(chatId, client_id, nominal_value);
            }

            if (msg.text === '⏭ Пропустить') {
                // Пропускаем данные получателя, переходим к вводу email
                const purchaseData = {
                    client_id,
                    nominal_value,
                    design_id,
                    recipient_name: null,
                    message: null
                };
                return showEmailInputForm(chatId, purchaseData);
            }

            // Парсим данные получателя из сообщения
            const lines = msg.text.split('\n').filter(line => line.trim());
            let recipientName = null;
            let message = null;

            // Определяем какие данные предоставлены
            if (lines.length >= 1) {
                recipientName = lines[0].trim();
            }
            if (lines.length >= 2) {
                // Все остальные строки считаем пожеланием
                message = lines.slice(1).join(' ').trim();
                
                // Ограничиваем длину пожелания
                if (message && message.length > 30) {
                    return bot.sendMessage(chatId, `❌ Пожелание слишком длинное. Максимум 30 символов.\n\nТекущая длина: ${message.length} символов.\n\nВведите более короткое пожелание.`, {
                        reply_markup: {
                            keyboard: [
                                ['⏭ Пропустить'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    });
                }
            }

            const purchaseData = {
                client_id,
                nominal_value,
                design_id,
                recipient_name: recipientName,
                message: message
            };

            // Переходим к вводу email перед подтверждением
            return showEmailInputForm(chatId, purchaseData);
        }

        case 'certificate_email_input': {
            const purchaseData = state.data;
            
            if (msg.text === '🔙 Назад') {
                return showRecipientForm(chatId, purchaseData.client_id, purchaseData.nominal_value, purchaseData.design_id);
            }

            if (msg.text === '⏭ Пропустить') {
                // Пропускаем ввод email, переходим к подтверждению
                purchaseData.email = null;
                return showPurchaseConfirmation(chatId, purchaseData);
            }

            // Проверяем, выбрал ли пользователь существующий email
            if (msg.text.startsWith('Использовать: ')) {
                const existingEmail = msg.text.replace('Использовать: ', '').trim();
                purchaseData.email = existingEmail;
                return showPurchaseConfirmation(chatId, purchaseData);
            }

            // Валидируем email
            const email = msg.text.trim();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            
            if (!emailRegex.test(email)) {
                // Получаем существующий email для показа кнопки
                const clientResult = await pool.query(
                    'SELECT email FROM clients WHERE id = $1',
                    [purchaseData.client_id]
                );
                const existingEmail = clientResult.rows[0]?.email;
                
                const keyboard = [
                    ['⏭ Пропустить'],
                    ['🔙 Назад']
                ];
                if (existingEmail) {
                    keyboard.unshift([`Использовать: ${existingEmail}`]);
                }

                return bot.sendMessage(chatId, 
                    '❌ Неверный формат email.\n\nПожалуйста, введите корректный email адрес.\n\n**Пример:** example@mail.ru\n\nИли нажмите "⏭ Пропустить" для продолжения без email.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: keyboard,
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Сохраняем email и переходим к подтверждению
            purchaseData.email = email;
            return showPurchaseConfirmation(chatId, purchaseData);
        }

        case 'certificate_purchase_confirmation': {
            const purchaseData = state.data;
            
            if (msg.text === '🔙 Назад') {
                return showEmailInputForm(chatId, purchaseData);
            }

            if (msg.text === '❌ Отменить') {
                return showCertificatesMenu(chatId);
            }

            if (msg.text === '✅ Купить сертификат') {
                console.log(`[certificate_purchase_confirmation] Обработка покупки сертификата, chatId: ${chatId}`);
                
                // Защита от множественных покупок
                const currentState = userStates.get(chatId);
                console.log(`[certificate_purchase_confirmation] Текущее состояние:`, {
                    hasState: !!currentState,
                    step: currentState?.step,
                    processing: currentState?.processing,
                    hasPurchaseData: !!purchaseData
                });
                
                if (currentState && currentState.step === 'certificate_purchase_confirmation') {
                    // Проверяем, не идет ли уже процесс покупки
                    if (currentState.processing) {
                        console.log(`[certificate_purchase_confirmation] Покупка уже обрабатывается`);
                        return bot.sendMessage(chatId, '⏳ Покупка уже обрабатывается, пожалуйста, подождите...');
                    }
                    
                    // Устанавливаем флаг обработки
                    userStates.set(chatId, {
                        ...currentState,
                        processing: true
                    });
                    
                    // Показываем индикатор загрузки
                    await bot.sendMessage(chatId, '⏳ Обрабатываем покупку...');
                    
                    console.log(`[certificate_purchase_confirmation] Вызов createCertificate...`);
                    // Выполняем покупку
                    return createCertificate(chatId, purchaseData).catch(error => {
                        console.error(`[certificate_purchase_confirmation] Ошибка в createCertificate:`, error);
                        // Очищаем состояние при ошибке
                        userStates.delete(chatId);
                        return bot.sendMessage(chatId, '❌ Произошла ошибка при создании сертификата. Пожалуйста, попробуйте позже.', {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        });
                    });
                }
                
                console.log(`[certificate_purchase_confirmation] Сессия истекла или состояние неверное`);
                return bot.sendMessage(chatId, '❌ Сессия истекла. Начните покупку заново.', {
                    reply_markup: {
                        keyboard: [['🔙 В главное меню']],
                        resize_keyboard: true
                    }
                });
            }

            if (msg.text === '💰 Пополнить кошелек') {
                // Переходим к пополнению кошелька
                userStates.set(chatId, { 
                    step: 'main_menu', 
                    data: { client_id: purchaseData.client_id } 
                });
                return bot.sendMessage(chatId,
                    '💰 **ПОПОЛНЕНИЕ КОШЕЛЬКА**\n\nДля пополнения кошелька воспользуйтесь кнопкой "Кошелек" в главном меню.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['💰 Кошелек'],
                                ['🔙 В главное меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            // Если текст не соответствует ни одной кнопке, игнорируем
            return Promise.resolve();
        }

        case 'certificate_activation': {
            const clientId = state.data.client_id;
            
            if (msg.text === '🔙 Назад') {
                return showCertificatesMenu(chatId);
            }

            if (msg.text === '🔑 Попробовать еще раз') {
                return showCertificateActivation(chatId, clientId);
            }

            // Проверяем формат номера сертификата
            const certificateNumber = msg.text.trim();
            if (!/^[0-9]{6}$/.test(certificateNumber)) {
                return bot.sendMessage(chatId,
                    '❌ **Неверный формат номера!**\n\nНомер сертификата должен состоять из 6 цифр.\n\n**Пример:** `123456`',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🔑 Попробовать еще раз'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            return activateCertificate(chatId, certificateNumber, clientId);
        }

        // Обработка состояний для зимних тренировок
        case 'natural_slope_individual_date': {
            // Показываем календарь доступных дат вместо ручного ввода
            await showNaturalSlopeAvailableDates(chatId, state.data || {});
            return;
        }

        case 'natural_slope_location_selection': {
            if (msg.text === '🔙 Назад') {
                userStates.delete(chatId);
                return showMainMenu(chatId);
            }
            
            let location = null;
            if (msg.text === '🏔️ База отдыха «Кулига-Клуб»') {
                location = 'kuliga';
            } else if (msg.text === '⛰️ Воронинские горки') {
                location = 'vorona';
            } else {
                return bot.sendMessage(chatId, 'Пожалуйста, выберите место проведения или нажмите "🔙 Назад".');
            }
            
            const client = await getClientByTelegramId(msg.from.id.toString());
            if (!client) {
                return bot.sendMessage(chatId, '❌ Пожалуйста, сначала зарегистрируйтесь.');
            }
            
            state.data = state.data || {};
            state.data.location = location;
            state.step = 'natural_slope_training_menu';
            userStates.set(chatId, state);
            
            return bot.sendMessage(chatId,
                `🏔️ *Естественный склон${location === 'kuliga' ? ' (Кулига)' : ' (Воронинские горки)'}*\n\nВыберите тип тренировки:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['🏔️ Индивидуальная тренировка'],
                            ['👥 Групповая тренировка'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }
        
        case 'natural_slope_training_menu': {
            if (msg.text === '🔙 Назад') {
                state.step = 'natural_slope_location_selection';
                userStates.set(chatId, state);
                return showNaturalSlopeTrainingMenu(chatId);
            }
            return bot.sendMessage(chatId, 'Пожалуйста, выберите тип тренировки или нажмите "🔙 Назад".');
        }

        case 'kuliga_group_type_selection': {
            if (msg.text === '🔙 Назад') {
                state.step = 'natural_slope_training_menu';
                userStates.set(chatId, state);
                const location = state.data?.location || 'kuliga';
                return bot.sendMessage(chatId,
                    `🏔️ *Естественный склон${location === 'kuliga' ? ' (Кулига)' : ' (Воронинские горки)'}*\n\nВыберите тип тренировки:`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🏔️ Индивидуальная тренировка'],
                                ['👥 Групповая тренировка'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            if (msg.text === '👥 У меня своя группа') {
                state.step = 'kuliga_group_own_sport';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '🎿 *Выберите вид спорта:*\n\n' +
                    '• ⛷️ Горные лыжи\n' +
                    '• 🏂 Сноуборд',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['⛷️ Горные лыжи'],
                                ['🏂 Сноуборд'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            if (msg.text === '📅 Записаться в группу') {
                // Сначала показываем выбор вида спорта
                state.step = 'kuliga_group_existing_sport';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '🎿 *Выберите вид спорта:*\n\n' +
                    '• ⛷️ *Горные лыжи*\n' +
                    '• 🏂 *Сноуборд*',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['⛷️ Горные лыжи'],
                                ['🏂 Сноуборд'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            return bot.sendMessage(chatId, 'Пожалуйста, выберите один из вариантов или нажмите "🔙 Назад".');
        }

        case 'kuliga_group_own_sport': {
            if (msg.text === '🔙 Назад') {
                state.step = 'kuliga_group_type_selection';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '👥 *Групповые тренировки на естественном склоне*\n\n' +
                    'Выберите вариант записи:\n\n' +
                    '• 👥 *У меня своя группа* - выберите дату и время для своей группы, укажите участников\n' +
                    '• 📅 *Записаться в группу* - выберите из существующих групповых тренировок',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['👥 У меня своя группа'],
                                ['📅 Записаться в группу'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            if (msg.text === '⛷️ Горные лыжи' || msg.text === '🏂 Сноуборд') {
                state.data.selected_sport = msg.text === '🏂 Сноуборд' ? 'snowboard' : 'ski';
                state.step = 'kuliga_group_own_date';
                userStates.set(chatId, state);
                return showKuligaAvailableDatesForOwnGroup(chatId, state.data);
            }

            return bot.sendMessage(chatId, 'Пожалуйста, выберите вид спорта или нажмите "🔙 Назад".');
        }

        case 'kuliga_group_existing_sport': {
            if (msg.text === '🔙 Назад' || msg.text === '⬅️ Назад' || msg.text === 'Назад') {
                state.step = 'kuliga_group_type_selection';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '👥 *Групповые тренировки на естественном склоне*\n\n' +
                    'Выберите вариант записи:\n\n' +
                    '• 👥 *У меня своя группа* - выберите дату и время для своей группы, укажите участников\n' +
                    '• 📅 *Записаться в группу* - выберите из существующих групповых тренировок',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['👥 У меня своя группа'],
                                ['📅 Записаться в группу'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            if (msg.text === '⛷️ Горные лыжи' || msg.text === '🏂 Сноуборд') {
                state.data.selected_sport = msg.text === '🏂 Сноуборд' ? 'snowboard' : 'ski';
                state.step = 'kuliga_group_existing_date';
                userStates.set(chatId, state);
                const location = state.data.location || 'kuliga';
                return showKuligaGroupTrainingDates(chatId, state.data.client_id, state.data.selected_sport, location);
            }

            return bot.sendMessage(chatId, 'Пожалуйста, выберите вид спорта или нажмите "🔙 Назад".');
        }

        case 'kuliga_group_own_date': {
            if (msg.text === '🔙 Назад') {
                state.step = 'kuliga_group_own_sport';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '🎿 *Выберите вид спорта:*\n\n' +
                    '• ⛷️ Горные лыжи\n' +
                    '• 🏂 Сноуборд',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['⛷️ Горные лыжи'],
                                ['🏂 Сноуборд'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Получаем выбранную дату из маппинга
            const selectedDate = state.data.date_map && state.data.date_map[msg.text];
            if (!selectedDate) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите дату из предложенных вариантов.',
                    {
                        reply_markup: {
                            keyboard: [
                                ...Object.keys(state.data.date_map || {}).map(key => [key]),
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Показываем временные слоты для выбранной даты
            return showKuligaTimeSlotsForOwnGroup(chatId, selectedDate, state.data);
        }

        case 'kuliga_group_own_time': {
            if (msg.text === '🔙 Назад') {
                return showKuligaAvailableDatesForOwnGroup(chatId, state.data);
            }

            // Находим выбранный слот
            const selectedSlot = state.data.available_slots.find(slot => {
                const timeStr = String(slot.start_time).substring(0, 5);
                const endTimeStr = String(slot.end_time).substring(0, 5);
                const buttonText = `${timeStr} - ${endTimeStr} (${slot.instructor_name})`;
                return buttonText === msg.text;
            });

            if (!selectedSlot) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите время из предложенных вариантов.',
                    {
                        reply_markup: {
                            keyboard: [
                                ...state.data.available_slots.map(slot => {
                                    const timeStr = String(slot.start_time).substring(0, 5);
                                    const endTimeStr = String(slot.end_time).substring(0, 5);
                                    return [`${timeStr} - ${endTimeStr} (${slot.instructor_name})`];
                                }),
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Сохраняем выбранный слот
            state.data.selected_slot_id = selectedSlot.id;
            state.data.selected_instructor_id = selectedSlot.instructor_id;
            state.data.selected_instructor_name = selectedSlot.instructor_name;
            state.data.selected_start_time = selectedSlot.start_time;
            state.data.selected_end_time = selectedSlot.end_time;

            // Переходим к вводу участников
            state.step = 'kuliga_group_own_participants';
            userStates.set(chatId, state);

            // Получаем данные клиента и список детей
            const clientResult = await pool.query(
                'SELECT id, full_name, birth_date FROM clients WHERE id = $1',
                [state.data.client_id]
            );
            const client = clientResult.rows[0] || {};

            const childrenResult = await pool.query(
                'SELECT id, full_name, birth_date FROM children WHERE parent_id = $1 ORDER BY birth_date',
                [state.data.client_id]
            );

            const children = childrenResult.rows;
            let message = '👥 *Укажите участников групповой тренировки*\n\n';
            
            if (children.length > 0) {
                message += 'Вы можете:\n';
                message += '• Выбрать себя или зарегистрированных детей (кнопки ниже)\n';
                message += '• Ввести имена и возрасты через запятую\n';
                message += '  Например: Иван 10, Мария 8\n\n';
                message += 'Доступные участники:\n';
                message += `1. 👤 ${client.full_name || 'Вы'}\n`;

                const participantButtons = [];
                // Добавляем кнопку "Себя" в начало
                participantButtons.push(['👤 Себя']);

                children.forEach((child, index) => {
                    const age = moment().diff(moment(child.birth_date), 'years');
                    // Формат кнопки: "👶 Имя (возраст)"
                    const buttonText = `👶 ${child.full_name} (${age})`;
                    if (index % 2 === 0) {
                        participantButtons.push([buttonText]);
                    } else {
                        participantButtons[participantButtons.length - 1].push(buttonText);
                    }
                    message += `${index + 2}. ${child.full_name} (${age})\n`;
                });

                participantButtons.push(['✅ Все указано, продолжить']);
                participantButtons.push(['🔙 Назад']);

                state.data.children = children;
                state.data.client = client;
                state.data.selected_participants = [];
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: participantButtons,
                        resize_keyboard: true
                    }
                });
            } else {
                message += 'Вы можете:\n';
                message += '• Записать себя (кнопка ниже)\n';
                message += '• Ввести имена и возрасты через запятую\n';
                message += '  Например: Иван 10, Мария 8\n\n';
                message += '⚠️ Укажите всех участников, включая возраст каждого.';

                const participantButtons = [];
                participantButtons.push(['👤 Себя']);
                participantButtons.push(['✅ Все указано, продолжить']);
                participantButtons.push(['🔙 Назад']);

                state.data.children = [];
                state.data.client = client;
                state.data.selected_participants = [];
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: participantButtons,
                        resize_keyboard: true
                    }
                });
            }
        }

        case 'kuliga_group_existing_date': {
            if (msg.text === '🔙 Назад') {
                state.step = 'kuliga_group_existing_sport';
                userStates.set(chatId, state);
                return bot.sendMessage(chatId,
                    '🎿 *Выберите вид спорта:*\n\n' +
                    '• ⛷️ *Горные лыжи*\n' +
                    '• 🏂 *Сноуборд*',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['⛷️ Горные лыжи'],
                                ['🏂 Сноуборд'],
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Получаем выбранную дату из маппинга
            const selectedDate = state.data.date_map && state.data.date_map[msg.text];
            if (!selectedDate) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите дату из предложенных вариантов.',
                    {
                        reply_markup: {
                            keyboard: [
                                ...Object.keys(state.data.date_map || {}).map(key => [key]),
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Получаем групповые тренировки на выбранную дату
            // ВАЖНО: Исключаем приватные тренировки (is_private = TRUE) - к ним нельзя добавиться
            // ВАЖНО: Подсчитываем участников из активных бронирований (status IN ('pending', 'confirmed'))
            // Фильтруем по выбранному виду спорта, если он был выбран
            const sportType = state.data.selected_sport;
            const params = [selectedDate];
            let sportFilter = '';
            if (sportType) {
                sportFilter = 'AND kgt.sport_type = $2';
                params.push(sportType);
            }

            const trainingsResult = await pool.query(
                `SELECT kgt.id, kgt.start_time, kgt.end_time, kgt.sport_type, kgt.level,
                        kgt.price_per_person, kgt.max_participants, kgt.description,
                        COALESCE(SUM(kb.participants_count), 0)::INTEGER as current_participants,
                        ki.full_name as instructor_name
                 FROM kuliga_group_trainings kgt
                 JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
                 LEFT JOIN kuliga_bookings kb ON kgt.id = kb.group_training_id 
                     AND kb.status IN ('pending', 'confirmed')
                 WHERE kgt.date = $1::date
                   AND kgt.status IN ('open', 'confirmed')
                   AND kgt.is_private = FALSE
                   AND ki.is_active = TRUE
                   ${sportFilter}
                   AND (
                       kgt.date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                       OR (
                           kgt.date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                           AND kgt.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                       )
                   )
                 GROUP BY kgt.id, kgt.start_time, kgt.end_time, kgt.sport_type, kgt.level,
                          kgt.price_per_person, kgt.max_participants, kgt.description, 
                          ki.full_name
                 HAVING COALESCE(SUM(kb.participants_count), 0) < kgt.max_participants
                 ORDER BY kgt.start_time`,
                params
            );

            if (trainingsResult.rows.length === 0) {
                return bot.sendMessage(chatId,
                    '❌ *На выбранную дату нет доступных групповых тренировок!*\n\n' +
                    'Выберите другую дату.',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ...Object.keys(state.data.date_map || {}).map(key => [key]),
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Формируем кнопки с временами
            const timeButtons = [];
            const trainings = trainingsResult.rows;

            trainings.forEach((training, index) => {
                const timeStr = String(training.start_time).substring(0, 5);
                const endTimeStr = String(training.end_time).substring(0, 5);
                const sportType = training.sport_type === 'ski' ? '⛷️' : '🏂';
                const freePlaces = training.max_participants - training.current_participants;
                const buttonText = `${timeStr} - ${endTimeStr} ${sportType} (${freePlaces} мест)`;

                if (index % 2 === 0) {
                    timeButtons.push([buttonText]);
                } else {
                    timeButtons[timeButtons.length - 1].push(buttonText);
                }
            });

            timeButtons.push(['🔙 Назад']);

            // Сохраняем тренировки в состояние
            state.data.available_trainings = trainings;
            state.data.selected_date = selectedDate;
            state.step = 'kuliga_group_existing_time';
            userStates.set(chatId, state);

            const date = moment(selectedDate).tz('Asia/Yekaterinburg');
            const dateStr = date.format('DD.MM.YYYY');
            const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.day()];

            let message = `⏰ *Выберите время групповой тренировки*\n\n`;
            message += `📅 Дата: ${dateStr} (${dayName})\n\n`;
            message += 'Доступные групповые тренировки:\n\n';

            trainings.forEach((training) => {
                const timeStr = String(training.start_time).substring(0, 5);
                const endTimeStr = String(training.end_time).substring(0, 5);
                const sportType = training.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
                const freePlaces = training.max_participants - training.current_participants;
                const pricePerPerson = parseFloat(training.price_per_person || 0).toFixed(2);

                message += `• ${timeStr} - ${endTimeStr} ${sportType}\n`;
                message += `  👨‍🏫 ${training.instructor_name}\n`;
                const occupiedPlaces = training.current_participants || 0;
                message += `  👥 Занято мест: ${occupiedPlaces}/${training.max_participants}\n`;
                if (training.description) {
                    message += `  📝 ${training.description}\n`;
                }
                message += `  💰 Цена за человека: ${pricePerPerson} ₽\n\n`;
            });

            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: timeButtons,
                    resize_keyboard: true
                }
            });
        }

        case 'kuliga_group_existing_time': {
            if (msg.text === '🔙 Назад') {
                const location = state.data.location || 'kuliga';
                return showKuligaGroupTrainingDates(chatId, state.data.client_id, null, location);
            }

            // Находим выбранную тренировку
            const selectedTraining = state.data.available_trainings.find(training => {
                const timeStr = String(training.start_time).substring(0, 5);
                const endTimeStr = String(training.end_time).substring(0, 5);
                const sportType = training.sport_type === 'ski' ? '⛷️' : '🏂';
                const freePlaces = training.max_participants - training.current_participants;
                const buttonText = `${timeStr} - ${endTimeStr} ${sportType} (${freePlaces} мест)`;
                return buttonText === msg.text;
            });

            if (!selectedTraining) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите время из предложенных вариантов.',
                    {
                        reply_markup: {
                            keyboard: [
                                ...state.data.available_trainings.map(training => {
                                    const timeStr = String(training.start_time).substring(0, 5);
                                    const endTimeStr = String(training.end_time).substring(0, 5);
                                    const sportType = training.sport_type === 'ski' ? '⛷️' : '🏂';
                                    const freePlaces = training.max_participants - training.current_participants;
                                    return [`${timeStr} - ${endTimeStr} ${sportType} (${freePlaces} мест)`];
                                }),
                                ['🔙 Назад']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Сохраняем выбранную тренировку
            state.data.selected_training_id = selectedTraining.id;
            state.data.selected_instructor_id = null; // Для существующих групповых тренировок инструктор уже привязан
            state.data.selected_instructor_name = selectedTraining.instructor_name;
            state.data.selected_start_time = selectedTraining.start_time;
            state.data.selected_end_time = selectedTraining.end_time;
            state.data.selected_sport = selectedTraining.sport_type;
            state.data.price_per_person = selectedTraining.price_per_person;
            state.data.max_participants = selectedTraining.max_participants;
            state.data.current_participants = selectedTraining.current_participants;
            state.data.training_description = selectedTraining.description;

            // Переходим к выбору участников
            state.step = 'kuliga_group_existing_participants';
            userStates.set(chatId, state);

            // Получаем список детей клиента
            const childrenResult = await pool.query(
                'SELECT id, full_name, birth_date FROM children WHERE parent_id = $1 ORDER BY birth_date',
                [state.data.client_id]
            );

            const children = childrenResult.rows;
            const freePlaces = selectedTraining.max_participants - selectedTraining.current_participants;

            let message = '👥 *Кого записать на групповую тренировку?*\n\n';
            message += `📅 Дата: ${moment(state.data.selected_date).format('DD.MM.YYYY')}\n`;
            message += `⏰ Время: ${String(selectedTraining.start_time).substring(0, 5)}\n`;
            message += `👨‍🏫 Инструктор: ${selectedTraining.instructor_name}\n`;
            const occupiedPlaces = selectedTraining.current_participants || 0;
            message += `👥 Занято мест: ${occupiedPlaces}/${selectedTraining.max_participants}\n`;
            if (selectedTraining.description) {
                message += `📝 ${selectedTraining.description}\n`;
            }
            message += `💰 Цена за человека: ${parseFloat(selectedTraining.price_per_person || 0).toFixed(2)} ₽\n\n`;

            if (children.length > 0) {
                message += 'Выберите участника:\n';
                const participantButtons = [];
                participantButtons.push(['👤 Себя']);
                
                children.forEach((child, index) => {
                    const age = moment().diff(moment(child.birth_date), 'years');
                    const buttonText = `👶 ${child.full_name} (${age} лет)`;
                    if (index % 2 === 0) {
                        participantButtons.push([buttonText]);
                    } else {
                        participantButtons[participantButtons.length - 1].push(buttonText);
                    }
                    message += `${index + 2}. ${child.full_name} (${age} лет)\n`;
                });

                participantButtons.push(['🔙 Назад']);

                state.data.children = children;
                state.data.selected_participants = [];
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: participantButtons,
                        resize_keyboard: true
                    }
                });
            } else {
                message += 'Выберите участника:\n';
                message += '1. 👤 Себя\n';
                message += '\nВы можете записать только себя. Для записи детей их нужно сначала добавить в профиль.';

                state.data.selected_participants = [];
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['👤 Себя'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                });
            }
        }

        case 'kuliga_group_own_participants': {
            console.log('🎯 === CASE kuliga_group_own_participants ===');
            console.log('📥 Входящее сообщение:', {
                text: msg.text,
                textLength: msg.text ? msg.text.length : 0,
                textBytes: msg.text ? Buffer.from(msg.text).toString('hex') : null,
                step: state.step,
                clientId: state.data.client_id,
                selectedParticipants: state.data.selected_participants ? state.data.selected_participants.length : 0
            });
            
            if (msg.text === '🔙 Назад') {
                console.log('⬅️ Обработка "Назад"');
                state.step = 'kuliga_group_own_time';
                userStates.set(chatId, state);
                return showKuligaTimeSlotsForOwnGroup(chatId, state.data.selected_date, state.data);
            }

            if (msg.text === '✅ Все указано, продолжить') {
                console.log('✅ Обработка "Все указано, продолжить"');
                if (!state.data.selected_participants || state.data.selected_participants.length === 0) {
                    return showParticipantsList(chatId, state, true);
                }

                // Переходим к расчету стоимости и подтверждению
                return await calculateAndConfirmKuligaOwnGroupBooking(chatId, state);
            }

            // Обработка выбора "Себя" (включая повторное нажатие на уже выбранную кнопку)
            if (msg.text === '👤 Себя' || msg.text === '✅ Себя') {
                // Получаем данные клиента если еще не получены
                if (!state.data.client) {
                    const clientResult = await pool.query(
                        'SELECT id, full_name, birth_date FROM clients WHERE id = $1',
                        [state.data.client_id]
                    );
                    state.data.client = clientResult.rows[0] || {};
                }

                const client = state.data.client;
                if (!client.full_name) {
                    return bot.sendMessage(chatId, '❌ Ошибка: данные клиента не найдены.');
                }

                // Проверяем, выбран ли уже клиент
                const existingIndex = state.data.selected_participants.findIndex(p => p.isSelf);
                if (existingIndex >= 0) {
                    // Убираем из списка (повторное нажатие)
                    state.data.selected_participants.splice(existingIndex, 1);
                } else {
                    // Добавляем к участникам
                    const age = moment().diff(moment(client.birth_date), 'years');
                    state.data.selected_participants.push({
                        fullName: client.full_name,
                        birthYear: moment(client.birth_date).year(),
                        age: age,
                        isSelf: true
                    });
                }
                userStates.set(chatId, state);
                console.log('💾 Состояние сохранено после "Себя":', {
                    step: state.step,
                    participantsCount: state.data.selected_participants.length,
                    hasChildren: !!state.data.children
                });

                // Показываем обновленный список участников
                const result = await showParticipantsList(chatId, state);
                
                // Дополнительно проверяем, что состояние сохранилось после показа списка
                const stateAfter = userStates.get(chatId);
                console.log('✅ Состояние после showParticipantsList:', {
                    hasState: !!stateAfter,
                    step: stateAfter ? stateAfter.step : 'NO_STATE'
                });
                
                return result;
            }

            // Обработка выбора ребенка (включая повторное нажатие)
            // Формат кнопки: "👶 Имя (возраст)" или "✅ Имя (возраст)"
            if (msg.text && (msg.text.startsWith('👶') || msg.text.startsWith('✅')) && 
                msg.text !== '✅ Себя' && 
                msg.text !== '✅ Все указано, продолжить') {
                
                console.log('🔍 Обработка выбора ребенка в switch-case:', {
                    msgText: msg.text,
                    step: state.step,
                    clientId: state.data.client_id
                });

                // Формат кнопки: "👶 Имя (возраст)" или "✅ Имя (возраст)"
                const buttonText = msg.text.replace(/^(👶|✅)\s*/, '');
                const match = buttonText.match(/^(.+?)\s*\((\d+)\)$/);
                
                if (!match) {
                    console.error('❌ Неверный формат кнопки:', { buttonText, msgText: msg.text });
                    return bot.sendMessage(chatId, '❌ Неверный формат кнопки. Выберите из списка.');
                }

                const childName = match[1].trim();
                const buttonAge = parseInt(match[2]);
                console.log('🔎 Ищем ребенка:', { childName, buttonAge });
                
                // Всегда загружаем свежий список детей из базы данных
                const childrenResult = await pool.query(
                    'SELECT id, full_name, birth_date FROM children WHERE parent_id = $1 ORDER BY birth_date',
                    [state.data.client_id]
                );
                state.data.children = childrenResult.rows;
                
                console.log('📋 Загружено детей из БД:', {
                    count: state.data.children.length,
                    children: state.data.children.map(c => ({
                        id: c.id,
                        name: c.full_name,
                        birth_date: c.birth_date,
                        age: moment().diff(moment(c.birth_date), 'years')
                    }))
                });
                
                userStates.set(chatId, state);
                
                // Ищем ребенка по имени и возрасту (с учетом возможных различий в пробелах)
                const child = state.data.children.find(c => {
                    const dbName = c.full_name.trim();
                    const searchName = childName.trim();
                    const dbAge = moment().diff(moment(c.birth_date), 'years');
                    
                    console.log('🔍 Проверка ребенка:', {
                        dbName,
                        searchName,
                        dbAge,
                        buttonAge,
                        nameMatch: dbName === searchName || dbName.toLowerCase() === searchName.toLowerCase(),
                        ageMatch: Math.abs(dbAge - buttonAge) <= 1
                    });
                    
                    // Проверяем по имени (регистронезависимо) и возрасту
                    return (dbName === searchName || dbName.toLowerCase() === searchName.toLowerCase()) && 
                           Math.abs(dbAge - buttonAge) <= 1; // Разница в возрасте не больше года (на случай если год прошел)
                });
                
                if (!child) {
                    console.error('❌ Ребенок не найден:', {
                        childName,
                        buttonAge,
                        availableChildren: state.data.children.map(c => ({
                            name: c.full_name,
                            age: moment().diff(moment(c.birth_date), 'years'),
                            id: c.id
                        })),
                        buttonText,
                        msgText: msg.text,
                        clientId: state.data.client_id
                    });
                    return bot.sendMessage(chatId, 
                        '❌ Ребенок не найден. Попробуйте выбрать из списка еще раз или введите вручную через запятую.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                
                console.log('✅ Ребенок найден:', { id: child.id, name: child.full_name });

                // Проверяем, выбран ли уже ребенок
                const existingIndex = state.data.selected_participants.findIndex(p => p.childId === child.id);
                if (existingIndex >= 0) {
                    // Убираем из списка (повторное нажатие)
                    state.data.selected_participants.splice(existingIndex, 1);
                } else {
                    // Добавляем к участникам
                    const age = moment().diff(moment(child.birth_date), 'years');
                    state.data.selected_participants.push({
                        fullName: child.full_name,
                        birthYear: moment(child.birth_date).year(),
                        age: age,
                        childId: child.id
                    });
                }
                userStates.set(chatId, state);

                // Показываем обновленный список участников
                return showParticipantsList(chatId, state);
            }

            // Обработка ввода через запятую (упрощенный формат: "Имя возраст, Имя возраст")
            // ВАЖНО: Добавляем к уже выбранным участникам, а не заменяем их
            const participantsText = msg.text.trim();
            if (participantsText.includes(',')) {
                const parts = participantsText.split(',').map(p => p.trim()).filter(p => p);
                
                if (parts.length === 0) {
                    return bot.sendMessage(chatId,
                        '❌ Неверный формат. Введите имена и возрасты через запятую.\n' +
                        'Например: Иван 10, Мария 8',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                // Инициализируем selected_participants если его нет
                if (!state.data.selected_participants) {
                    state.data.selected_participants = [];
                }

                const newParticipants = [];
                for (const part of parts) {
                    // Формат: "Имя возраст" - имя и возраст разделены пробелом
                    const match = part.match(/^(.+?)\s+(\d+)$/);
                    if (!match) {
                        return bot.sendMessage(chatId,
                            `❌ Неверный формат для "${part}".\n` +
                            'Укажите в формате: Имя возраст\n' +
                            'Например: Иван 10, Мария 8',
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    const name = match[1].trim();
                    const age = parseInt(match[2]);
                    
                    if (!name || isNaN(age) || age < 0 || age > 120) {
                        return bot.sendMessage(chatId,
                            `❌ Неверный возраст для "${name}". Возраст должен быть от 0 до 120 лет.`,
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Проверяем, не добавлен ли уже участник с таким именем и возрастом
                    const isDuplicate = state.data.selected_participants.some(p => 
                        p.fullName.trim().toLowerCase() === name.trim().toLowerCase() && 
                        Math.abs(p.age - age) <= 1
                    );

                    if (!isDuplicate) {
                        const currentYear = moment().year();
                        newParticipants.push({
                            fullName: name,
                            birthYear: currentYear - age,
                            age: age
                        });
                    }
                }

                // Добавляем новых участников к уже выбранным
                state.data.selected_participants = [...state.data.selected_participants, ...newParticipants];
                userStates.set(chatId, state);

                // Показываем обновленный список участников
                return showParticipantsList(chatId, state);
            }

            // Если текст не содержит запятую и не является кнопкой, возможно это просто имя с возрастом
            // ВАЖНО: Добавляем к уже выбранным участникам
            const singleMatch = msg.text.match(/^(.+?)\s+(\d+)$/);
            if (singleMatch) {
                const name = singleMatch[1].trim();
                const age = parseInt(singleMatch[2]);
                
                if (!isNaN(age) && age >= 0 && age <= 120) {
                    // Инициализируем selected_participants если его нет
                    if (!state.data.selected_participants) {
                        state.data.selected_participants = [];
                    }

                    // Проверяем, не добавлен ли уже участник с таким именем и возрастом
                    const isDuplicate = state.data.selected_participants.some(p => 
                        p.fullName.trim().toLowerCase() === name.trim().toLowerCase() && 
                        Math.abs(p.age - age) <= 1
                    );

                    if (!isDuplicate) {
                        const currentYear = moment().year();
                        state.data.selected_participants.push({
                            fullName: name,
                            birthYear: currentYear - age,
                            age: age
                        });
                        userStates.set(chatId, state);
                        return showParticipantsList(chatId, state);
                    } else {
                        return bot.sendMessage(chatId,
                            `⚠️ Участник "${name} (${age})" уже добавлен в список.`,
                            {
                                reply_markup: {
                                    keyboard: [['🔙 Назад']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }
                }
            }

            return bot.sendMessage(chatId,
                '❌ Введите имена и возрасты участников через запятую.\n' +
                'Например: Иван 10, Мария 8\n\n' +
                'Или выберите участников из списка кнопками.',
                {
                    reply_markup: {
                        keyboard: [
                            ['👤 Себя'],
                            ...(state.data.children || []).map(child => {
                                const age = moment().diff(moment(child.birth_date), 'years');
                                return [`👶 ${child.full_name} (${age})`];
                            }),
                            ['✅ Все указано, продолжить'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'kuliga_group_existing_participants': {
            if (msg.text === '🔙 Назад') {
                state.step = 'kuliga_group_existing_time';
                userStates.set(chatId, state);
                // Показываем список тренировок на выбранную дату снова
                // ВАЖНО: Исключаем приватные тренировки (is_private = TRUE)
                const trainingsResult = await pool.query(
                    `SELECT kgt.id, kgt.start_time, kgt.end_time, kgt.sport_type, kgt.level,
                            kgt.price_per_person, kgt.max_participants, kgt.current_participants,
                            kgt.description, ki.full_name as instructor_name
                     FROM kuliga_group_trainings kgt
                     JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
                     WHERE kgt.date = $1
                       AND kgt.status IN ('open', 'confirmed')
                       AND kgt.is_private = FALSE
                       AND kgt.current_participants < kgt.max_participants
                       AND ki.is_active = TRUE
                     ORDER BY kgt.start_time`,
                    [state.data.selected_date]
                );

                const trainings = trainingsResult.rows;
                const timeButtons = trainings.map(training => {
                    const timeStr = String(training.start_time).substring(0, 5);
                    const endTimeStr = String(training.end_time).substring(0, 5);
                    const sportType = training.sport_type === 'ski' ? '⛷️' : '🏂';
                    const freePlaces = training.max_participants - training.current_participants;
                    return [`${timeStr} - ${endTimeStr} ${sportType} (${freePlaces} мест)`];
                });
                timeButtons.push(['🔙 Назад']);

                return bot.sendMessage(chatId,
                    '⏰ *Выберите время групповой тренировки*',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: timeButtons,
                            resize_keyboard: true
                        }
                    }
                );
            }

            // Обработка выбора участника
            if (msg.text === '👤 Себя') {
                // Получаем данные клиента
                const clientResult = await pool.query(
                    'SELECT id, full_name, birth_date FROM clients WHERE id = $1',
                    [state.data.client_id]
                );

                if (!clientResult.rows[0]) {
                    return bot.sendMessage(chatId, '❌ Клиент не найден.');
                }

                const client = clientResult.rows[0];
                const age = moment().diff(moment(client.birth_date), 'years');

                state.data.selected_participants = [{
                    fullName: client.full_name,
                    birthYear: moment(client.birth_date).year(),
                    age: age,
                    isSelf: true
                }];

                // Переходим к подтверждению и оплате
                return await confirmAndPayKuligaExistingGroupBooking(chatId, state);
            }

            if (msg.text && msg.text.startsWith('👶 ')) {
                const childName = msg.text.replace('👶 ', '').split(' (')[0];
                const child = state.data.children.find(c => c.full_name === childName);
                
                if (!child) {
                    return bot.sendMessage(chatId, '❌ Ребенок не найден. Выберите из списка.');
                }

                const age = moment().diff(moment(child.birth_date), 'years');
                state.data.selected_participants = [{
                    fullName: child.full_name,
                    birthYear: moment(child.birth_date).year(),
                    age: age,
                    childId: child.id
                }];

                // Переходим к подтверждению и оплате
                return await confirmAndPayKuligaExistingGroupBooking(chatId, state);
            }

            return bot.sendMessage(chatId,
                '❌ Пожалуйста, выберите участника из предложенных вариантов.',
                {
                    reply_markup: {
                        keyboard: [
                            ['👤 Себя'],
                            ...(state.data.children || []).map(child => {
                                const age = moment().diff(moment(child.birth_date), 'years');
                                return [`👶 ${child.full_name} (${age} лет)`];
                            }),
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'kuliga_group_own_confirm': {
            if (msg.text === '🔙 Назад') {
                state.step = 'kuliga_group_own_participants';
                userStates.set(chatId, state);
                // Показываем список участников снова
                const childrenResult = await pool.query(
                    'SELECT id, full_name, birth_date FROM children WHERE parent_id = $1 ORDER BY birth_date',
                    [state.data.client_id]
                );
                const children = childrenResult.rows;
                
                if (children.length > 0) {
                    const childButtons = [];
                    children.forEach((child, index) => {
                        const age = moment().diff(moment(child.birth_date), 'years');
                        const isSelected = state.data.selected_participants.find(p => p.childId === child.id);
                        const buttonText = isSelected 
                            ? `✅ ${child.full_name} (${age} лет)` 
                            : `👶 ${child.full_name} (${age} лет)`;
                        
                        if (index % 2 === 0) {
                            childButtons.push([buttonText]);
                        } else {
                            childButtons[childButtons.length - 1].push(buttonText);
                        }
                    });
                    childButtons.push(['✅ Все указано, продолжить']);
                    childButtons.push(['🔙 Назад']);

                    return bot.sendMessage(chatId,
                        '👥 *Укажите участников групповой тренировки*\n\n' +
                        'Вы можете выбрать из зарегистрированных детей или ввести через запятую.',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: childButtons,
                                resize_keyboard: true
                            }
                        }
                    );
                }
            }

            if (msg.text === '✅ Подтвердить и оплатить') {
                // Создаем бронирование через API или напрямую в БД
                return await createKuligaOwnGroupBooking(chatId, state);
            }

            return bot.sendMessage(chatId,
                'Пожалуйста, подтвердите бронирование или нажмите "🔙 Назад".',
                {
                    reply_markup: {
                        keyboard: [
                            ['✅ Подтвердить и оплатить'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'kuliga_group_existing_confirm': {
            if (msg.text === '🔙 Назад') {
                state.step = 'kuliga_group_existing_participants';
                userStates.set(chatId, state);
                // Показываем выбор участников снова
                const childrenResult = await pool.query(
                    'SELECT id, full_name, birth_date FROM children WHERE parent_id = $1 ORDER BY birth_date',
                    [state.data.client_id]
                );
                const children = childrenResult.rows;

                const participantButtons = [];
                participantButtons.push(['👤 Себя']);
                children.forEach((child, index) => {
                    const age = moment().diff(moment(child.birth_date), 'years');
                    const buttonText = `👶 ${child.full_name} (${age} лет)`;
                    if (index % 2 === 0) {
                        participantButtons.push([buttonText]);
                    } else {
                        participantButtons[participantButtons.length - 1].push(buttonText);
                    }
                });
                participantButtons.push(['🔙 Назад']);

                return bot.sendMessage(chatId,
                    '👥 *Кого записать на групповую тренировку?*',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: participantButtons,
                            resize_keyboard: true
                        }
                    }
                );
            }

            if (msg.text === '✅ Подтвердить и оплатить') {
                // Создаем бронирование через API
                return await createKuligaExistingGroupBooking(chatId, state);
            }

            return bot.sendMessage(chatId,
                'Пожалуйста, подтвердите бронирование или нажмите "🔙 Назад".',
                {
                    reply_markup: {
                        keyboard: [
                            ['✅ Подтвердить и оплатить'],
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }
        
        case 'natural_slope_participant_selection': {
            if (msg.text === '🔙 Назад') {
                userStates.delete(chatId);
                return showNaturalSlopeTrainingMenu(chatId);
            }
            return bot.sendMessage(chatId, 'Пожалуйста, выберите участника кнопками выше или нажмите "🔙 Назад".');
        }

        case 'natural_slope_individual_sport': {
            if (msg.text === '🔙 Назад') {
                const clientId = state.data?.client_id;
                if (!clientId) {
                    userStates.delete(chatId);
                    return showNaturalSlopeTrainingMenu(chatId);
                }
                const clientResult = await pool.query('SELECT id, full_name, phone FROM clients WHERE id = $1', [clientId]);
                const client = clientResult.rows[0];
                if (!client) {
                    userStates.delete(chatId);
                    return showNaturalSlopeTrainingMenu(chatId);
                }
                return promptNaturalSlopeParticipant(chatId, client);
            }

            if (msg.text === '⛷️ Горные лыжи' || msg.text === '🏂 Сноуборд') {
                state.data = state.data || {};
                // Сохраняем location, если он был установлен ранее
                const existingLocation = state.data.location;
                state.data.selected_sport = msg.text === '🏂 Сноуборд' ? 'snowboard' : 'ski';
                state.data.selected_sport_type = state.data.selected_sport;
                state.data.selected_instructor_id = null;
                state.data.selected_instructor_name = null;
                // Восстанавливаем location, если он был
                if (existingLocation) {
                    state.data.location = existingLocation;
                }
                return promptNaturalSlopeInstructor(chatId, state);
            }

            return bot.sendMessage(chatId, 'Пожалуйста, выберите один из вариантов или нажмите "🔙 Назад".');
        }

        case 'natural_slope_individual_instructor': {
            if (msg.text === '🔙 Назад') {
                return promptNaturalSlopeSport(chatId, state);
            }

            if (msg.text === '🤷 Без разницы') {
                state.data.selected_instructor_id = null;
                state.data.selected_instructor_name = null;
                state.step = 'natural_slope_individual_date_selection';
                userStates.set(chatId, state);
                return showNaturalSlopeAvailableDates(chatId, state.data);
            }

            if (msg.text && msg.text.startsWith('👨‍🏫 ')) {
                const name = msg.text.replace('👨‍🏫 ', '');
                const instructor = (state.data.available_instructors || []).find((inst) => inst.full_name === name);
                if (!instructor) {
                    return bot.sendMessage(chatId, '❌ Инструктор не найден. Выберите из списка или нажмите "🤷 Без разницы".');
                }
                state.data.selected_instructor_id = instructor.id;
                state.data.selected_instructor_name = instructor.full_name;
                state.data.selected_sport = state.data.selected_sport || (instructor.sport_type === 'snowboard' ? 'snowboard' : 'ski');
                state.step = 'natural_slope_individual_date_selection';
                userStates.set(chatId, state);
                return showNaturalSlopeAvailableDates(chatId, state.data);
            }

            return bot.sendMessage(chatId, 'Пожалуйста, выберите инструктора из списка или нажмите "🤷 Без разницы".');
        }

        case 'natural_slope_individual_date_selection': {
            if (msg.text === '🔙 Назад') {
                return promptNaturalSlopeInstructor(chatId, state);
            }
            return bot.sendMessage(chatId, 'Выберите дату с помощью календаря или нажмите "🔙 Назад".');
        }
        
        case 'natural_slope_individual_date_from_calendar': {
            if (msg.text === '🔙 Назад') {
                state.step = 'natural_slope_individual_instructor';
                userStates.set(chatId, state);
                return promptNaturalSlopeInstructor(chatId, state);
            }
            const selectedDate = state.data.selected_date;
            // Проверяем, есть ли расписание на выбранную дату
            const conditions = [
                'ks.date = $1',
                "ks.status = 'available'",
                'ki.is_active = TRUE'
            ];
            const params = [selectedDate];
            if (state.data.selected_instructor_id) {
                conditions.push(`ks.instructor_id = $${params.length + 1}`);
                params.push(state.data.selected_instructor_id);
            } else if (state.data.selected_sport) {
                const sportFilter = state.data.selected_sport === 'snowboard' ? 'snowboard' : 'ski';
                conditions.push(`(ki.sport_type = $${params.length + 1} OR ki.sport_type = 'both')`);
                params.push(sportFilter);
            }
            const scheduleResult = await pool.query(
                `SELECT COUNT(*) as count 
                 FROM kuliga_schedule_slots ks
                 JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
                 WHERE ${conditions.join(' AND ')}`,
                params
            );
            
            if (parseInt(scheduleResult.rows[0].count) === 0) {
                // Нет расписания на эту дату - ищем ближайшие доступные даты
                const nearestDatesResult = await pool.query(
                    `SELECT DISTINCT ks.date 
                     FROM kuliga_schedule_slots ks
                     JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
                     WHERE ks.date > $1 
                       AND ks.status = 'available'
                       AND ki.is_active = TRUE
                       ${state.data.selected_instructor_id ? 'AND ks.instructor_id = $2' : state.data.selected_sport ? "AND (ki.sport_type = $2 OR ki.sport_type = 'both')" : ''}
                     ORDER BY ks.date 
                     LIMIT 3`,
                    state.data.selected_instructor_id
                        ? [selectedDate, state.data.selected_instructor_id]
                        : state.data.selected_sport
                            ? [selectedDate, state.data.selected_sport === 'snowboard' ? 'snowboard' : 'ski']
                            : [selectedDate]
                );
                
                if (nearestDatesResult.rows.length === 0) {
                    return bot.sendMessage(chatId,
                        '❌ *К сожалению, на эту дату нет записи на тренировку.*\n\n' +
                        'Расписание на зимние тренировки пока не создано. Обратитесь к администратору.',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                
                // Форматируем ближайшие даты
                const nearestDates = nearestDatesResult.rows.map(row => formatDateLabel(row.date)).join(', ');
                
                return bot.sendMessage(chatId,
                    `❌ *К сожалению, на эту дату нет записи на тренировку.*\n\n` +
                    `📅 *Ближайшие доступные даты:* ${nearestDates}\n\n` +
                    `Попробуйте выбрать одну из этих дат.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            state.data.selected_date = selectedDate;
            state.step = 'natural_slope_individual_time';
            userStates.set(chatId, state);

            // Показываем доступные временные слоты для выбранной даты
            return showNaturalSlopeTimeSlots(chatId, selectedDate, state.data);
        }

        case 'natural_slope_individual_time': {
            if (msg.text === '🔙 Назад') {
                state.step = 'natural_slope_individual_date_selection';
                userStates.set(chatId, state);
                return showNaturalSlopeAvailableDates(chatId, state.data);
            }
            // Обработка выбора времени
            if (!msg.text || !msg.text.startsWith('⏰ ')) {
                return bot.sendMessage(chatId, 'Пожалуйста, выберите время из предложенных вариантов или нажмите "🔙 Назад".');
            }
            
            // Извлекаем время из формата "⏰ 10:30 (Инструктор)" или "⏰ 10:30"
            const timeText = msg.text.replace('⏰ ', '').trim();
            let selectedTime = timeText.includes('(') ? timeText.split('(')[0].trim() : timeText;
            let instructorNameFromButton = null;
            
            // Извлекаем имя инструктора из скобок, если есть
            const match = timeText.match(/\((.+)\)/);
            if (match) {
                instructorNameFromButton = match[1].trim();
            }
            
            const validTimes = (state && state.data && Array.isArray(state.data.available_times)) ? state.data.available_times : [];
            
            if (!validTimes.includes(selectedTime)) {
                return bot.sendMessage(chatId, '❌ Неверное время. Пожалуйста, выберите из предложенных вариантов.');
            }
            
            // Сохраняем выбранное время
            state.data.selected_time = selectedTime;
            
            // Находим информацию о слоте из available_slots_info
            // Сначала пытаемся найти по времени И имени инструктора (если указано)
            let slotInfo = null;
            if (instructorNameFromButton && state.data.available_slots_info) {
                slotInfo = state.data.available_slots_info.find(slot => 
                    slot.time === selectedTime && slot.instructor_name === instructorNameFromButton
                );
            }
            // Если не нашли по имени, ищем просто по времени (первый подходящий)
            if (!slotInfo && state.data.available_slots_info) {
                slotInfo = state.data.available_slots_info.find(slot => slot.time === selectedTime);
            }
            if (slotInfo) {
                state.data.selected_slot_id = slotInfo.slot_id;
                state.data.selected_instructor_id = slotInfo.instructor_id;
                state.data.selected_instructor_name = slotInfo.instructor_name;
                state.data.selected_sport_type = slotInfo.sport_type;
            } else {
                // Fallback: если available_slots_info нет, пытаемся найти по времени
                console.warn('available_slots_info не найден, используем fallback поиск слота');
                state.data.selected_sport_type = state.data.selected_sport || state.data.selected_sport_type || 'ski';
            }
            
            state.step = 'natural_slope_individual_confirm';
            userStates.set(chatId, state);
            
            // Получаем цену для индивидуальной тренировки
            const priceResult = await pool.query(
                `SELECT price FROM winter_prices 
                 WHERE type = 'individual' AND is_active = true 
                 ORDER BY created_at DESC LIMIT 1`
            );
            
            const price = priceResult.rows.length > 0 ? parseFloat(priceResult.rows[0].price) : 2500;
            
            // Получаем баланс клиента из таблицы wallets
            const balanceResult = await pool.query(
                `SELECT balance FROM wallets WHERE client_id = $1`,
                [state.data.client_id]
            );
            
            const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
            
            // Форматируем дату для отображения
            const date = new Date(state.data.selected_date);
            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
            
            // Показываем подтверждение записи с информацией об инструкторе
            const instructorName = state.data.selected_instructor_name || 'Инструктор';
            const sportType = state.data.selected_sport_type === 'ski' ? 'Горные лыжи 🎿' : 
                             state.data.selected_sport_type === 'snowboard' ? 'Сноуборд 🏂' : 'Горные лыжи 🎿';
            
            return bot.sendMessage(chatId,
                `📋 *Проверьте данные заявки:*\n\n` +
                `*Детали тренировки:*\n` +
                `• ФИО участника: ${state.data.participant_name}\n` +
                `• Тип тренировки: Индивидуальная\n` +
                `• Снаряжение: ${sportType}\n` +
                `• Инструктор: ${instructorName} 👨‍🏫\n` +
                `• Длительность: 60 минут ⏱️\n` +
                `• Дата: ${formattedDate}\n` +
                `• Время: ${selectedTime}\n` +
                `• Место: ${getLocationDisplayName(state.data.location || 'kuliga')}\n` +
                `• Стоимость: ${price.toFixed(2)} руб. 💰\n` +
                `• Ваш баланс: ${balance.toFixed(2)} руб. 💳\n\n` +
                `*Выберите действие:*`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['✅ Записаться'],
                            ['💰 Пополнить баланс'],
                            ['❌ Я передумал']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        case 'natural_slope_individual_confirm': {
            if (msg.text === '🔙 Назад') {
                state.step = 'natural_slope_individual_time';
                userStates.set(chatId, state);
                return showNaturalSlopeTimeSlots(chatId, state.data.selected_date, state.data);
            }
            if (msg.text === '✅ Записаться') {
                // Проверяем баланс из таблицы wallets
                const balanceResult = await pool.query(
                    `SELECT balance FROM wallets WHERE client_id = $1`,
                    [state.data.client_id]
                );
                
                const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
                
                // Получаем цену
                const priceResult = await pool.query(
                    `SELECT price FROM winter_prices 
                     WHERE type = 'individual' AND is_active = true 
                     ORDER BY created_at DESC LIMIT 1`
                );
                
                const price = priceResult.rows.length > 0 ? parseFloat(priceResult.rows[0].price) : 2500;
                
                if (balance < price) {
                    return bot.sendMessage(chatId,
                        `❌ *Недостаточно средств на балансе!*\n\n` +
                        `💰 *Требуется:* ${price.toFixed(2)} руб.\n` +
                        `💳 *Ваш баланс:* ${balance.toFixed(2)} руб.\n` +
                        `📊 *Не хватает:* ${(price - balance).toFixed(2)} руб.\n\n` +
                        `Пополните баланс и попробуйте снова.`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['💰 Пополнить баланс'],
                                    ['🔙 Назад']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                
                // Создаем запись в kuliga_bookings
                const dbClient = await pool.connect();
                try {
                    await dbClient.query('BEGIN');
                    
                    // Получаем slot_id (либо из состояния, либо ищем по дате и времени)
                    let slotId = state.data.selected_slot_id;
                    let instructorId = state.data.selected_instructor_id;
                    
                    if (!slotId) {
                        // Fallback: ищем слот по дате и времени
                    const slotResult = await dbClient.query(
                            `SELECT id, instructor_id, start_time, end_time, sport_type
                             FROM kuliga_schedule_slots 
                             WHERE date = $1 
                               AND start_time::text LIKE $2
                               AND status = 'available'
                             LIMIT 1`,
                            [state.data.selected_date, state.data.selected_time + '%']
                    );
                    
                    if (slotResult.rows.length === 0) {
                            throw new Error('Слот не найден в расписании или уже занят');
                    }
                    
                        slotId = slotResult.rows[0].id;
                        instructorId = slotResult.rows[0].instructor_id;
                        state.data.selected_instructor_id = instructorId;
                    }
                    
                    // Проверяем и блокируем слот
                    const slotCheck = await dbClient.query(
                        `SELECT id, status FROM kuliga_schedule_slots 
                         WHERE id = $1 AND status = 'available'
                         FOR UPDATE`,
                        [slotId]
                    );
                    
                    if (slotCheck.rows.length === 0) {
                        throw new Error('Слот уже занят или не существует');
                    }
                    
                    // Определяем sport_type
                    const sportType = state.data.selected_sport_type || 'ski';
                    const participantName = state.data.participant_name || 'Участник';
                    
                    // МИГРАЦИЯ 033: Используем client_id из состояния (клиент уже зарегистрирован в боте)
                    // При записи через бота клиент всегда должен быть зарегистрирован
                    let kuligaClientId = state.data.client_id;
                    
                    if (!kuligaClientId) {
                        // Fallback: ищем клиента по telegram_id
                        const clientCheck = await dbClient.query(
                            `SELECT id FROM clients WHERE telegram_id = $1 LIMIT 1`,
                            [chatId.toString()]
                        );
                        
                        if (clientCheck.rows.length > 0) {
                            kuligaClientId = clientCheck.rows[0].id;
                        } else {
                            throw new Error('Клиент не найден. Пожалуйста, зарегистрируйтесь в боте через /start');
                        }
                    }
                    
                    // Получаем информацию о слоте для создания бронирования
                    const slotInfo = await dbClient.query(
                        `SELECT date, start_time, end_time, location FROM kuliga_schedule_slots WHERE id = $1`,
                        [slotId]
                    );
                    
                    if (slotInfo.rows.length === 0) {
                        throw new Error('Информация о слоте не найдена');
                    }
                    
                    const slotData = slotInfo.rows[0];
                    
                    // Получаем location из слота или из state
                    const location = slotData.location || state.data.location || 'kuliga';
                    
                    // Получаем price_id из winter_prices
                    const priceInfoResult = await dbClient.query(
                        `SELECT id FROM winter_prices 
                         WHERE type = 'individual' AND is_active = true 
                         ORDER BY created_at DESC LIMIT 1`
                    );
                    const priceId = priceInfoResult.rows.length > 0 ? priceInfoResult.rows[0].id : null;
                    
                    // Создаем бронирование в kuliga_bookings
                    const bookingResult = await dbClient.query(
                        `INSERT INTO kuliga_bookings (
                            client_id, booking_type, instructor_id, slot_id,
                            date, start_time, end_time, sport_type,
                            participants_count, participants_names, participants_birth_years,
                            price_total, price_per_person, price_id, location,
                            status, notification_method, payer_rides
                        ) VALUES ($1, 'individual', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending', 'telegram', true)
                        RETURNING id`,
                        [
                            kuligaClientId,
                            instructorId,
                            slotId,
                            slotData.date,
                            slotData.start_time,
                            slotData.end_time,
                            sportType,
                            1, // participants_count
                            [participantName], // participants_names - передаем массив напрямую
                            [null], // participants_birth_years (можно добавить позже) - передаем массив напрямую
                            price, // price_total
                            price, // price_per_person
                            priceId,
                            location, // МИГРАЦИЯ 038: Передаем location
                        ]
                    );
                    
                    const bookingId = bookingResult.rows[0].id;
                    
                    // Обновляем статус слота на 'booked'
                    await dbClient.query(
                        `UPDATE kuliga_schedule_slots 
                         SET status = 'booked', updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [slotId]
                    );
                    
                    // Списываем деньги с баланса
                    await dbClient.query(
                        `UPDATE wallets 
                         SET balance = balance - $1 
                         WHERE client_id = $2`,
                        [price, state.data.client_id]
                    );
                    
                    // Создаем запись о транзакции
                    const walletResult = await dbClient.query(
                        `SELECT id FROM wallets WHERE client_id = $1`,
                        [state.data.client_id]
                    );
                    
                    if (walletResult.rows.length === 0) {
                        throw new Error('Кошелек клиента не найден');
                    }
                    
                    const walletId = walletResult.rows[0].id;
                    
                    // Форматируем дату для транзакции
                    const transactionDate = new Date(state.data.selected_date);
                    const formattedTransactionDate = `${transactionDate.getDate().toString().padStart(2, '0')}.${(transactionDate.getMonth() + 1).toString().padStart(2, '0')}.${transactionDate.getFullYear()}`;
                    
                    await dbClient.query(
                        `INSERT INTO transactions (
                            wallet_id, amount, type, description, created_at
                        ) VALUES ($1, $2, $3, $4, NOW())`,
                        [
                            walletId,
                            price,
                            'payment',
                            `Индивидуальная тренировка на естественном склоне, ${state.data.participant_name}, Дата: ${formattedTransactionDate}, Время: ${state.data.selected_time}, Длительность: 60 мин.`
                        ]
                    );
                    
                    // Обновляем статус бронирования на 'confirmed' после успешной оплаты из кошелька
                    await dbClient.query(
                        `UPDATE kuliga_bookings 
                         SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [bookingId]
                    );
                    
                    await dbClient.query('COMMIT');
                    
                    // Получаем обновленный баланс после списания
                    const updatedBalanceResult = await pool.query(
                        `SELECT balance FROM wallets WHERE client_id = $1`,
                        [state.data.client_id]
                    );
                    const updatedBalance = parseFloat(updatedBalanceResult.rows[0]?.balance || 0);
                    
                    // Получаем данные клиента для уведомления
                    const clientRes = await pool.query(
                        `SELECT c.*, 
                            EXTRACT(YEAR FROM AGE(CURRENT_DATE, c.birth_date)) as age
                        FROM clients c
                        WHERE c.id = $1`,
                        [state.data.client_id]
                    );
                    const client = clientRes.rows[0];
                    
                    // Получаем данные инструктора для уведомления
                    const instructorRes = await pool.query(
                        `SELECT full_name, telegram_id, admin_percentage
                        FROM kuliga_instructors
                        WHERE id = $1`,
                        [instructorId]
                    );
                    const instructor = instructorRes.rows[0];
                    
                    // Используем уже полученный location
                    const locationName = getLocationDisplayName(location);
                    
                    // Уведомляем админа
                    await notifyAdminNaturalSlopeTrainingBooking({
                        client_name: client.full_name,
                        participant_name: state.data.participant_name,
                        client_phone: client.phone,
                        instructor_name: instructor?.full_name || state.data.selected_instructor_name || 'Не указан',
                        date: state.data.selected_date,
                        time: state.data.selected_time,
                        price: price,
                        location: location,
                        location_name: locationName
                    });
                    
                    // Уведомляем инструктора
                    if (instructor) {
                        await notifyInstructorKuligaTrainingBooking({
                            booking_type: 'individual',
                            client_name: client.full_name,
                            participant_name: state.data.participant_name,
                            client_phone: client.phone,
                            instructor_name: instructor.full_name,
                            instructor_telegram_id: instructor.telegram_id,
                            admin_percentage: instructor.admin_percentage,
                            date: state.data.selected_date,
                            time: state.data.selected_time,
                            price: price,
                            location: location,
                            location_name: locationName
                        });
                    }
                    
                    // Очищаем состояние
                    userStates.delete(chatId);
                    
                    // Форматируем дату для сообщения
                    const date = new Date(state.data.selected_date);
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    
                    // Используем уже полученный location для формирования названия места
                    const finalLocationName = getLocationDisplayName(location);
                    
                    // Отправляем подтверждение
                    return bot.sendMessage(chatId,
                        `✅ Тренировка успешно забронирована!\n\n` +
                        `👤 *Участник:* ${state.data.participant_name}\n` +
                        `📅 *Дата:* ${formattedDate}\n` +
                        `⏰ *Время:* ${state.data.selected_time}\n` +
                        `🏔️ *Место:* ${finalLocationName}\n` +
                        `💰 *Стоимость:* ${price.toFixed(2)} руб.\n` +
                        `💳 *Остаток на балансе:* ${updatedBalance.toFixed(2)} руб.\n\n` +
                        `🎿 *Удачной тренировки!*`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                    
                } catch (error) {
                    await dbClient.query('ROLLBACK');
                    console.error('Ошибка при записи на тренировку:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при записи на тренировку. Попробуйте позже.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                } finally {
                    dbClient.release();
                }
                
            } else if (msg.text === '💰 Пополнить баланс') {
                // Показываем информацию о пополнении баланса
                const clientResult = await pool.query(
                    `SELECT c.*, w.wallet_number, w.balance 
                     FROM clients c 
                     LEFT JOIN wallets w ON c.id = w.client_id 
                     WHERE c.id = $1`,
                    [state.data.client_id]
                );
                
                const client = clientResult.rows[0];
                const walletNumber = client.wallet_number || 'не указан';
                
                return bot.sendMessage(chatId,
                    `💰 *Пополнение баланса*\n\n` +
                    `💳 *Номер кошелька:* \`${walletNumber}\`\n\n` +
                    `📋 *Инструкция:*\n` +
                    `1. Переведите деньги на номер кошелька\n` +
                    `2. В комментарии укажите номер кошелька\n` +
                    `3. Деньги поступят в течение 5 минут\n\n` +
                    `После пополнения вернитесь к записи на тренировку.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🔙 Назад к записи'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
                
            } else if (msg.text === '❌ Я передумал') {
                // Очищаем состояние и возвращаемся в меню
                userStates.delete(chatId);
                return showMainMenu(chatId);
                
            } else if (msg.text === '🔙 Назад к записи') {
                // Возвращаемся к выбору времени
                state.step = 'natural_slope_individual_time';
                userStates.set(chatId, state);
                return showNaturalSlopeTimeSlots(chatId, state.data.selected_date, state.data);
                
            } else {
                return bot.sendMessage(chatId, 'Пожалуйста, выберите действие из предложенных вариантов.');
            }
        }

        // ... rest of the states ...

        default: {
            // Если состояние неизвестно, очищаем его и показываем главное меню
            console.warn('⚠️ Неизвестное состояние:', state?.step, 'для сообщения:', msg.text);
            if (state) {
                userStates.delete(chatId);
            }
            return showMainMenu(chatId);
        }
    }
}

// Заменяем существующие обработчики на новый
bot.on('message', handleMessage);

// Добавляем обработчик callback_query для инлайн-кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const state = userStates.get(chatId);

    try {
        // Выбор даты для зимнего склона (инлайн-календарь)
        if (data && data.startsWith('ns_date:')) {
            const date = data.split(':')[1];
            const st = state || { step: 'natural_slope_individual_time', data: {} };
            st.data = st.data || {};
            st.data.selected_date = date;
            st.step = 'natural_slope_individual_time';
            userStates.set(chatId, st);
            try { await bot.answerCallbackQuery(callbackQuery.id); } catch (_) {}
            // Удаляем сообщение с календарем
            try { await bot.deleteMessage(chatId, callbackQuery.message.message_id); } catch (_) {}
            // Сразу показываем доступные слоты
            return showNaturalSlopeTimeSlots(chatId, date, st.data);
        }
        // Обработка предварительного просмотра дизайна сертификата
        if (data.startsWith('preview_design_')) {
            try {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Генерация превью...'
                });
                
                const [, , designId, nominalValue] = data.split('_');
                
                console.log(`[preview_design] Генерация превью для дизайна ${designId}, номинал ${nominalValue}`);
                
                // Получаем информацию о дизайне из БД
                const designQuery = await pool.query(
                    'SELECT name FROM certificate_designs WHERE id = $1',
                    [parseInt(designId)]
                );
                
                const designName = designQuery.rows[0]?.name || 'Дизайн';
                
                // Используем существующий сервис для генерации изображения
                const certificateJpgGenerator = require('../services/certificateJpgGenerator');
                
                // Генерируем уникальный номер для файла (чтобы избежать конфликтов при одновременных запросах)
                // Но в сертификате отобразим просто "PREVIEW" без цифр
                const uniqueId = Date.now();
                const previewNumberForFile = `PREVIEW_${uniqueId}`;
                const expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
                
                const certificateData = {
                    certificate_number: 'PREVIEW', // Для отображения в сертификате просто "PREVIEW"
                    nominal_value: parseInt(nominalValue),
                    recipient_name: 'Образец',
                    message: 'С днем рождения!',
                    expiry_date: expiryDate,
                    design_id: parseInt(designId)
                };
                
                // Генерируем превью (получаем base64 и HTML)
                const previewPayload = await certificateJpgGenerator.generateCertificatePreview(certificateData);
                
                if (!previewPayload || !previewPayload.imageBase64) {
                    throw new Error('Не удалось сгенерировать изображение: получен пустой результат');
                }
                
                const photoBuffer = Buffer.from(previewPayload.imageBase64, 'base64');
                
                console.log(`[preview_design] Превью дизайна "${designName}" сгенерировано`);
                
                return bot.sendPhoto(chatId, photoBuffer, {
                    caption: `🎨 **Дизайн "${designName}"**\n\nНоминал: ${nominalValue} руб.`,
                    parse_mode: 'Markdown'
                });
                
            } catch (error) {
                console.error('[preview_design] Ошибка при показе превью:', error);
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Ошибка загрузки превью'
                });
                return bot.sendMessage(chatId, '❌ Не удалось загрузить превью. Попробуйте позже.');
            }
        }
        
        // Обработка выбора дизайна сертификата
        if (data.startsWith('select_design_')) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Дизайн выбран! ✅'
            });
            
            const [, , designId, nominalValue] = data.split('_');
            const state = userStates.get(chatId);
            
            if (state && state.step === 'certificate_design_selection') {
                return showRecipientForm(chatId, state.data.client_id, parseInt(nominalValue), parseInt(designId));
            }
            return;
        }

        // Обработка копирования реферальной ссылки (не требует состояния)
        if (data.startsWith('copy_referral_')) {
            const referralCode = data.replace('copy_referral_', '');
            const botUsername = process.env.BOT_USERNAME || 'Ski_Instruktor72_bot';
            const referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
            const botShareLink = `https://t.me/${botUsername}`;
            
            // Проверяем, активна ли реферальная программа
            const referralActiveResult = await pool.query(
                `SELECT bonus_amount FROM bonus_settings 
                 WHERE bonus_type = 'referral' AND is_active = TRUE 
                 ORDER BY created_at DESC LIMIT 1`
            );
            
            const isReferralActive = referralActiveResult.rows.length > 0;
            
            if (isReferralActive) {
                // Реферальная программа активна - показываем реферальную ссылку
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: `Реферальная ссылка скопирована!`,
                    show_alert: false
                });
                
                await bot.sendMessage(chatId, 
                    `🔗 <b>Ваша реферальная ссылка:</b>\n<code>${referralLink}</code>\n\n` +
                    `📋 Нажмите на ссылку, чтобы скопировать её`,
                    { parse_mode: 'HTML' }
                );
            } else {
                // Реферальная программа неактивна - показываем обычную ссылку на бота
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: `Ссылка на бота скопирована!`,
                    show_alert: false
                });
                
                await bot.sendMessage(chatId, 
                    `🔗 <b>Ссылка на бота:</b>\n<code>${botShareLink}</code>\n\n` +
                    `📋 Нажмите на ссылку, чтобы скопировать её`,
                    { parse_mode: 'HTML' }
                );
            }
            return;
        }

        if (!state) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Сессия истекла. Пожалуйста, начните процесс записи заново.',
                show_alert: true
            });
            return showMainMenu(chatId);
        }

        if (data === 'back_to_date') {
            // Возвращаемся к выбору даты
            state.step = 'preferred_date';
            userStates.set(chatId, state);
            await bot.answerCallbackQuery(callbackQuery.id);
            return bot.sendMessage(chatId,
                '📅 *Выберите предпочтительную дату в формате ДД.ММ.ГГГГ:*\n\n' +
                'Например: 25.12.2024',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        if (data === 'booked') {
            // Игнорируем нажатие на занятое время
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Это время уже занято',
                show_alert: true
            });
            return;
        }

        if (data.startsWith('copy_bot_name_')) {
            const botUsername = data.replace('copy_bot_name_', '');
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: `Имя бота скопировано: @${botUsername}`,
                show_alert: true
            });
            return;
        }


        if (data.startsWith('time_')) {
            const [, simulatorId, time] = data.split('_');
            
            try {
                // Получаем баланс клиента для отображения
                const balanceResult = await pool.query(
                    'SELECT balance FROM wallets WHERE client_id = $1',
                    [state.data.client_id]
                );
                const balance = parseFloat(balanceResult.rows[0]?.balance || 0);

                // Получаем информацию о тренажере
                const simulatorResult = await pool.query(
                    'SELECT name FROM simulators WHERE id = $1',
                    [simulatorId]
                );
                const simulatorName = simulatorResult.rows[0].name;

                // Форматируем время в ЧЧ:ММ
                const [hours, minutes] = time.split(':');
                const formattedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;

                // Форматируем дату
                const [year, month, day] = state.data.preferred_date.split('-');
                const formattedDate = `${day}.${month}.${year}`;

                // Получаем информацию об участнике
                let participantName;
                if (state.data.is_child) {
                    participantName = state.data.child_name;
                } else {
                    const clientResult = await pool.query(
                        'SELECT full_name FROM clients WHERE id = $1',
                        [state.data.client_id]
                    );
                    participantName = clientResult.rows[0].full_name;
                }

                // Формируем итоговое сообщение
                let summaryMessage = '📋 *Проверьте данные заявки:*\n\n';
                summaryMessage += '*Детали тренировки:*\n';
                summaryMessage += `• ФИО участника: ${participantName}\n`;
                summaryMessage += `• Тип тренировки: Индивидуальная\n`;
                summaryMessage += `• Снаряжение: ${state.data.equipment_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂'}\n`;
                summaryMessage += `• Тренер: ${state.data.with_trainer ? 'С тренером 👨‍🏫' : 'Без тренера 👤'}\n`;
                summaryMessage += `• Длительность: ${state.data.duration} минут ⏱\n`;
                summaryMessage += `• Дата: ${formattedDate}\n`;
                summaryMessage += `• Время: ${formattedTime}\n`;
                summaryMessage += `• Тренажер: ${simulatorName} (№${simulatorId})\n`;
                summaryMessage += `• Стоимость: ${state.data.price} руб. 💰\n`;
                summaryMessage += `• Ваш баланс: ${balance} руб. 💳\n\n`;

                summaryMessage += 'Выберите действие:';

                // Сохраняем состояние для следующего шага
                state.step = 'confirm_booking';
                state.data.preferred_time = time;
                state.data.simulator_id = simulatorId;
                state.data.simulator_name = simulatorName;
                userStates.set(chatId, state);

                // Удаляем сообщение с кнопками
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);

                // Отвечаем на callback-запрос
                await bot.answerCallbackQuery(callbackQuery.id);

                return bot.sendMessage(chatId, summaryMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['✅ Записаться на тренировку'],
                            ['❌ Я передумал'],
                            ['💳 Пополнить баланс']
                        ],
                        resize_keyboard: true
                    }
                });
            } catch (error) {
                console.error('Ошибка при обработке выбора времени:', {
                    error: error.message,
                    stack: error.stack,
                    state: state,
                    data: callbackQuery.data
                });
                
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Произошла ошибка при проверке времени. Пожалуйста, попробуйте позже.',
                    show_alert: true
                });
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при проверке времени. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }

        // Обработка согласия на обработку персональных данных
        if (data === 'consent_agree') {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Согласие принято! ✅'
            });
            
            if (state && state.step === 'privacy_consent') {
                // Согласие будет сохранено автоматически при регистрации клиента в функции registerClient
                // Просто завершаем регистрацию
                await finishRegistration(chatId, state.data);
            }
            return;
        }

        if (data === 'consent_disagree') {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Показываем предупреждение...'
            });
            
            if (state && state.step === 'privacy_consent') {
                await bot.sendMessage(chatId, 
                    '⚠️ *ВНИМАНИЕ!*\n\n' +
                    'Отказ от согласия на обработку персональных данных приведет к прерыванию регистрации.\n\n' +
                    'Все введенные данные будут утрачены:\n' +
                    `• ФИО: ${state.data.full_name}\n` +
                    `• Дата рождения: ${formatDate(state.data.birth_date)}\n` +
                    `• Телефон: ${state.data.phone}\n` +
                    `${state.data.child ? `• Ребенок: ${state.data.child.full_name}\n` : ''}\n` +
                    'Вы точно хотите прервать регистрацию?',
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '❌ Да, прервать регистрацию', callback_data: 'consent_cancel_confirm' },
                                { text: '✅ Нет, вернуться к согласию', callback_data: 'consent_back' }
                            ]]
                        }
                    }
                );
            }
            return;
        }

        if (data === 'consent_cancel_confirm') {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Регистрация прервана'
            });
            
            // Удаляем состояние и возвращаемся в начало
            userStates.delete(chatId);
            await bot.sendMessage(chatId, 
                '❌ Регистрация прервана. Все данные удалены.\n\n' +
                'Для начала новой регистрации используйте команду /start',
                {
                    reply_markup: {
                        keyboard: [[{ text: '🚀 Запуск сервиса Ski-instruktor' }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            return;
        }

        if (data === 'consent_back') {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Возвращаемся к согласию'
            });
            
            if (state && state.step === 'privacy_consent') {
                await showPrivacyConsent(chatId, state.data);
            }
            return;
        }

    } catch (error) {
        console.error('Ошибка при обработке callback-запроса:', error);
        try {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Произошла ошибка. Пожалуйста, попробуйте позже.',
                show_alert: true
            });
        } catch (e) {
            console.error('Ошибка при отправке ответа на callback-запрос:', e);
        }
        return showMainMenu(chatId);
    }
});

async function showMyBookings(chatId) {
    try {
        const client = await getClientByTelegramId(chatId);
        if (!client) {
            await bot.sendMessage(chatId, 'Пожалуйста, сначала зарегистрируйтесь.');
            return;
        }

        // --- Групповые тренировки на тренажере ---
        const groupResult = await pool.query(
            `WITH client_sessions AS (
                SELECT 
                    sp.id,
                    sp.session_id,
                    sp.child_id,
                    COALESCE(c.full_name, cl.full_name) as participant_name,
                    CASE 
                        WHEN c.birth_date IS NOT NULL 
                        THEN (EXTRACT(YEAR FROM AGE(c.birth_date)) < 18)
                        ELSE false
                    END as is_child,
                    c.birth_date as participant_birth_date,
                    ts.session_date,
                    ts.start_time,
                    ts.duration,
                    ts.equipment_type,
                    s.name as simulator_name,
                    g.name as group_name,
                    t.full_name as trainer_name,
                    ts.skill_level,
                    ts.price,
                    ts.max_participants,
                    (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id AND status = 'confirmed') as current_participants,
                    'group' as session_type,
                    'simulator' as slope_type
                FROM session_participants sp
                JOIN training_sessions ts ON sp.session_id = ts.id
                JOIN simulators s ON ts.simulator_id = s.id
                LEFT JOIN groups g ON ts.group_id = g.id
                LEFT JOIN trainers t ON ts.trainer_id = t.id
                LEFT JOIN children c ON sp.child_id = c.id
                JOIN clients cl ON sp.client_id = cl.id
                WHERE sp.client_id = $1
                AND ts.status = 'scheduled'
                AND sp.status = 'confirmed'
                AND ts.simulator_id IS NOT NULL
                AND (
                  (ts.session_date::timestamp + ts.start_time::interval + (ts.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
                )
            )
            SELECT * FROM client_sessions
            ORDER BY session_date, start_time`,
            [client.id]
        );

        // --- Групповые тренировки на естественном склоне ---
        const winterGroupResult = await pool.query(
            `SELECT 
                sp.id,
                sp.session_id,
                sp.child_id,
                COALESCE(c.full_name, cl.full_name) as participant_name,
                ts.session_date,
                ts.start_time,
                ts.duration,
                ts.equipment_type,
                NULL as simulator_name,
                g.name as group_name,
                t.full_name as trainer_name,
                ts.skill_level,
                ts.price,
                ts.max_participants,
                (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id AND status = 'confirmed') as current_participants,
                'group_winter' as session_type,
                'natural_slope' as slope_type,
                CASE WHEN nsu.id IS NOT NULL THEN true ELSE false END as used_subscription,
                st.name as subscription_name,
                ns.remaining_sessions as subscription_remaining_sessions,
                st.sessions_count as subscription_total_sessions
            FROM session_participants sp
            JOIN training_sessions ts ON sp.session_id = ts.id
            LEFT JOIN groups g ON ts.group_id = g.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN children c ON sp.child_id = c.id
            JOIN clients cl ON sp.client_id = cl.id
            LEFT JOIN natural_slope_subscription_usage nsu ON nsu.session_participant_id = sp.id
            LEFT JOIN natural_slope_subscriptions ns ON nsu.subscription_id = ns.id
            LEFT JOIN natural_slope_subscription_types st ON ns.subscription_type_id = st.id
            WHERE sp.client_id = $1
            AND ts.status = 'scheduled'
            AND sp.status = 'confirmed'
            AND ts.simulator_id IS NULL
            AND ts.group_id IS NOT NULL
            AND (
              (ts.session_date::timestamp + ts.start_time::interval + (ts.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
            )
            ORDER BY ts.session_date, ts.start_time`,
            [client.id]
        );

        // --- Индивидуальные тренировки тренажера ---
        const individualResult = await pool.query(
            `SELECT 
                its.id,
                its.child_id,
                its.simulator_id,
                COALESCE(ch.full_name, cl.full_name) as participant_name,
                its.preferred_date as session_date,
                its.preferred_time as start_time,
                (its.preferred_time + (its.duration || ' minutes')::interval)::time as end_time,
                its.duration,
                its.equipment_type,
                s.name as simulator_name,
                NULL as group_name,
                NULL as trainer_name,
                NULL as skill_level,
                its.price,
                1 as max_participants,
                1 as current_participants,
                'individual_simulator' as session_type,
                its.with_trainer,
                'simulator' as slope_type
            FROM individual_training_sessions its
            JOIN simulators s ON its.simulator_id = s.id
            LEFT JOIN children ch ON its.child_id = ch.id
            JOIN clients cl ON its.client_id = cl.id
            WHERE (its.client_id = $1 OR ch.parent_id = $1)
            AND (its.preferred_date::timestamp + its.preferred_time::interval + (its.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
            ORDER BY its.preferred_date, its.preferred_time`,
            [client.id]
        );

        // --- Индивидуальные тренировки естественного склона ---
        const naturalSlopeIndividualResult = await pool.query(
            `SELECT 
                sp.id,
                sp.session_id,
                sp.child_id,
                COALESCE(c.full_name, cl.full_name) as participant_name,
                ts.session_date,
                ts.start_time,
                ts.end_time,
                ts.duration,
                ts.equipment_type,
                NULL as simulator_name,
                NULL as group_name,
                t.full_name as trainer_name,
                NULL as skill_level,
                ts.price,
                1 as max_participants,
                1 as current_participants,
                'individual_natural_slope' as session_type,
                ts.with_trainer,
                'natural_slope' as slope_type
            FROM session_participants sp
            JOIN training_sessions ts ON sp.session_id = ts.id
            LEFT JOIN trainers t ON ts.trainer_id = t.id
            LEFT JOIN children c ON sp.child_id = c.id
            JOIN clients cl ON sp.client_id = cl.id
            WHERE sp.client_id = $1
            AND ts.status = 'scheduled'
            AND sp.status = 'confirmed'
            AND ts.training_type = FALSE
            AND ts.slope_type = 'natural_slope'
            AND (
              (ts.session_date::timestamp + ts.start_time::interval + (ts.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
            )
            ORDER BY ts.session_date, ts.start_time`,
            [client.id]
        );

        // --- Зимние тренировки Кулиги (kuliga_bookings) ---
        const kuligaBookingsResult = await pool.query(
            `SELECT 
                kb.id,
                kb.booking_type,
                kb.instructor_id,
                kb.slot_id,
                kb.group_training_id,
                kb.date,
                kb.start_time,
                kb.end_time,
                kb.sport_type,
                kb.participants_count,
                kb.participants_names,
                kb.price_total,
                kb.price_per_person,
                kb.status,
                ki.full_name as instructor_name,
                kc.phone as client_phone,
                kgt.level as group_name,
                kgt.description as group_description
            FROM kuliga_bookings kb
            JOIN clients kc ON kb.client_id = kc.id
            LEFT JOIN kuliga_instructors ki ON kb.instructor_id = ki.id
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            WHERE kc.telegram_id = $1
              AND kb.status IN ('pending', 'confirmed')
              AND (kb.date::timestamp + kb.end_time::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
            ORDER BY kb.date, kb.start_time`,
            [chatId.toString()]
        );

        // --- Формируем общий список ---
        const groupSessions = groupResult.rows;
        const winterGroupSessions = winterGroupResult.rows;
        const individualSessions = individualResult.rows;
        const naturalSlopeIndividualSessions = naturalSlopeIndividualResult.rows;
        const kuligaBookings = kuligaBookingsResult.rows;
        
        if (groupSessions.length === 0 && winterGroupSessions.length === 0 && individualSessions.length === 0 && naturalSlopeIndividualSessions.length === 0 && kuligaBookings.length === 0) {
            await bot.sendMessage(chatId, 'У вас пока нет записей на тренировки.', {
                reply_markup: {
                    keyboard: [['🔙 В главное меню']],
                    resize_keyboard: true
                }
            });
            return;
        }

        let message = `📋 *Ваши записи на тренировки:*\n\n`;
        let allSessions = [];
        let counter = 1;
        
        if (groupSessions.length > 0) {
            message += '\n👥 *Групповые тренировки (тренажер):*\n';
            groupSessions.forEach(session => {
                const date = new Date(session.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = session.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;
                const participantDisplayName = session.is_child 
                    ? `${session.participant_name} (ребенок)` 
                    : session.participant_name;
                message += `\n${counter}. 👤 *Участник:* ${participantDisplayName}\n`;
                message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${formattedTime}\n`;
                message += `👥 *Группа:* ${session.group_name}\n`;
                message += `🎿 *Тренажер:* ${session.simulator_name}\n`;
                if (session.trainer_name) message += `👨‍🏫 *Тренер:* ${session.trainer_name}\n`;
                if (session.skill_level) message += `📊 *Уровень:* ${session.skill_level}\n`;
                message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n`;
                allSessions.push({ ...session, session_type: 'group' });
                counter++;
            });
        }
        
        if (winterGroupSessions.length > 0) {
            // Группируем по location
            const groupedByLocation = {};
            winterGroupSessions.forEach(session => {
                const loc = session.location || 'kuliga';
                if (!groupedByLocation[loc]) {
                    groupedByLocation[loc] = [];
                }
                groupedByLocation[loc].push(session);
            });
            
            Object.entries(groupedByLocation).forEach(([loc, sessions]) => {
                const locationName = getLocationDisplayName(loc);
                message += `\n👥 *Групповые тренировки (${locationName}):*\n`;
                sessions.forEach(session => {
                const date = new Date(session.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = session.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;
                const pricePerPerson = session.max_participants ? (Number(session.price) / session.max_participants).toFixed(2) : Number(session.price).toFixed(2);
                const participantDisplayName = session.is_child 
                    ? `${session.participant_name} (ребенок)` 
                    : session.participant_name;
                message += `\n${counter}. 👤 *Участник:* ${participantDisplayName}\n`;
                message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${formattedTime}\n`;
                message += `👥 *Группа:* ${session.group_name}\n`;
                if (session.trainer_name) message += `👨‍🏫 *Тренер:* ${session.trainer_name}\n`;
                if (session.skill_level) message += `📊 *Уровень:* ${session.skill_level}\n`;
                const sessionLocation = session.location || loc;
                message += `🏔️ *Место:* ${getLocationDisplayName(sessionLocation)}\n`;
                if (session.used_subscription) {
                    message += `🎫 *Оплата:* По абонементу "${session.subscription_name}"\n`;
                    if (session.subscription_remaining_sessions != null && session.subscription_total_sessions != null) {
                        message += `📊 *Занятий осталось:* ${session.subscription_remaining_sessions}/${session.subscription_total_sessions}\n`;
                    }
                } else {
                    message += `💰 *Стоимость:* ${pricePerPerson} руб.\n`;
                }
                allSessions.push({ ...session, session_type: 'group_winter' });
                counter++;
            });
            });
        }
        
        if (individualSessions.length > 0) {
            message += '\n👤 *Индивидуальные тренировки (тренажер):*\n';
            individualSessions.forEach(session => {
                const date = new Date(session.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = session.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;
                const participantDisplayName = session.is_child 
                    ? `${session.participant_name} (ребенок)` 
                    : session.participant_name;
                message += `\n${counter}. 👤 *Участник:* ${participantDisplayName}\n`;
                message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${formattedTime}\n`;
                message += `🎿 *Снаряжение:* ${session.equipment_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂'}\n`;
                message += `👨‍🏫 *${session.with_trainer ? 'С тренером' : 'Без тренера'}*\n`;
                message += `🎿 *Тренажер:* ${session.simulator_name}\n`;
                message += `⏱ *Длительность:* ${session.duration} мин\n`;
                message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n`;
                allSessions.push({ ...session, session_type: 'individual_simulator' });
                counter++;
            });
        }
        
        if (naturalSlopeIndividualSessions.length > 0) {
            message += '\n🏔️ *Индивидуальные тренировки (естественный склон):*\n';
            naturalSlopeIndividualSessions.forEach(session => {
                const date = new Date(session.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = session.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;
                const participantDisplayName = session.is_child 
                    ? `${session.participant_name} (ребенок)` 
                    : session.participant_name;
                message += `\n${counter}. 👤 *Участник:* ${participantDisplayName}\n`;
                message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${formattedTime}\n`;
                message += `🎿 *Снаряжение:* Горные лыжи 🎿\n`;
                message += `👨‍🏫 *С тренером*\n`;
                const sessionLocation = session.location || 'kuliga';
                message += `🏔️ *Место:* ${getLocationDisplayName(sessionLocation)}\n`;
                message += `⏱ *Длительность:* ${session.duration} мин\n`;
                message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n`;
                allSessions.push({ ...session, session_type: 'individual_natural_slope' });
                counter++;
            });
        }
        
        // --- Зимние тренировки Кулиги (kuliga_bookings) ---
        if (kuligaBookings.length > 0) {
            // Разделяем на индивидуальные и групповые
            const kuligaIndividual = kuligaBookings.filter(b => b.booking_type === 'individual');
            const kuligaGroup = kuligaBookings.filter(b => b.booking_type === 'group');
            
            if (kuligaIndividual.length > 0) {
                // Группируем по location
                const groupedByLocation = {};
                kuligaIndividual.forEach(booking => {
                    const loc = booking.location || 'kuliga';
                    if (!groupedByLocation[loc]) {
                        groupedByLocation[loc] = [];
                    }
                    groupedByLocation[loc].push(booking);
                });
                
                Object.entries(groupedByLocation).forEach(([loc, bookings]) => {
                    const locationName = getLocationDisplayName(loc);
                    message += `\n🏔️ *Индивидуальные тренировки (${locationName}):*\n`;
                    bookings.forEach(booking => {
                        const date = new Date(booking.date);
                        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                        const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                        const [hours, minutes] = booking.start_time.split(':');
                        const formattedTime = `${hours}:${minutes}`;
                        const participantName = booking.participants_names && booking.participants_names[0] 
                            ? booking.participants_names[0] 
                            : 'Участник';
                        const sportType = booking.sport_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂';
                        
                        message += `\n${counter}. 👤 *${participantName}*\n`;
                        message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                        message += `⏰ *Время:* ${formattedTime}\n`;
                        message += `🎿 *Снаряжение:* ${sportType}\n`;
                        if (booking.instructor_name) {
                            message += `👨‍🏫 *Инструктор:* ${booking.instructor_name}\n`;
                        }
                        const bookingLocation = booking.location || loc;
                        message += `🏔️ *Место:* ${getLocationDisplayName(bookingLocation)}\n`;
                        message += `💰 *Стоимость:* ${Number(booking.price_total).toFixed(2)} руб.\n`;
                        allSessions.push({ 
                            ...booking, 
                            session_type: 'kuliga_individual',
                            participant_name: participantName
                        });
                        counter++;
                    });
                });
            }
            
            if (kuligaGroup.length > 0) {
                // Группируем по location
                const groupedByLocation = {};
                kuligaGroup.forEach(booking => {
                    const loc = booking.location || 'kuliga';
                    if (!groupedByLocation[loc]) {
                        groupedByLocation[loc] = [];
                    }
                    groupedByLocation[loc].push(booking);
                });
                
                Object.entries(groupedByLocation).forEach(([loc, bookings]) => {
                    const locationName = getLocationDisplayName(loc);
                    message += `\n👥 *Групповые тренировки (${locationName}):*\n`;
                    bookings.forEach(booking => {
                        const date = new Date(booking.date);
                        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                        const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                        const [hours, minutes] = booking.start_time.split(':');
                        const formattedTime = `${hours}:${minutes}`;
                        
                        // Формируем список всех участников
                        const participantsNames = booking.participants_names && Array.isArray(booking.participants_names)
                            ? booking.participants_names.join(', ')
                            : (booking.participants_names || 'Участник');
                        const participantsCount = booking.participants_count || 1;
                        
                        const sportType = booking.sport_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂';
                        
                        // Переводим уровень группы на русский
                        const groupLevelMap = {
                            'beginner': 'Начальный',
                            'intermediate': 'Средний',
                            'advanced': 'Продвинутый'
                        };
                        const groupLevelRu = booking.level ? (groupLevelMap[booking.level.toLowerCase()] || booking.level) : '';
                        
                        message += `\n${counter}. 👤 *Участники (${participantsCount}):* ${participantsNames}\n`;
                        message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                        message += `⏰ *Время:* ${formattedTime}\n`;
                        message += `🎿 *Снаряжение:* ${sportType}\n`;
                        if (groupLevelRu) {
                            message += `👥 *Группа:* ${groupLevelRu}\n`;
                        }
                        const bookingLocation = booking.location || loc;
                        message += `🏔️ *Место:* ${getLocationDisplayName(bookingLocation)}\n`;
                        message += `💰 *Стоимость:*\n`;
                        message += `• За человека: ${Number(booking.price_per_person).toFixed(2)} ₽\n`;
                        message += `• Всего: ${Number(booking.price_total).toFixed(2)} ₽\n`;
                        
                        allSessions.push({ 
                            ...booking, 
                            session_type: 'kuliga_group',
                            participant_name: participantsNames
                        });
                        counter++;
                    });
                });
            }
        }
        
        message += '\nДля отмены тренировки нажмите "Отменить тренировку"';
        // Сохраняем оба списка в состоянии
        userStates.set(chatId, { 
            step: 'view_sessions', 
            data: { 
                client_id: client.id,
                sessions: allSessions 
            } 
        });
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['❌ Отменить тренировку'],
                    ['🔙 В главное меню']
                ],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при получении записей:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при получении записей. Пожалуйста, попробуйте позже.', {
            reply_markup: {
                keyboard: [['🔙 В главное меню']],
                resize_keyboard: true
            }
        });
    }
}

// Функция для выбора, для кого индивидуальная тренировка
async function askIndividualForWhom(chatId, clientId) {
    // Получаем детей клиента
    const childrenResult = await pool.query(
        'SELECT id, full_name FROM children WHERE parent_id = $1',
        [clientId]
    );
    const children = childrenResult.rows;
    // Формируем варианты
    let message = 'Для кого индивидуальная тренировка?';
    const keyboard = [ ['1. Для себя'] ];
    children.forEach((child, idx) => {
        keyboard.push([`${idx + 2}. ${child.full_name}`]);
    });
    // Сохраняем детей в состояние
    userStates.set(chatId, {
        step: 'individual_for_whom',
        data: { client_id: clientId, children }
    });
    await bot.sendMessage(chatId, message, {
        reply_markup: {
            keyboard,
            resize_keyboard: true
        }
    });
}

// Функция для форматирования даты в формат ДД.ММ.ГГГГ
function formatDate(dateStr) {
    if (!dateStr) return '';
    
    // Если дата уже в формате DD.MM.YYYY, возвращаем как есть
    if (typeof dateStr === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
        return dateStr;
    }
    
    // Создаем объект Date из любого входного формата
    let date;
    
    if (dateStr instanceof Date) {
        date = dateStr;
    } else if (typeof dateStr === 'string') {
        // Обрабатываем разные форматы строк
        if (dateStr.includes('T') || dateStr.includes('Z')) {
            // ISO формат: 2026-09-20T15:08:58.000Z
            date = new Date(dateStr);
        } else if (dateStr.includes('-')) {
            // Формат YYYY-MM-DD
            date = new Date(dateStr + 'T00:00:00.000Z');
        } else {
            // Пытаемся парсить как есть
            date = new Date(dateStr);
        }
    } else {
        // Пытаемся создать Date из любого другого типа
        date = new Date(dateStr);
    }
    
    // Проверяем, что дата валидна
    if (isNaN(date.getTime())) {
        console.error('Неверная дата для форматирования:', dateStr);
        return '';
    }
    
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

// Функция для пополнения баланса
async function handleTopUpBalance(chatId, clientId) {
    try {
        const clientResult = await pool.query(
            'SELECT c.id, w.wallet_number, w.balance FROM clients c JOIN wallets w ON c.id = w.client_id WHERE c.id = $1',
            [clientId]
        );

        if (!clientResult.rows[0]) {
            return bot.sendMessage(chatId,
                '❌ Ошибка: кошелек не найден. Пожалуйста, обратитесь в поддержку.',
                {
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        const { wallet_number: walletNumber, balance } = clientResult.rows[0];
        const formattedWalletNumber = formatWalletNumber(walletNumber);
        const formattedBalance = parseFloat(balance).toFixed(2);

        const message = 
            '<b>💳 Пополнение баланса</b>\n\n' +
            `<b>Номер кошелька:</b> <code>${formattedWalletNumber}</code>\n` +
            '⚠️ <b>ВАЖНО:</b> Нажмите на номер кошелька выше, чтобы скопировать его в буфер обмена. При пополнении баланса обязательно вставьте номер кошелька в комментарий к платежу! для автоматического и быстрого пополнения баланса.\n\n' +
            `<b>Текущий баланс:</b> ${formattedBalance} руб.\n\n` +
            '<b>Способы пополнения:</b>\n\n' +
            '1️⃣ <b>Для клиентов Сбербанка:</b>\n' +
            `Переведите необходимую сумму по СБП по ссылке, в комментарии к платежу обязательно укажите номер вашего кошелька:\n${process.env.PAYMENT_LINK}\n\n` +
            '2️⃣ <b>Для клиентов ВТБ и других банков:</b>\n' +
            'Переведите деньги на номер телефона:\n' +
            '<code>+79123924956</code>\n' +
            'Получатель: Тебякин Данила Юрьевич\n\n' +
            '<b>⚠️ Важно:</b>\n' +
            '• В комментарии к платежу <b>обязательно</b> укажите номер вашего кошелька\n' +
            '• Для быстрого копирования номера кошелька просто кликните по нему выше\n\n' +
            '<b>❓ Если деньги не зачислились:</b>\n' +
            '• Для переводов по номеру телефона: если средства не поступили в течение 10-15 минут\n' +
            `Свяжитесь с нами:\n` +
            `• Напишите в Telegram администратору\n` +
            `• Или позвоните по телефону: ${process.env.ADMIN_PHONE}\n\n` +
            'Мы оперативно проверим ваш платеж и зачислим средства на счет!';

        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [['🔙 Назад в меню']],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при пополнении баланса:', error);
        await bot.sendMessage(chatId,
            '❌ Произошла ошибка. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Функция для расчета возраста
function calculateAge(birthDate) {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    
    return age;
}

// Функция для форматирования даты рождения
function formatBirthDate(birthDate) {
    const date = new Date(birthDate);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

// Функция для отображения личного кабинета
async function showPersonalCabinet(chatId) {
    try {
        // Получаем информацию о клиенте
        const clientResult = await pool.query(
            `SELECT c.*, 
                    COALESCE(c.skill_level, 0) as skill_level 
             FROM clients c 
             WHERE c.telegram_id = $1`,
            [chatId]
        );

        if (!clientResult.rows[0]) {
            return bot.sendMessage(chatId,
                '❌ Ошибка: профиль не найден. Пожалуйста, обратитесь в поддержку.',
                {
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        const client = clientResult.rows[0];
        const clientAge = calculateAge(client.birth_date);
        const formattedBirthDate = formatBirthDate(client.birth_date);

        // Получаем статистику тренировок для клиента
        const clientStatsResult = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE training_type = 'individual') as individual_count,
                COUNT(*) FILTER (WHERE training_type = 'group') as group_count
            FROM (
                SELECT 'individual' as training_type
                FROM individual_training_sessions
                WHERE client_id = $1 AND child_id IS NULL
                  AND preferred_date <= CURRENT_DATE
                
                UNION ALL
                
                SELECT 'group' as training_type
                FROM session_participants sp
                JOIN training_sessions ts ON sp.session_id = ts.id
                WHERE sp.client_id = $1 AND sp.is_child = false
                  AND sp.status = 'confirmed'
                  AND ts.session_date <= CURRENT_DATE
            ) t
        `, [client.id]);

        const clientStats = clientStatsResult.rows[0];

        // Получаем количество рефералов
        const referralCountResult = await pool.query(
            `SELECT COUNT(*) as referral_count
             FROM referral_transactions
             WHERE referrer_id = $1`,
            [client.id]
        );
        const referralCount = parseInt(referralCountResult.rows[0].referral_count) || 0;

        // Получаем информацию о детях
        const childrenResult = await pool.query(
            `SELECT c.*, 
                    COALESCE(c.skill_level, 0) as skill_level 
             FROM children c 
             WHERE c.parent_id = $1 
             ORDER BY c.birth_date`,
            [client.id]
        );

        // Получаем статистику тренировок для каждого ребенка
        const childStats = {};
        if (childrenResult.rows.length > 0) {
            for (const child of childrenResult.rows) {
                const childStatsResult = await pool.query(`
                    SELECT 
                        COUNT(*) FILTER (WHERE training_type = 'individual') as individual_count,
                        COUNT(*) FILTER (WHERE training_type = 'group') as group_count
                    FROM (
                        SELECT 'individual' as training_type
                        FROM individual_training_sessions
                        WHERE child_id = $1
                          AND preferred_date <= CURRENT_DATE
                        
                        UNION ALL
                        
                        SELECT 'group' as training_type
                        FROM session_participants sp
                        JOIN training_sessions ts ON sp.session_id = ts.id
                        WHERE sp.child_id = $1
                          AND sp.is_child = true
                          AND sp.status = 'confirmed'
                          AND ts.session_date <= CURRENT_DATE
                    ) t
                `, [child.id]);
                
                childStats[child.id] = childStatsResult.rows[0];
            }
        }

        // Формируем сообщение
        let message = `👤 *Личный кабинет*\n\n`;
        
        // Информация о клиенте
        message += `*Информация о вас:*\n`;
        message += `👤 *ФИО:* ${client.full_name}\n`;
        message += `📅 *Дата рождения:* ${formattedBirthDate} (${clientAge} лет)\n`;
        message += `🎿 *Уровень катания:* ${client.skill_level || 'Не указан'}/5\n`;
        message += `📊 *Статистика тренировок:*\n`;
        message += `   • Индивидуальных: ${clientStats.individual_count || 0}\n`;
        message += `   • Групповых: ${clientStats.group_count || 0}\n`;
        message += `\n👥 *Рефералы:* ${referralCount} чел.\n\n`;

        // Информация о добавленных людях
        if (childrenResult.rows.length > 0) {
            message += `*Информация о добавленных людях:*\n`;
            childrenResult.rows.forEach((child, index) => {
                const childAge = calculateAge(child.birth_date);
                const childBirthDate = formatBirthDate(child.birth_date);
                const stats = childStats[child.id] || { individual_count: 0, group_count: 0 };
                
                message += `\n*Человек ${index + 1}:*\n`;
                message += `👤 *ФИО:* ${child.full_name}\n`;
                message += `📅 *Дата рождения:* ${childBirthDate} (${childAge} лет)\n`;
                message += `🎿 *Уровень катания:* ${child.skill_level || 'Не указан'}/5\n`;
                message += `📊 *Статистика тренировок:*\n`;
                message += `   • Индивидуальных: ${stats.individual_count || 0}\n`;
                message += `   • Групповых: ${stats.group_count || 0}\n`;
            });
        }

        message += `\nВыберите действие:`;

        // Кнопки действий
        const keyboard = [
            ['➕ Добавить человека'],
            ['🔙 Назад в меню']
        ];

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard,
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при отображении личного кабинета:', error);
        await bot.sendMessage(chatId,
            '❌ Произошла ошибка. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Обработка пополнения кошелька
async function handleWalletTopUp(chatId, clientId, amount) {
    try {
        // Получаем данные клиента
        const clientResult = await pool.query(
            'SELECT name, wallet_number, balance FROM clients WHERE id = $1',
            [clientId]
        );

        if (clientResult.rows.length === 0) {
            await bot.sendMessage(chatId, '❌ Клиент не найден');
            return;
        }

        const client = clientResult.rows[0];
        const newBalance = client.balance + amount;

        // Обновляем баланс
        await pool.query(
            'UPDATE clients SET balance = $1 WHERE id = $2',
            [newBalance, clientId]
        );

        // Отправляем уведомление клиенту
        const clientMessage = `
✅ Ваш кошелек пополнен!

💰 Сумма пополнения: ${amount} руб.
💵 Текущий баланс: ${newBalance} руб.
        `;
        await bot.sendMessage(chatId, clientMessage);

        // Отправляем уведомление администратору
        const { notifyAdminWalletRefilled } = require('./admin-notify');
        await notifyAdminWalletRefilled({
            clientName: client.name,
            amount: amount,
            walletNumber: client.wallet_number,
            balance: newBalance
        });

    } catch (error) {
        console.error('Ошибка при пополнении кошелька:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка при пополнении кошелька');
    }
}


// Обработчик команды /help
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const adminPhone = process.env.ADMIN_PHONE || 'не указан';
    await bot.sendMessage(chatId,
        'ℹ️ *Справка по работе с ботом Ski-instruktor*\n\n' +
        '• /start — начать или перезапустить работу с ботом\n\n' +
        '— *Записывайтесь на тренировки, управляйте своими занятиями и балансом прямо в Telegram!*\n\n' +
        '👥 *Групповые тренировки выгоднее!* Если не удалось собрать свою команду, просто оставьте заявку через пункт меню "Записаться на тренировку" → "Предложить тренировку". Мы с радостью поможем вам найти единомышленников и собрать команду мечты! 🏂\n\n' +
            '👤 *В личном кабинете* вы всегда можете добавить друзей, родственников, детей, для удобной записи их на групповые или индивидуальные тренировки.\n\n' +
        '💳 *Пополнение баланса* — легко и просто! Пополняйте счет на любую сумму. Главное — не забудьте указать номер вашего кошелька в комментарии к платежу. Если забыли — не беда, поддержка всегда на связи! 😉\n\n' +
        '🎁 *Подарочные сертификаты* — отличный способ порадовать друга или близкого. Дарите спорт и хорошее настроение!\n\n' +
        `• Если возникли вопросы — пишите или звоните в поддержку: ${adminPhone}\n\n`,
        { parse_mode: 'Markdown' }
    );
});

async function cancelIndividualTraining(sessionId, userId) {
    try {
        console.log(`[cancelIndividualTraining] Начало отмены индивидуальной тренировки ${sessionId} для пользователя ${userId}`);
        
        // Получаем информацию о тренировке
        const session = await IndividualTraining.getById(sessionId);
        if (!session) {
            console.log(`[cancelIndividualTraining] Тренировка ${sessionId} не найдена`);
            throw new Error('Тренировка не найдена');
        }

        console.log(`[cancelIndividualTraining] Информация о тренировке:`, {
            simulator_id: session.simulator_id,
            preferred_date: session.preferred_date,
            preferred_time: session.preferred_time,
            duration: session.duration
        });

        // Проверяем текущий статус слотов
        const slotsBefore = await pool.query(
            `SELECT id, is_booked FROM schedule 
             WHERE simulator_id = $1 
             AND date = $2 
             AND start_time >= $3 
             AND start_time < ($3 + ($4 || ' minutes')::interval)`,
            [session.simulator_id, session.preferred_date, session.preferred_time, session.duration]
        );
        console.log(`[cancelIndividualTraining] Статус слотов до отмены:`, slotsBefore.rows);

        // Удаляем тренировку (это должно вызвать триггер)
        await IndividualTraining.delete(sessionId);
        console.log(`[cancelIndividualTraining] Тренировка ${sessionId} удалена из базы данных`);

        // Проверяем статус слотов после удаления
        const slotsAfter = await pool.query(
            `SELECT id, is_booked FROM schedule 
             WHERE simulator_id = $1 
             AND date = $2 
             AND start_time >= $3 
             AND start_time < ($3 + ($4 || ' minutes')::interval)`,
            [session.simulator_id, session.preferred_date, session.preferred_time, session.duration]
        );
        console.log(`[cancelIndividualTraining] Статус слотов после отмены:`, slotsAfter.rows);

        // Если триггер не сработал, освобождаем слоты вручную
        if (slotsAfter.rows.some(slot => slot.is_booked)) {
            console.log(`[cancelIndividualTraining] Триггер не освободил все слоты, освобождаем вручную`);
            const result = await pool.query(
                `UPDATE schedule 
                 SET is_booked = false 
                 WHERE simulator_id = $1 
                 AND date = $2 
                 AND start_time >= $3 
                 AND start_time < ($3 + ($4 || ' minutes')::interval)
                 RETURNING id`,
                [session.simulator_id, session.preferred_date, session.preferred_time, session.duration]
            );
            console.log(`[cancelIndividualTraining] Освобождено слотов вручную: ${result.rows.length}`);
        }

        // Отправляем уведомление пользователю
        await bot.telegram.sendMessage(
            userId,
            `Ваша индивидуальная тренировка отменена.\nДата: ${formatDate(session.preferred_date)}\nВремя: ${formatTime(session.preferred_time)}\nДлительность: ${session.duration} минут`
        );
        console.log(`[cancelIndividualTraining] Уведомление об отмене отправлено пользователю ${userId}`);

    } catch (error) {
        console.error(`[cancelIndividualTraining] Ошибка при отмене тренировки ${sessionId}:`, error);
        throw error;
    }
}

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С СЕРТИФИКАТАМИ ====================

// Показать меню сертификатов
async function showCertificatesMenu(chatId) {
    try {
        const client = await getClientByTelegramId(chatId.toString());
        if (!client) {
            return bot.sendMessage(chatId, 
                '❌ Для работы с сертификатами необходимо зарегистрироваться в системе.',
                {
                    reply_markup: {
                        keyboard: [['🔙 В главное меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        userStates.set(chatId, {
            step: 'certificates_menu',
            data: { client_id: client.id }
        });

        return bot.sendMessage(chatId,
            '🎁 **СЕРТИФИКАТЫ**\n\n' +
            'Выберите действие:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['💝 Подарить сертификат'],
                        ['🔑 Активировать сертификат'],
                        ['📋 Мои сертификаты'],
                        ['🔙 В главное меню']
                    ],
                    resize_keyboard: true
                }
            }
        );
    } catch (error) {
        console.error('Ошибка при показе меню сертификатов:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Показать ознакомительное сообщение о сертификатах
async function showCertificateIntro(chatId, clientId) {
    try {
        userStates.set(chatId, {
            step: 'certificate_intro',
            data: { client_id: clientId }
        });

        const message = `🎁 **ПОДАРОЧНЫЙ СЕРТИФИКАТ**

Что это такое?
Подарочный сертификат — это возможность подарить близкому человеку незабываемые эмоции от катания на горных лыжах или сноуборде!

Как это работает?
1️⃣ Вы покупаете сертификат на любую сумму
2️⃣ Получаете красивый сертификат и ссылку на него
3️⃣ Дарите сертификат близкому человеку
4️⃣ Получатель активирует сертификат в нашем боте
5️⃣ Средства зачисляются на его кошелек для записи на тренировки

✨ Особенности:
• Сертификат действителен 1 год с момента покупки
• Можно распечатать и подарить лично
• Или просто отправить ссылку в мессенджере
• Активация через наш Telegram бот
• Выбор из 4 красивых дизайнов

Готовы создать идеальный подарок? 🎿`;

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['Да, покупаю!'],
                    ['Вернуться в меню']
                ],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при показе ознакомительного сообщения:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Показать выбор номинала сертификата
async function showNominalSelection(chatId, clientId) {
    try {
        userStates.set(chatId, {
            step: 'certificate_nominal_selection',
            data: { client_id: clientId }
        });

        const message = `💝 <b>ПОДАРИТЬ СЕРТИФИКАТ</b>

⚠️ <b>Важно:</b> Убедитесь, что ваш кошелек пополнен на сумму, которую планируете потратить на сертификат.

Выберите номинал сертификата:

💰 <b>2 500 руб.</b> - Индивидуальная 30 мин без тренера
💰 <b>3 000 руб.</b> - Индивидуальная 30 мин с тренером
💰 <b>5 000 руб.</b> - Индивидуальная 60 мин без тренера
💰 <b>6 000 руб.</b> - Индивидуальная 60 мин с тренером
💰 <b>10 000 руб.</b> - Групповые тренировки 3-4 чел
💰 <b>15 000 руб.</b> - Групповые тренировки 5-6 чел

💳 <b>Произвольная сумма</b> (500-50 000 руб.)`;

        return bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [
                    ['💰 2 500 руб.', '💰 3 000 руб.'],
                    ['💰 5 000 руб.', '💰 6 000 руб.'],
                    ['💰 10 000 руб.', '💰 15 000 руб.'],
                    ['💳 Произвольная сумма'],
                    ['🔙 Назад']
                ],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при показе выбора номинала:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Показать выбор дизайна сертификата
async function showDesignSelection(chatId, clientId, nominalValue) {
    try {
        console.log(`[showDesignSelection] Запрос дизайнов для клиента ${clientId}, номинал: ${nominalValue}`);
        
        // Получаем доступные дизайны напрямую из БД (более надежно)
        let designs;
        try {
            const designsQuery = await pool.query(`
                SELECT id, name, description, image_url, template_url, is_active, sort_order
                FROM certificate_designs
                WHERE is_active = true
                ORDER BY sort_order ASC, name ASC
            `);
            
            designs = designsQuery.rows;
            console.log(`[showDesignSelection] Получено дизайнов из БД: ${designs.length}`);
        } catch (dbError) {
            console.error('[showDesignSelection] Ошибка при получении дизайнов из БД:', dbError);
            
            // Fallback: пробуем через API
            const response = await fetch(`${process.env.BASE_URL || 'http://localhost:8080'}/api/certificates/designs`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${getJWTToken()}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (!result.success || !result.designs) {
                throw new Error('Не удалось получить дизайны сертификатов');
            }
            
            designs = result.designs;
        }

        if (!designs || designs.length === 0) {
            throw new Error('Нет доступных дизайнов сертификатов');
        }

        userStates.set(chatId, {
            step: 'certificate_design_selection',
            data: { client_id: clientId, nominal_value: nominalValue }
        });

        let message = `🎨 **ВЫБЕРИТЕ ДИЗАЙН СЕРТИФИКАТА**

Номинал: **${nominalValue} руб.**

Доступные дизайны:\n\n`;

        const inlineKeyboard = [];
        const keyboard = [];
        
        designs.forEach((design, index) => {
            message += `${index + 1}️⃣ **${design.name}** - ${design.description}\n\n`;
            
            // Inline кнопки только для предварительного просмотра с названием дизайна
            inlineKeyboard.push([
                {
                    text: `👁 Посмотреть ${design.name}`,
                    callback_data: `preview_design_${design.id}_${nominalValue}`
                }
            ]);
            
            // Обычные кнопки для выбора дизайна
            keyboard.push([`${index + 1}️⃣ ${design.name}`]);
        });

        keyboard.push(['🔙 Назад']);

        // Сначала отправляем сообщение с inline кнопками для просмотра
        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        }).then(() => {
            // Затем отправляем сообщение с обычными кнопками для выбора
            return bot.sendMessage(chatId, 'Выберите дизайн кнопками ниже:', {
                reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true
                }
            });
        });
    } catch (error) {
        console.error('[showDesignSelection] Ошибка при показе выбора дизайна:', error);
        console.error('[showDesignSelection] Stack trace:', error.stack);
        return bot.sendMessage(chatId, 
            `❌ Произошла ошибка при загрузке дизайнов.\n\nОшибка: ${error.message}\n\nПопробуйте позже или обратитесь в поддержку.`,
            {
                reply_markup: {
                    keyboard: [
                        ['💰 2 500 руб.', '💰 3 000 руб.'],
                        ['💰 5 000 руб.', '💰 6 000 руб.'],
                        ['💰 10 000 руб.', '💰 15 000 руб.'],
                        ['💳 Произвольная сумма'],
                        ['🔙 Назад']
                    ],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Показать форму данных получателя
async function showRecipientForm(chatId, clientId, nominalValue, designId) {
    try {
        userStates.set(chatId, {
            step: 'certificate_recipient_data',
            data: { 
                client_id: clientId, 
                nominal_value: nominalValue, 
                design_id: designId,
                recipient_data: {}
            }
        });

        const message = `👤 **ДАННЫЕ ПОЛУЧАТЕЛЯ**

Введите данные получателя сертификата (все поля необязательны):

**Кому:**
_Например: Иван Иванов_

**Пожелание (до 30 символов):**
_Например: С днем рождения!_

Отправьте данные в формате:
\`Иван Иванов\`
\`С днем рождения!\`

Или нажмите "Пропустить" для создания сертификата без данных получателя.`;

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['⏭ Пропустить'],
                    ['🔙 Назад']
                ],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при показе формы получателя:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Показать форму ввода email
async function showEmailInputForm(chatId, purchaseData) {
    try {
        // Проверяем, есть ли уже email у клиента
        const clientResult = await pool.query(
            'SELECT email FROM clients WHERE id = $1',
            [purchaseData.client_id]
        );
        const existingEmail = clientResult.rows[0]?.email;

        userStates.set(chatId, {
            step: 'certificate_email_input',
            data: purchaseData
        });

        let message = `📧 **ЭЛЕКТРОННАЯ ПОЧТА**

Для отправки сертификата на вашу почту, пожалуйста, укажите email адрес:`;

        if (existingEmail) {
            message += `\n\n💡 **Текущий email в профиле:** ${existingEmail}\n\nВы можете оставить текущий email или указать другой.`;
        }

        message += `\n\n**Пример:** example@mail.ru

После покупки сертификат можно будет открыть по уникальной ссылке в меню "📋 Мои сертификаты".

Или нажмите "⏭ Пропустить", если не хотите указывать email.`;

        const keyboard = [
            ['⏭ Пропустить'],
            ['🔙 Назад']
        ];
        
        if (existingEmail) {
            keyboard.unshift([`Использовать: ${existingEmail}`]);
        }

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: keyboard,
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при показе формы email:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Показать подтверждение покупки
async function showPurchaseConfirmation(chatId, purchaseData) {
    try {
        // Получаем информацию о клиенте и его кошельке
        const client = await pool.query(
            `SELECT c.full_name, w.balance, w.wallet_number
             FROM clients c
             LEFT JOIN wallets w ON c.id = w.client_id
             WHERE c.id = $1`,
            [purchaseData.client_id]
        );

        if (client.rows.length === 0) {
            return bot.sendMessage(chatId, '❌ Клиент не найден.');
        }

        const clientData = client.rows[0];
        const balance = parseFloat(clientData.balance) || 0;

        // Получаем информацию о дизайне
        const designQuery = await pool.query(
            'SELECT name FROM certificate_designs WHERE id = $1',
            [purchaseData.design_id]
        );
        const designName = designQuery.rows[0]?.name || 'Неизвестный дизайн';

        userStates.set(chatId, {
            step: 'certificate_purchase_confirmation',
            data: purchaseData
        });

        // СНАЧАЛА ОТПРАВЛЯЕМ ПРЕДПРОСМОТР В ВИДЕ ИЗОБРАЖЕНИЯ
        try {
            console.log(`[showPurchaseConfirmation] Генерация превью для подтверждения покупки`);
            
            const certificateJpgGenerator = require('../services/certificateJpgGenerator');
            
            // Генерируем уникальный номер для файла (чтобы избежать конфликтов)
            // Но в сертификате отобразим просто "PREVIEW" без цифр
            const uniqueId = Date.now();
            const previewNumberForFile = `PREVIEW_${uniqueId}`;
            const expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
            
            const certificateData = {
                certificate_number: 'PREVIEW', // Для отображения в сертификате просто "PREVIEW"
                nominal_value: purchaseData.nominal_value,
                recipient_name: purchaseData.recipient_name || null,
                message: purchaseData.message || null,
                expiry_date: expiryDate,
                design_id: purchaseData.design_id
            };
            
            const previewPayload = await certificateJpgGenerator.generateCertificatePreview(certificateData);
            
            if (!previewPayload || !previewPayload.imageBase64) {
                throw new Error('Не удалось сгенерировать изображение: получен пустой результат');
            }
            
            const photoBuffer = Buffer.from(previewPayload.imageBase64, 'base64');
            
            await bot.sendPhoto(chatId, photoBuffer, {
                caption: '👁 **ПРЕДВАРИТЕЛЬНЫЙ ПРОСМОТР**',
                parse_mode: 'Markdown'
            });
            
            console.log(`[showPurchaseConfirmation] Предпросмотр отправлен`);
        } catch (previewError) {
            console.error('[showPurchaseConfirmation] Ошибка при генерации превью:', previewError);
            // Продолжаем дальше, даже если превью не удалось
        }

        // ЗАТЕМ ОТПРАВЛЯЕМ ТЕКСТ ПОДТВЕРЖДЕНИЯ
        let message = `❗️ **ПОДТВЕРДИТЕ ПОКУПКУ НАЖАВ КНОПКУ НИЖЕ "Купить сертификат"**

**Номинал:** ${purchaseData.nominal_value} руб.
**Дизайн:** ${designName}`;

        if (purchaseData.recipient_name) {
            message += `\n**Кому:** ${purchaseData.recipient_name}`;
        }
        if (purchaseData.message) {
            message += `\n**Пожелание:** ${purchaseData.message}`;
        }

        message += `\n\n💰 **Стоимость:** ${purchaseData.nominal_value} руб.
💳 **Баланс кошелька:** ${balance} руб.`;

        if (balance >= purchaseData.nominal_value) {
            message += `\n💵 **Остаток после покупки:** ${(balance - purchaseData.nominal_value).toFixed(2)} руб.`;
            
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['✅ Купить сертификат'],
                        ['❌ Отменить', '🔙 Назад']
                    ],
                    resize_keyboard: true
                }
            });
        } else {
            message += `\n\n❌ **Недостаточно средств!**
Необходимо пополнить кошелек на ${(purchaseData.nominal_value - balance).toFixed(2)} руб.`;
            
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['💰 Пополнить кошелек'],
                        ['❌ Отменить', '🔙 Назад']
                    ],
                    resize_keyboard: true
                }
            });
        }
    } catch (error) {
        console.error('Ошибка при показе подтверждения покупки:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Создать сертификат
async function createCertificate(chatId, purchaseData) {
    console.log(`[createCertificate] Начало создания сертификата для клиента ${purchaseData.client_id}`);
    console.log(`[createCertificate] Данные покупки:`, {
        client_id: purchaseData.client_id,
        nominal_value: purchaseData.nominal_value,
        design_id: purchaseData.design_id,
        recipient_name: purchaseData.recipient_name,
        message: purchaseData.message?.substring(0, 50),
        email: purchaseData.email
    });
    
    try {
        // Обновляем email клиента, если он был указан
        if (purchaseData.email) {
            try {
                // Проверяем текущий email в базе
                const currentEmailResult = await pool.query(
                    'SELECT email FROM clients WHERE id = $1',
                    [purchaseData.client_id]
                );
                const currentEmail = currentEmailResult.rows[0]?.email;
                
                // Обновляем только если новый email отличается от текущего
                if (currentEmail !== purchaseData.email) {
                    await pool.query(
                        'UPDATE clients SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                        [purchaseData.email, purchaseData.client_id]
                    );
                    console.log(`[createCertificate] Email обновлен для клиента ${purchaseData.client_id}: с "${currentEmail || 'не указан'}" на "${purchaseData.email}"`);
                } else {
                    console.log(`[createCertificate] Email для клиента ${purchaseData.client_id} не изменился: ${purchaseData.email}`);
                }
            } catch (emailError) {
                console.error('[createCertificate] Ошибка при обновлении email:', emailError);
                // Продолжаем без обновления email
            }
        }

        const apiUrl = `${process.env.BASE_URL || 'http://localhost:8080'}/api/certificates/purchase`;
        console.log(`[createCertificate] Отправка запроса на API: ${apiUrl}`);
        
        const requestBody = {
            purchaser_id: purchaseData.client_id,
            nominal_value: purchaseData.nominal_value,
            design_id: purchaseData.design_id,
            recipient_name: purchaseData.recipient_name || null,
            message: purchaseData.message || null
        };
        console.log(`[createCertificate] Тело запроса:`, requestBody);
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getJWTToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                purchaser_id: purchaseData.client_id,
                nominal_value: purchaseData.nominal_value,
                design_id: purchaseData.design_id,
                recipient_name: purchaseData.recipient_name || null,
                message: purchaseData.message || null
            })
        });

        const result = await response.json();

        if (!result.success) {
            // Очищаем состояние при ошибке
            userStates.delete(chatId);
            
            let errorMessage = '❌ Ошибка при создании сертификата: ';
            switch (result.code) {
                case 'INSUFFICIENT_FUNDS':
                    errorMessage += 'Недостаточно средств на кошельке';
                    break;
                case 'INVALID_NOMINAL':
                    errorMessage += 'Неверный номинал сертификата';
                    break;
                case 'INVALID_DESIGN':
                    errorMessage += 'Неверный дизайн сертификата';
                    break;
                case 'WALLET_NOT_FOUND':
                    errorMessage += 'Кошелек не найден';
                    break;
                default:
                    errorMessage += result.error || 'Неизвестная ошибка';
            }
            
            return bot.sendMessage(chatId, errorMessage, {
                reply_markup: {
                    keyboard: [['🔙 В главное меню']],
                    resize_keyboard: true
                }
            });
        }

        console.log(`[createCertificate] Сертификат успешно создан: номер ${result.certificate?.certificate_number}, ID: ${result.certificate?.id}`);
        
        // Показываем результат успешной покупки (передаем purchaseData для проверки email)
        await showCertificateResult(chatId, result.certificate, purchaseData);
        
        console.log(`[createCertificate] Процесс создания сертификата завершен успешно`);

    } catch (error) {
        // Очищаем состояние при ошибке
        userStates.delete(chatId);
        
        console.error('[createCertificate] ❌ ОШИБКА при создании сертификата:', error);
        console.error('[createCertificate] Stack trace:', error.stack);
        return bot.sendMessage(chatId, '❌ Произошла ошибка при создании сертификата. Попробуйте позже.', {
            reply_markup: {
                keyboard: [['🔙 В главное меню']],
                resize_keyboard: true
            }
        });
    }
}

// Показать результат создания сертификата
async function showCertificateResult(chatId, certificate, purchaseData = null) {
    try {
        // Проверяем наличие email у клиента ПОСЛЕ обновления
        // Сначала проверяем purchaseData.email (если был указан при покупке)
        // Затем проверяем в базе (email мог быть обновлен при создании сертификата)
        let hasEmail = false;
        
        if (purchaseData && purchaseData.email) {
            hasEmail = true;
        } else {
            const clientResult = await pool.query(
                'SELECT email FROM clients WHERE id = $1',
                [certificate.purchaser_id || certificate.client_id]
            );
            hasEmail = clientResult.rows[0]?.email ? true : false;
        }

        const certificateUrl = certificate.certificate_url;
        
        let message = `🎉 <b>СЕРТИФИКАТ УСПЕШНО СОЗДАН!</b>

🎫 <b>Номер сертификата:</b> <code>${certificate.certificate_number}</code>
💰 <b>Номинал:</b> ${certificate.nominal_value} руб.`;

        if (certificate.recipient_name) {
            message += `\n👤 <b>Получатель:</b> ${certificate.recipient_name}`;
        }

        // Добавляем информацию о сроке действия
        const expiryDate = formatDate(certificate.expiry_date);
        message += `\n⏰ <b>Сертификат годен до:</b> ${expiryDate}`;

        // Показываем ссылку на сертификат (можно скопировать)
        message += `\n\n🔗 <b>Ссылка на сертификат:</b>
<code>${certificateUrl}</code>`;

        if (certificate.print_image_url) {
            const printUrl = `${process.env.BASE_URL || 'http://localhost:8080'}${certificate.print_image_url}`;
            message += `\n\n🖨️ <b>Для печати:</b>
<code>${printUrl}</code>`;
        }

        // Информация об email
        if (hasEmail) {
            message += `\n\n📧 Сертификат отправлен на вашу электронную почту.`;
        } else {
            message += `\n\n⚠️ <b>Внимание:</b> Email не указан в вашем профиле. Сертификат не был отправлен на почту.\n\nВы можете использовать ссылку выше для просмотра и печати сертификата.`;
        }

        message += `\n\nВы можете:
📱 Отправить ссылку другу
🖨️ Распечатать сертификат
📋 Посмотреть мои сертификаты`;

        userStates.delete(chatId);

        // Используем inline кнопку для открытия сертификата
        const baseUrl = process.env.BASE_URL || 'https://gornostyle72.ru';
        let inlineKeyboard = [];
        
        // Добавляем кнопку только если не localhost (Telegram не принимает localhost URLs)
        if (!baseUrl.includes('localhost')) {
            inlineKeyboard.push([{
                text: `🔗 Открыть сертификат ${certificate.certificate_number}`,
                url: certificateUrl
            }]);
        }

        return bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: inlineKeyboard.length > 0 ? inlineKeyboard : undefined,
                keyboard: [
                    ['📋 Мои сертификаты'],
                    ['💝 Подарить еще сертификат'],
                    ['🔙 В главное меню']
                ],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при показе результата создания сертификата:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Показать форму активации сертификата
async function showCertificateActivation(chatId, clientId) {
    try {
        userStates.set(chatId, {
            step: 'certificate_activation',
            data: { client_id: clientId }
        });

        const message = `🔑 **АКТИВИРОВАТЬ СЕРТИФИКАТ**

⚠️ **ВАЖНО:** После активации сертификат необходимо использовать в течение 3 месяцев!

Введите номер сертификата (6 цифр):

**Пример:** \`123456\`

Номер сертификата указан на самом сертификате или в ссылке.`;

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['🔙 Назад']
                ],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при показе формы активации:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Активировать сертификат
async function activateCertificate(chatId, certificateNumber, clientId) {
    try {
        const response = await fetch(`${process.env.BASE_URL || 'http://localhost:8080'}/api/certificates/activate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getJWTToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                certificate_number: certificateNumber,
                client_id: clientId
            })
        });

        const result = await response.json();

        if (!result.success) {
            let errorMessage = '❌ Ошибка при активации сертификата: ';
            switch (result.code) {
                case 'CERTIFICATE_NOT_FOUND':
                    errorMessage += 'Сертификат не найден';
                    break;
                case 'ALREADY_ACTIVATED':
                    errorMessage += 'Сертификат уже активирован';
                    break;
                case 'EXPIRED':
                    errorMessage += 'Срок действия сертификата истек';
                    break;
                case 'CLIENT_NOT_FOUND':
                    errorMessage += 'Клиент не найден';
                    break;
                default:
                    errorMessage += result.error || 'Неизвестная ошибка';
            }
            
            return bot.sendMessage(chatId, errorMessage, {
                reply_markup: {
                    keyboard: [
                        ['🔑 Попробовать еще раз'],
                        ['🔙 В главное меню']
                    ],
                    resize_keyboard: true
                }
            });
        }

        // Показываем результат успешной активации
        // Вычисляем дату истечения (3 месяца от активации)
        const activationDate = new Date(result.certificate.activation_date);
        const expiryDate = new Date(activationDate);
        expiryDate.setMonth(expiryDate.getMonth() + 3);
        const formattedExpiryDate = expiryDate.toLocaleDateString('ru-RU');

        const message = `✅ **СЕРТИФИКАТ АКТИВИРОВАН!**

🎫 **Номер:** ${result.certificate.certificate_number}
💰 **Номинал:** ${result.certificate.nominal_value} руб.
💵 **Зачислено на кошелек:** ${result.wallet.amount_added} руб.
💳 **Новый баланс:** ${result.wallet.balance} руб.

⏰ **Использовать до:** ${formattedExpiryDate} включительно

Теперь вы можете записаться на тренировки! 🎿`;

        userStates.delete(chatId);

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['📝 Записаться на тренировку'],
                    ['💰 Кошелек'],
                    ['🔙 В главное меню']
                ],
                resize_keyboard: true
            }
        });

    } catch (error) {
        console.error('Ошибка при активации сертификата:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка при активации сертификата. Попробуйте позже.', {
            reply_markup: {
                keyboard: [['🔙 В главное меню']],
                resize_keyboard: true
            }
        });
    }
}

// Показать сертификаты пользователя
async function showUserCertificates(chatId, clientId) {
    try {
        const response = await fetch(`${process.env.BASE_URL || 'http://localhost:8080'}/api/certificates/user/${clientId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getJWTToken()}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (!result.success) {
            return bot.sendMessage(chatId, '❌ Ошибка при получении сертификатов.', {
                reply_markup: {
                    keyboard: [['🔙 В главное меню']],
                    resize_keyboard: true
                }
            });
        }

        if (result.certificates.length === 0) {
            return bot.sendMessage(chatId, 
                '📋 <b>МОИ СЕРТИФИКАТЫ</b>\n\nУ вас пока нет сертификатов.\n\nВы можете:\n• Подарить сертификат кому-то\n• Активировать полученный сертификат',
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        keyboard: [
                            ['💝 Подарить сертификат'],
                            ['🔑 Активировать сертификат'],
                            ['🔙 В главное меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Группируем сертификаты по типу отношения
        const purchased = result.certificates.filter(cert => cert.relationship_type === 'purchased');
        const activated = result.certificates.filter(cert => cert.relationship_type === 'activated');

        let message = '📋 <b>МОИ СЕРТИФИКАТЫ</b>\n\n';

        if (purchased.length > 0) {
            message += '🎁 <b>ПОДАРЕННЫЕ СЕРТИФИКАТЫ:</b>\n';
            
            // Сортируем по дате покупки (новые сверху)
            purchased.sort((a, b) => new Date(b.purchase_date) - new Date(a.purchase_date));
            
            purchased.forEach(cert => {
                // Логика статусов для дарителя (скрываем информацию об истечении)
                let statusEmoji, statusText;
                if (cert.status === 'used') {
                    statusEmoji = '✅';
                    statusText = 'Использован';
                } else if (cert.activation_date) {
                    statusEmoji = '✅';
                    statusText = 'Активирован';
                } else {
                    // Для дарителя всегда показываем "Подарен", даже если сертификат истек
                    statusEmoji = '🎁';
                    statusText = 'Подарен';
                }
                
                message += `${statusEmoji} <b>${statusText}</b>\n`;
                
                // Номер сертификата как текст для копирования
                message += `🎫 <b>Номер:</b> <code>${cert.certificate_number}</code>\n`;
                message += `💰 ${cert.nominal_value} руб. • 🎨 ${cert.design.name}\n`;
                
                if (cert.recipient_name) {
                    message += `👤 Кому: ${cert.recipient_name}\n`;
                }
                
                const purchaseDate = formatDate(cert.purchase_date);
                message += `📅 Дата покупки: ${purchaseDate}\n`;
                
                if (cert.activation_date) {
                    const activationDate = formatDate(cert.activation_date);
                    message += `🔓 Активирован: ${activationDate}\n`;
                }
                
                // Добавляем ссылку на сертификат (можно скопировать)
                const certificateUrl = `${process.env.BASE_URL || 'https://gornostyle72.ru'}/certificate/${cert.certificate_number}`;
                message += `🔗 <b>Ссылка:</b> <code>${certificateUrl}</code>\n`;
                
                message += '\n';
            });
        }

        if (activated.length > 0) {
            message += '🔑 <b>АКТИВИРОВАННЫЕ СЕРТИФИКАТЫ:</b>\n';
            
            // Сортируем по дате активации (новые сверху)
            activated.sort((a, b) => new Date(b.activation_date) - new Date(a.activation_date));
            
            activated.forEach(cert => {
                const statusEmoji = cert.status === 'used' ? '✅' : '🔓';
                const statusText = cert.status === 'used' ? 'Использован' : 'Активирован';
                
                message += `${statusEmoji} <b>${statusText}</b>\n`;
                
                // Номер сертификата как текст для копирования
                message += `🎫 <b>Номер:</b> <code>${cert.certificate_number}</code>\n`;
                message += `💰 ${cert.nominal_value} руб. • 🎨 ${cert.design.name}\n`;
                
                if (cert.activation_date) {
                    const activationDate = formatDate(cert.activation_date);
                    message += `🔓 Дата активации: ${activationDate}\n`;
                }
                
                // Добавляем ссылку на сертификат (можно скопировать)
                const certificateUrl = `${process.env.BASE_URL || 'https://gornostyle72.ru'}/certificate/${cert.certificate_number}`;
                message += `🔗 <b>Ссылка:</b> <code>${certificateUrl}</code>\n`;
                
                message += '\n';
            });
        }

        userStates.delete(chatId);

        // Собираем все сертификаты для создания inline кнопок
        const allCertificates = [...(purchased || []), ...(activated || [])];
        const inlineKeyboard = [];
        const baseUrl = process.env.BASE_URL || 'https://gornostyle72.ru';
        
        // Создаем inline кнопки для каждого сертификата (максимум по 1 на строку)
        if (!baseUrl.includes('localhost')) {
            allCertificates.forEach(cert => {
                const certUrl = `${baseUrl}/certificate/${cert.certificate_number}`;
                inlineKeyboard.push([{
                    text: `🔗 Открыть сертификат ${cert.certificate_number}`,
                    url: certUrl
                }]);
            });
        }

        return bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: inlineKeyboard.length > 0 ? inlineKeyboard : undefined,
                keyboard: [
                    ['💝 Подарить сертификат'],
                    ['🔑 Активировать сертификат'],
                    ['🔙 В главное меню']
                ],
                resize_keyboard: true
            }
        });

    } catch (error) {
        console.error('Ошибка при получении сертификатов пользователя:', error);
        return bot.sendMessage(chatId, '❌ Произошла ошибка при получении сертификатов. Попробуйте позже.', {
            reply_markup: {
                keyboard: [['🔙 В главное меню']],
                resize_keyboard: true
            }
        });
    }
}

bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const username = msg.from.username || '';
    const nickname = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');
    
    let client;
    try {
        client = await getClientByTelegramId(telegramId);
    } catch (error) {
        console.error('Ошибка при получении клиента в /start:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при подключении к базе данных. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
    
    // Извлекаем реферальный код из команды /start
    const referralCode = match[1] ? match[1].trim() : null;

    // Очищаем предыдущее состояние
    userStates.delete(chatId);

    if (!client) {
        // Проверяем наличие реферального кода
        let welcomeMessage = '🎿 Добро пожаловать в Ski-instruktor! 🏔\n\n' +
            '🌟 Я - ваш персональный помощник в мире горнолыжного спорта!\n\n' +
            'Я помогу вам:\n' +
            '• 📝 Записаться на тренировки на горнолыжном тренажере\n' +
            '• ⛷ Забронировать занятия с инструктором в Кулиге или на Воронинских горках зимой\n' +
            '• 💳 Управлять вашим балансом\n' +
            '• 🎁 Приобрести подарочные сертификаты\n\n';
        
        // Если есть реферальный код, проверяем его валидность
        if (referralCode) {
            try {
                const referrerResult = await pool.query(
                    'SELECT id, full_name FROM clients WHERE referral_code = $1',
                    [referralCode]
                );
                
                if (referrerResult.rows.length > 0) {
                    const referrer = referrerResult.rows[0];
                    
                    // Проверяем, активна ли реферальная программа
                    const referralActiveResult = await pool.query(
                        `SELECT bonus_amount FROM bonus_settings 
                         WHERE bonus_type = 'referral' AND is_active = TRUE 
                         ORDER BY created_at DESC LIMIT 1`
                    );
                    
                    const isReferralActive = referralActiveResult.rows.length > 0;
                    
                    if (isReferralActive) {
                        const bonusAmount = Math.round(referralActiveResult.rows[0].bonus_amount);
                        welcomeMessage += `🎁 <b>Вы пришли по реферальной ссылке!</b>\n` +
                            `Пригласил вас: ${referrer.full_name}\n\n` +
                            `💰 После регистрации:\n` +
                            `• Вы получите <b>${bonusAmount}₽</b> на баланс сразу!\n` +
                            `• Эта сумма поможет оплатить первую тренировку со скидкой\n\n` +
                            `💰 Ваш друг получит <b>${bonusAmount}₽</b> после того, как вы пополните баланс и пройдете первую тренировку.\n\n`;
                    } else {
                        // Реферальная программа неактивна, но ссылка все равно работает
                        welcomeMessage += `🎁 <b>Вы пришли по реферальной ссылке!</b>\n` +
                            `Пригласил вас: ${referrer.full_name}\n\n`;
                    }
                    
                    console.log(`✅ Новый пользователь пришел по реферальной ссылке ${referralCode} от пользователя ID ${referrer.id}`);
                } else {
                    console.log(`⚠️ Неверный реферальный код: ${referralCode}`);
                }
            } catch (error) {
                console.error('Ошибка при проверке реферального кода:', error);
            }
        }
        
        welcomeMessage += '🚀 Давайте начнем! Нажмите на кнопку "Запуск сервиса Ski-instruktor" внизу экрана, и я помогу вам зарегистрироваться в системе! 🎯';
        
        await bot.sendMessage(chatId, welcomeMessage,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [[{ text: '🚀 Запуск сервиса Ski-instruktor' }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }
        );
        userStates.set(chatId, {
            step: 'wait_start',
            data: { telegram_id: telegramId, username, nickname, referral_code: referralCode }
        });
    } else {
        await showMainMenu(chatId, telegramId);
    }
});

// Отображение меню настроек уведомлений
async function showNotificationSettingsMenu(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    
    try {
        // Получаем текущие настройки клиента
        const clientSettings = await getClientWithSettings(telegramId);
        
        if (!clientSettings) {
            await bot.sendMessage(chatId, '❌ Клиент не найден. Пожалуйста, зарегистрируйтесь в системе.');
            return;
        }
        
        const currentMode = clientSettings.silent_notifications ? 'без звука' : 'со звуком';
        
        const message = 
            '⚙️ <b>Настройка уведомлений</b>\n\n' +
            `📌 <b>Текущий режим:</b> ${currentMode}\n\n` +
            '🔔 Выберите способ получения уведомлений:\n\n' +
            '🔊 <b>Со звуком</b> — вы точно не пропустите важные сообщения от бота\n\n' +
            '🔇 <b>Без звука</b> — уведомления будут приходить тихо\n\n' +
            '⚠️ <i>Важно: При отключении звука есть риск пропустить важную информацию о тренировках</i>\n\n' +
            '🌙 <i>В период с 22:00 до 9:00 все уведомления автоматически отправляются без звука</i>';
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [
                    ['🔊 Со звуком'],
                    ['🔇 Без звука'],
                    ['🔙 Назад в меню']
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        });
    } catch (error) {
        console.error('Ошибка при отображении меню настроек:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Установка режима уведомлений
async function setNotificationMode(msg, isSilent) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    
    try {
        const success = await updateClientSilentMode(telegramId, isSilent);
        
        if (success) {
            let message;
            if (isSilent) {
                message = 
                    '🔇 <b>Режим без звука активирован</b>\n\n' +
                    '✅ Уведомления будут приходить тихо, без звуковых сигналов\n\n' +
                    '⚠️ <b>Обратите внимание:</b>\n' +
                    '• Есть риск пропустить важную информацию о тренировках\n' +
                    '• Рекомендуем регулярно проверять бота\n\n' +
                    '💡 <i>Вы всегда можете вернуться к режиму со звуком через настройки</i>';
            } else {
                message = 
                    '🔊 <b>Режим со звуком активирован</b>\n\n' +
                    '✅ Теперь вы точно не пропустите важную информацию от бота!\n\n' +
                    '📢 Вы будете получать:\n' +
                    '• Напоминания о предстоящих тренировках\n' +
                    '• Уведомления об изменениях в расписании\n' +
                    '• Важные сообщения от администрации\n\n' +
                    '🌙 <i>В ночное время (22:00-9:00) уведомления автоматически приходят без звука</i>';
            }
            
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            
            // Возвращаемся в главное меню
            setTimeout(() => {
                showMainMenu(chatId, telegramId);
            }, 1000);
        } else {
            await bot.sendMessage(chatId, '❌ Не удалось изменить настройки. Попробуйте позже.');
        }
    } catch (error) {
        console.error('Ошибка при установке режима уведомлений:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Обработчик команды "Поделиться ботом"
async function handleShareBotCommand(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const botUsername = process.env.BOT_USERNAME || 'Ski_Instruktor72_bot';
    
    try {
        // Получаем реферальный код пользователя
        const result = await pool.query(
            'SELECT referral_code FROM clients WHERE telegram_id = $1',
            [telegramId]
        );

        if (!result.rows[0]) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
            return;
        }

        let referralCode = result.rows[0].referral_code;

        // Если у пользователя нет реферального кода, генерируем его
        if (!referralCode) {
            referralCode = await generateUniqueReferralCode();
            await pool.query(
                'UPDATE clients SET referral_code = $1 WHERE telegram_id = $2',
                [referralCode, telegramId]
            );
            console.log(`✅ Сгенерирован реферальный код ${referralCode} для пользователя ${telegramId}`);
        }

        // Формируем реферальную ссылку
        const referralLink = `https://t.me/${botUsername}?start=${referralCode}`;
    const botShareLink = `https://t.me/${botUsername}`;

        // Проверяем, активна ли реферальная программа
        const referralActiveResult = await pool.query(
            `SELECT bonus_amount FROM bonus_settings 
             WHERE bonus_type = 'referral' AND is_active = TRUE 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        const isReferralActive = referralActiveResult.rows.length > 0;
        const bonusAmount = isReferralActive ? Math.round(referralActiveResult.rows[0].bonus_amount) : 500;

        let message;
        
        if (isReferralActive) {
            // Реферальная программа активна - показываем с бонусами
            message = `🎿 Поделитесь нашим ботом с друзьями!

${referralLink}

🏂 Ski-instruktor — ваш помощник для записи на горнолыжный тренажер

✨ Основные возможности:
• 📝 Запись на групповые и индивидуальные тренировки
• 👥 Управление детскими занятиями
• 💰 Пополнение баланса
• 📋 Просмотр своих записей
• 🎁 Подарочные сертификаты

📋 Дополнительное меню (синяя кнопка справа):
• 📍 Бот подскажет адрес
• 👥 Поделится информацией о тренере
• 💰 Покажет актуальные цены

🎯 Перейти в бота можно щелкнув по имени ниже:
${referralLink}

🎁 Реферальная программа:
• Ваш друг получит ${bonusAmount}₽ на баланс сразу после регистрации
• Эта сумма поможет ему оплатить первую тренировку со скидкой
• Вы получите ${bonusAmount}₽ на баланс после того, как друг пополнит баланс и пройдет первую тренировку.`;
        } else {
            // Реферальная программа неактивна - показываем обычное сообщение
            message = `🎿 Поделитесь нашим ботом с друзьями!

@${botUsername}

🏂 Ski-instruktor — ваш помощник для записи на горнолыжный тренажер

✨ Основные возможности:
• 📝 Запись на групповые и индивидуальные тренировки
• 👥 Управление детскими занятиями
• 💰 Пополнение баланса
• 📋 Просмотр своих записей
• 🎁 Подарочные сертификаты

📋 Дополнительное меню (синяя кнопка справа):
• 📍 Бот подскажет адрес
• 👥 Поделится информацией о тренере
• 💰 Покажет актуальные цены

🎯 Перейти в бота можно щелкнув по имени ниже:
@${botUsername}

💡 Или просто перешлите это сообщение друзьям!`;
        }

        // Создаем кнопки в зависимости от состояния реферальной программы
        let inlineKeyboard;
        
        if (isReferralActive) {
            // Реферальная программа активна - показываем все кнопки
            const shareText = `🎿 Присоединяйся к Ski-instruktor! Тренируйся на горнолыжном тренажере круглый год! 🏂 Используй мою ссылку и получи ${bonusAmount}₽ на баланс!`;
            inlineKeyboard = [
                [{ 
                    text: `📤 Поделиться с друзьями`, 
                    url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`
                }],
                [{ text: `🔗 Скопировать ссылку`, callback_data: `copy_referral_${referralCode}` }]
            ];
        } else {
            // Реферальная программа неактивна - показываем только кнопки для обычного бота
            inlineKeyboard = [
                [{ 
                    text: `📤 Поделиться с друзьями`, 
                    url: `https://t.me/share/url?url=${encodeURIComponent(botShareLink)}&text=${encodeURIComponent('🎿 Присоединяйся к Ski-instruktor! Тренируйся на горнолыжном тренажере круглый год! 🏂')}`
                }],
                [{ text: `🔗 Скопировать ссылку`, callback_data: `copy_referral_${referralCode}` }]
            ];
        }

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });

        console.log(`📤 Пользователь ${telegramId} запросил реферальную ссылку: ${referralLink}`);

    } catch (error) {
        console.error('Ошибка при получении реферальной ссылки:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
}

// Функция генерации уникального реферального кода
async function generateUniqueReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!isUnique && attempts < maxAttempts) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        // Проверяем уникальность
        const result = await pool.query(
            'SELECT COUNT(*) FROM clients WHERE referral_code = $1',
            [code]
        );
        
        isUnique = parseInt(result.rows[0].count) === 0;
        attempts++;
    }

    if (!isUnique) {
        throw new Error('Не удалось сгенерировать уникальный реферальный код');
    }

    return code;
}

// Вспомогательная функция для отображения типа спорта
function getSportTypeDisplay(sportType) {
    switch (sportType) {
        case 'ski':
            return 'Горные лыжи 🎿';
        case 'snowboard':
            return 'Сноуборд 🏂';
        case 'both':
            return 'Горные лыжи и сноуборд 🎿🏂';
        default:
            return sportType;
    }
}


// Показ доступных дат (инлайн-календарь) для зимних индивидуальных
async function showNaturalSlopeAvailableDates(chatId, filters = {}) {
    const conditions = [
        "ks.status = 'available'",
        'ks.date >= (NOW() AT TIME ZONE \'Asia/Yekaterinburg\')::date',
        'ki.is_active = TRUE',
        // Для текущей даты показываем только если есть слоты, которые еще не начались
        `(
            ks.date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
            OR (
                ks.date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                AND ks.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
            )
        )`
    ];
    const params = [];
    if (filters.selected_instructor_id) {
        conditions.push(`ks.instructor_id = $${params.length + 1}`);
        params.push(filters.selected_instructor_id);
    } else if (filters.selected_sport) {
        const sportFilter = filters.selected_sport === 'snowboard' ? 'snowboard' : 'ski';
        conditions.push(`(ki.sport_type = $${params.length + 1} OR ki.sport_type = 'both')`);
        params.push(sportFilter);
    }
    
    // Фильтрация по location
    if (filters.location && (filters.location === 'kuliga' || filters.location === 'vorona')) {
        conditions.push(`ks.location = $${params.length + 1}`);
        params.push(filters.location);
    }

    const query = `
        SELECT DISTINCT ks.date, ks.date::text AS date_str
        FROM kuliga_schedule_slots ks
        JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ks.date
        LIMIT 60`;

    const res = await pool.query(query, params);
    if (res.rows.length === 0) {
        return bot.sendMessage(chatId,
            '❌ На ближайшее время нет доступных дат зимних тренировок по выбранным параметрам.',
            { reply_markup: { keyboard: [['🔙 Назад']], resize_keyboard: true } }
        );
    }
    // Строим клавиатуру по 4 даты в ряд
    const buttons = [];
    let row = [];
    res.rows.forEach((r) => {
        const iso = r.date_str || (r.date && r.date.toISOString ? r.date.toISOString().split('T')[0] : String(r.date));
        const label = formatDateLabel(iso);
        row.push({ text: label, callback_data: `ns_date:${iso}` });
        if (row.length === 4) { buttons.push(row); row = []; }
    });
    if (row.length) buttons.push(row);

    await bot.sendMessage(chatId, '📅 Выберите доступную дату:', {
        reply_markup: { inline_keyboard: buttons }
    });

    return bot.sendMessage(chatId,
        'Чтобы вернуться назад, используйте кнопку ниже.',
        {
            reply_markup: {
                keyboard: [['🔙 Назад']],
                resize_keyboard: true
            }
        }
    );
}

// Функция показа временных слотов для зимних тренировок
async function showNaturalSlopeTimeSlots(chatId, selectedDate, data) {
    try {
        const conditions = [
            'ks.date = $1',
            "ks.status = 'available'",
            'ki.is_active = TRUE',
            `NOT EXISTS (
                SELECT 1 FROM kuliga_group_trainings kgt
                WHERE kgt.slot_id = ks.id
                  AND kgt.status IN ('open', 'confirmed')
            )`
        ];
        const params = [selectedDate];
        
        // Добавляем проверку времени: если дата сегодня, то показываем только те слоты, которые еще не начались
        conditions.push(`(
            ks.date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
            OR (
                ks.date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                AND ks.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
            )
        )`);
        
        if (data?.selected_instructor_id) {
            conditions.push(`ks.instructor_id = $${params.length + 1}`);
            params.push(data.selected_instructor_id);
        } else if (data?.selected_sport) {
            const sportFilter = data.selected_sport === 'snowboard' ? 'snowboard' : 'ski';
            conditions.push(`(ki.sport_type = $${params.length + 1} OR ki.sport_type = 'both')`);
            params.push(sportFilter);
        }
        
        // Фильтрация по location
        if (data?.location && (data.location === 'kuliga' || data.location === 'vorona')) {
            conditions.push(`ks.location = $${params.length + 1}`);
            params.push(data.location);
        }

        // Получаем свободные индивидуальные слоты из kuliga_schedule_slots на выбранную дату
        const freeSlotsRes = await pool.query(
            `SELECT 
                ks.id as slot_id,
                ks.start_time,
                ks.end_time,
                ki.full_name as instructor_name,
                ki.sport_type,
                ki.id as instructor_id
             FROM kuliga_schedule_slots ks
             JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
             WHERE ${conditions.join(' AND ')}
             ORDER BY ks.start_time`,
            params
        );
        
        if (freeSlotsRes.rows.length === 0) {
            const d0 = new Date(selectedDate);
            const noSlotsDate = `${d0.getDate().toString().padStart(2,'0')}.${(d0.getMonth()+1).toString().padStart(2,'0')}.${d0.getFullYear()}`;
            return bot.sendMessage(chatId,
                `❌ *На ${noSlotsDate} все слоты заняты!*\n\n` +
                'Выберите другую дату или попробуйте позже.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад']],
                        resize_keyboard: true
                    }
                }
            );
        }
        
        // Форматируем время и сохраняем информацию о слотах
        const availableSlots = freeSlotsRes.rows.map(r => {
            const time = String(r.start_time).substring(0, 5);
            const slotSportType = r.sport_type === 'both'
                ? (data?.selected_sport || 'ski')
                : r.sport_type;
            return { time, slot_id: r.slot_id, instructor_name: r.instructor_name, instructor_id: r.instructor_id, sport_type: slotSportType };
        });
        
        // Сохраняем слоты в состоянии для последующей проверки
        if (data) {
            data.available_times = availableSlots.map(s => s.time);
            data.available_slots_info = availableSlots; // Сохраняем полную информацию
        }
        
        // Создаем кнопки для доступных слотов с именем инструктора
        const slotButtons = availableSlots.map(slot => [`⏰ ${slot.time} (${slot.instructor_name})`]);
        slotButtons.push(['🔙 Назад']);
        
        const d = new Date(selectedDate);
        const formattedDate = `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()}`;
        const location = data.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        return bot.sendMessage(chatId,
            `⏰ *Выберите время тренировки на ${formattedDate}:*\n\n` +
            `👤 *Участник:* ${data.participant_name}\n` +
            `🏔️ *Тип:* Индивидуальная тренировка на естественном склоне\n` +
            `📍 *Место:* ${locationName}\n\n` +
            `📋 *Доступные слоты:*`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: slotButtons,
                    resize_keyboard: true
                }
            }
        );
        
    } catch (error) {
        console.error('Ошибка при показе временных слотов:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при загрузке расписания. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Функция показа доступных групповых тренировок для зимнего направления
async function showAvailableGroupTrainings(chatId, clientId, location = 'kuliga') {
    try {
        // Получаем групповые тренировки на естественном склоне из kuliga_group_trainings
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + 14); // Увеличиваем до 14 дней для соответствия сайту
        
        const params = [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]];
        let locationFilter = '';
        if (location && (location === 'kuliga' || location === 'vorona')) {
            params.push(location);
            locationFilter = `AND kgt.location = $${params.length}`;
        }
        
        const result = await pool.query(
            `SELECT 
                kgt.id,
                kgt.date,
                kgt.start_time,
                kgt.end_time,
                kgt.sport_type,
                kgt.level as group_name,
                kgt.description,
                kgt.price_per_person as price,
                kgt.min_participants,
                kgt.max_participants,
                COALESCE(SUM(kb.participants_count), 0)::INTEGER as current_participants,
                kgt.status,
                ki.full_name as trainer_name,
                ki.phone as trainer_phone
            FROM kuliga_group_trainings kgt
            JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
            LEFT JOIN kuliga_bookings kb ON kgt.id = kb.group_training_id 
                AND kb.status IN ('pending', 'confirmed')
            WHERE kgt.status IN ('open', 'confirmed')
                AND kgt.is_private = FALSE
                AND kgt.date >= $1::date
                AND kgt.date <= $2::date
                ${locationFilter}
                AND (
                    kgt.date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                    OR (
                        kgt.date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                        AND kgt.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                    )
                )
            GROUP BY kgt.id, kgt.date, kgt.start_time, kgt.end_time, kgt.sport_type, 
                     kgt.level, kgt.description, kgt.price_per_person, kgt.min_participants, 
                     kgt.max_participants, kgt.status, ki.full_name, ki.phone
            HAVING COALESCE(SUM(kb.participants_count), 0) < kgt.max_participants
            ORDER BY kgt.date, kgt.start_time`,
            params
        );
        
        if (result.rows.length === 0) {
            return bot.sendMessage(chatId,
                '❌ *На ближайшую неделю групповых тренировок не найдено!*\n\n' +
                'Попробуйте записаться на индивидуальную тренировку или обратитесь к администратору.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
        
        // Формируем сообщение с доступными тренировками
        const locationName = getLocationDisplayName(location);
        let message = `👥 *Доступные групповые тренировки на естественном склоне в ${locationName}:*\n\n`;
        
        result.rows.forEach((training, index) => {
            const date = new Date(training.date);
            const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
            const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
            const timeStr = String(training.start_time).substring(0, 5);
            const pricePerPerson = parseFloat(training.price || 0).toFixed(2);
            const sportType = training.sport_type === 'ski' ? '⛷️ Лыжи' : training.sport_type === 'snowboard' ? '🏂 Сноуборд' : '🏔️';
            const freePlaces = training.max_participants - training.current_participants;
            
            message += `${index + 1}. ${training.group_name || 'Групповая тренировка'}\n`;
            message += `   ${sportType}\n`;
            message += `   📅 ${dateStr} (${dayName})\n`;
            message += `   ⏰ ${timeStr}\n`;
            const occupiedPlaces = training.current_participants || 0;
            message += `   👥 Занято мест: ${occupiedPlaces}/${training.max_participants}\n`;
            if (training.trainer_name) {
                message += `   👨‍🏫 Инструктор: ${training.trainer_name}\n`;
            }
            if (training.description) {
                message += `   📝 ${training.description}\n`;
            }
            message += `   💰 Цена за человека: ${pricePerPerson} ₽\n\n`;
        });
        
        message += 'Чтобы выбрать тренировку, введите её номер в чат.\n';
        message += 'Например: *1* - для выбора первой тренировки\n\n';
        message += '⚠️ *При записи на тренировку убедитесь, что:*\n';
        message += '• ваш баланс пополнен\n';
        message += '• ваш уровень подготовки соответствует или выше указанного уровня тренировки';
        
        // Сохраняем список тренировок в состояние пользователя
        const state = userStates.get(chatId) || {};
        state.data = state.data || {};
        state.data.available_group_trainings = result.rows;
        state.data.client_id = clientId;
        state.step = 'natural_slope_group_training_selection';
        userStates.set(chatId, state);
        
        // Создаем кнопки для выбора тренировки
        const trainingButtons = result.rows.map((_, index) => [`${index + 1}`]);
        trainingButtons.push(['🔙 Назад в меню']);
        
        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: trainingButtons,
                resize_keyboard: true
            }
        });
        
    } catch (error) {
        console.error('Ошибка при показе групповых тренировок:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при загрузке групповых тренировок. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

// ============= ФУНКЦИИ ДЛЯ РАБОТЫ С АБОНЕМЕНТАМИ =============

/**
 * Показ меню абонементов
 */
async function showSubscriptionsMenu(chatId, clientId) {
    try {
        // Получаем активные абонементы клиента
        const token = getJWTToken();
        const url = `${process.env.BASE_URL || 'http://localhost:8080'}/api/natural-slope-subscriptions/client/${clientId}`;
        
        console.log('Запрос абонементов клиента:', url);
        
        let activeSubscriptions = [];
        try {
            const subscriptionsResponse = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const subscriptions = subscriptionsResponse.data;
            console.log('Получено абонементов клиента:', subscriptions?.length || 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            activeSubscriptions = subscriptions.filter(sub => {
                const expiresAt = new Date(sub.expires_at);
                return sub.remaining_sessions > 0 && expiresAt >= today && sub.status === 'active';
            });
            console.log('Активных абонементов:', activeSubscriptions.length);
        } catch (error) {
            console.error('Ошибка при получении абонементов клиента:', error.response?.status, error.response?.data || error.message);
        }

        let message = '🎫 *Абонементы*\n\n';
        
        if (activeSubscriptions.length > 0) {
            message += '✅ *Ваши активные абонементы:*\n\n';
            activeSubscriptions.forEach((sub, index) => {
                const expiresDate = new Date(sub.expires_at);
                const expiresStr = `${expiresDate.getDate().toString().padStart(2, '0')}.${(expiresDate.getMonth() + 1).toString().padStart(2, '0')}.${expiresDate.getFullYear()}`;
                
                message += `${index + 1}. *${sub.subscription_name}*\n`;
                message += `   🎯 Занятий: ${sub.remaining_sessions} из ${sub.total_sessions}\n`;
                message += `   📅 Действует до: ${expiresStr}\n`;
                message += `   💰 Цена за занятие: ${parseFloat(sub.total_paid / sub.total_sessions).toFixed(2)} ₽\n\n`;
            });
        } else {
            message += 'У вас пока нет активных абонементов.\n\n';
        }

        message += 'Выберите действие:';

        const buttons = [];
        if (activeSubscriptions.length > 0) {
            buttons.push(['📋 Мои абонементы']);
        }
        buttons.push(['🛒 Купить абонемент']);
        buttons.push(['🔙 Назад в меню']);

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: buttons,
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при показе меню абонементов:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

/**
 * Показ доступных абонементов для покупки
 */
async function showAvailableSubscriptions(chatId, clientId) {
    try {
        const token = getJWTToken();
        const url = `${process.env.BASE_URL || 'http://localhost:8080'}/api/natural-slope-subscriptions/types?is_active=true`;
        
        console.log('Запрос абонементов:', url);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Статус ответа:', response.status);

        const subscriptionTypes = response.data;
        console.log('Получено типов абонементов:', subscriptionTypes?.length || 0);

        if (subscriptionTypes.length === 0) {
            return bot.sendMessage(chatId,
                '❌ *В данный момент нет доступных абонементов для покупки.*\n\n' +
                'Попробуйте позже или обратитесь к администратору.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Фильтруем только те, у которых дата окончания еще не прошла
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const availableTypes = subscriptionTypes.filter(type => {
            const expiresDate = new Date(type.expires_at);
            return expiresDate >= today;
        });

        if (availableTypes.length === 0) {
            return bot.sendMessage(chatId,
                '❌ *Все доступные абонементы истекли.*\n\n' +
                'Попробуйте позже или обратитесь к администратору.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        let message = '🛒 *Доступные абонементы для покупки:*\n\n';

        availableTypes.forEach((type, index) => {
            const expiresDate = new Date(type.expires_at);
            const expiresStr = `${expiresDate.getDate().toString().padStart(2, '0')}.${(expiresDate.getMonth() + 1).toString().padStart(2, '0')}.${expiresDate.getFullYear()}`;
            
            message += `${index + 1}. *${type.name}*\n`;
            if (type.description) {
                message += `   ${type.description}\n`;
            }
            message += `   🎯 Количество занятий: ${type.sessions_count}\n`;
            message += `   💰 Скидка: ${type.discount_percentage}%\n`;
            message += `   💵 Цена абонемента: ${parseFloat(type.price).toFixed(2)} ₽\n`;
            message += `   💰 Цена за занятие: ${parseFloat(type.price_per_session).toFixed(2)} ₽\n`;
            message += `   📅 Действует до: ${expiresStr}\n\n`;
        });

        message += 'Введите номер абонемента для покупки.\n';
        message += 'Например: *1* - для покупки первого абонемента';

        // Сохраняем список в состояние
        const state = userStates.get(chatId) || {};
        state.data = state.data || {};
        state.data.available_subscriptions = availableTypes;
        state.data.client_id = clientId;
        state.step = 'subscription_purchase_selection';
        userStates.set(chatId, state);

        // Создаем кнопки для выбора
        const buttons = availableTypes.map((_, index) => [`${index + 1}`]);
        buttons.push(['🔙 Назад в меню']);

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: buttons,
                resize_keyboard: true
            }
        });
        } catch (error) {
            console.error('Ошибка при показе доступных абонементов:', error);
            const errorMessage = error.response 
                ? `Ошибка ${error.response.status}: ${error.response.data?.error || error.response.statusText}`
                : error.message;
            console.error('Детали ошибки:', errorMessage);
            
            return bot.sendMessage(chatId,
                '❌ Произошла ошибка при загрузке абонементов. Попробуйте позже.',
                {
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
}

/**
 * Показ моих абонементов
 */
async function showMySubscriptions(chatId, clientId) {
    try {
        const token = getJWTToken();
        const url = `${process.env.BASE_URL || 'http://localhost:8080'}/api/natural-slope-subscriptions/client/${clientId}`;
        
        console.log('Запрос моих абонементов:', url);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const subscriptions = response.data;
        console.log('Получено абонементов:', subscriptions?.length || 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Разделяем на активные и неактивные
        const active = subscriptions.filter(sub => {
            const expiresAt = new Date(sub.expires_at);
            return sub.remaining_sessions > 0 && expiresAt >= today && sub.status === 'active';
        });

        const expired = subscriptions.filter(sub => {
            const expiresAt = new Date(sub.expires_at);
            return expiresAt < today || sub.status === 'expired';
        });

        const used = subscriptions.filter(sub => sub.remaining_sessions === 0 || sub.status === 'used');

        let message = '📋 *Мои абонементы*\n\n';

        if (active.length > 0) {
            message += '✅ *Активные абонементы:*\n\n';
            active.forEach((sub, index) => {
                const expiresDate = new Date(sub.expires_at);
                const expiresStr = `${expiresDate.getDate().toString().padStart(2, '0')}.${(expiresDate.getMonth() + 1).toString().padStart(2, '0')}.${expiresDate.getFullYear()}`;
                
                message += `${index + 1}. *${sub.subscription_name}*\n`;
                message += `   🎯 Занятий: ${sub.remaining_sessions} из ${sub.total_sessions}\n`;
                message += `   📅 Действует до: ${expiresStr}\n`;
                message += `   💰 Цена за занятие: ${parseFloat(sub.total_paid / sub.total_sessions).toFixed(2)} ₽\n\n`;
            });
        }

        if (used.length > 0) {
            message += '✅ *Использованные абонементы:*\n\n';
            used.forEach((sub, index) => {
                message += `${index + 1}. *${sub.subscription_name}*\n`;
                message += `   🎯 Занятий использовано: ${sub.total_sessions}\n\n`;
            });
        }

        if (expired.length > 0) {
            message += '⏰ *Истекшие абонементы:*\n\n';
            expired.forEach((sub, index) => {
                const expiresDate = new Date(sub.expires_at);
                const expiresStr = `${expiresDate.getDate().toString().padStart(2, '0')}.${(expiresDate.getMonth() + 1).toString().padStart(2, '0')}.${expiresDate.getFullYear()}`;
                
                message += `${index + 1}. *${sub.subscription_name}*\n`;
                message += `   📅 Истёк: ${expiresStr}\n`;
                message += `   🎯 Осталось занятий: ${sub.remaining_sessions}\n\n`;
            });
        }

        if (active.length === 0 && used.length === 0 && expired.length === 0) {
            message += 'У вас пока нет абонементов.';
        }

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [['🔙 Назад в меню']],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при показе моих абонементов:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

/**
 * Покупка абонемента
 */
async function purchaseSubscription(chatId, clientId, subscriptionTypeId) {
    try {
        const token = getJWTToken();
        const url = `${process.env.BASE_URL || 'http://localhost:8080'}/api/natural-slope-subscriptions/purchase`;
        const response = await axios.post(url, {
            client_id: clientId,
            subscription_type_id: subscriptionTypeId
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const result = response.data;

        if (result.error) {
            let errorMessage = '❌ Ошибка при покупке абонемента: ';
            
            if (result.error) {
                if (result.error.includes('Недостаточно средств')) {
                    errorMessage += `Недостаточно средств на балансе.\n\n`;
                    errorMessage += `Требуется: ${result.required?.toFixed(2) || 'N/A'} ₽\n`;
                    errorMessage += `Доступно: ${result.available?.toFixed(2) || 'N/A'} ₽\n\n`;
                    errorMessage += `Пожалуйста, пополните баланс и попробуйте снова.`;
                    
                    return bot.sendMessage(chatId, errorMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['💳 Пополнить баланс'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } else {
                    errorMessage += result.error;
                }
            } else {
                errorMessage += 'Неизвестная ошибка';
            }

            return bot.sendMessage(chatId, errorMessage, {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            });
        }

        // Успешная покупка
        const subscription = result;
        const expiresDate = new Date(subscription.expires_at);
        const expiresStr = `${expiresDate.getDate().toString().padStart(2, '0')}.${(expiresDate.getMonth() + 1).toString().padStart(2, '0')}.${expiresDate.getFullYear()}`;

        let message = '✅ *Абонемент успешно приобретен!*\n\n';
        message += `🎫 *${subscription.subscription_name}*\n`;
        message += `🎯 Количество занятий: ${subscription.remaining_sessions} из ${subscription.total_sessions}\n`;
        message += `📅 Действует до: ${expiresStr}\n`;
        message += `💰 Цена за занятие: ${parseFloat(subscription.total_paid / subscription.total_sessions).toFixed(2)} ₽\n\n`;
        message += `Спасибо за покупку! Теперь вы можете использовать абонемент при записи на групповые тренировки на естественном склоне.`;

        // Уведомление администратора
        try {
            const { notifyAdminSubscriptionPurchase } = require('./admin-notify');
            const clientData = await pool.query('SELECT full_name FROM clients WHERE id = $1', [clientId]);
            const clientName = clientData.rows[0]?.full_name || 'Неизвестно';
            
            await notifyAdminSubscriptionPurchase({
                client_name: clientName,
                client_id: clientId,
                subscription_name: subscription.subscription_name,
                price: subscription.total_paid,
                sessions_count: subscription.total_sessions
            });
        } catch (notifyError) {
            console.error('Ошибка при отправке уведомления админу о покупке абонемента:', notifyError);
        }

        // Очищаем состояние
        userStates.set(chatId, { step: 'main_menu', data: { client_id: clientId } });

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [['🔙 Назад в меню']],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при покупке абонемента:', error);
        const errorMessage = error.response 
            ? `Ошибка ${error.response.status}: ${JSON.stringify(error.response.data)}`
            : error.message;
        console.error('Детали ошибки покупки:', errorMessage);
        
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при покупке абонемента. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    }
}

// ============= ФУНКЦИИ ДЛЯ НОВОЙ ЛОГИКИ ГРУППОВЫХ ТРЕНИРОВОК КУЛИГИ =============

/**
 * Показ доступных дат для "У меня своя группа"
 */
async function showKuligaAvailableDatesForOwnGroup(chatId, data) {
    try {
        const sportType = data.selected_sport || 'ski';
        const location = data.location || 'kuliga';
        const now = moment().tz('Asia/Yekaterinburg');
        const endDate = now.clone().add(30, 'days');

        const params = [now.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD'), sportType];
        let locationFilter = '';
        if (location && (location === 'kuliga' || location === 'vorona')) {
            params.push(location);
            locationFilter = `AND ks.location = $${params.length}`;
        }

        // Получаем даты с доступными слотами
        const slotsResult = await pool.query(
            `SELECT DISTINCT ks.date
             FROM kuliga_schedule_slots ks
             JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
             WHERE ks.date >= $1
               AND ks.date <= $2
               AND ks.status = 'available'
               AND ki.is_active = TRUE
               AND (ki.sport_type = $3 OR ki.sport_type = 'both')
               ${locationFilter}
               AND (
                   ks.date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                   OR (
                       ks.date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                       AND ks.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                   )
               )
             ORDER BY ks.date
             LIMIT 30`,
            params
        );

        if (slotsResult.rows.length === 0) {
            return bot.sendMessage(chatId,
                '❌ *На ближайшие 30 дней нет доступных дат для групповой тренировки!*\n\n' +
                'Попробуйте выбрать другой вид спорта или обратитесь к администратору.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад']],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Формируем кнопки с датами
        const dateButtons = [];
        const dateMap = new Map();

        slotsResult.rows.forEach((row, index) => {
            const date = moment(row.date).tz('Asia/Yekaterinburg');
            const dateStr = date.format('DD.MM.YYYY');
            const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.day()];
            const buttonText = `${dateStr} (${dayName})`;
            dateMap.set(buttonText, row.date);
            
            if (index % 2 === 0) {
                dateButtons.push([buttonText]);
            } else {
                dateButtons[dateButtons.length - 1].push(buttonText);
            }
        });

        dateButtons.push(['🔙 Назад']);

        // Сохраняем маппинг дат в состояние
        const state = userStates.get(chatId) || {};
        state.data = state.data || {};
        state.data.available_dates = Array.from(dateMap.values());
        state.data.date_map = Object.fromEntries(dateMap);
        state.step = 'kuliga_group_own_date';
        userStates.set(chatId, state);

        let message = '📅 *Выберите удобную дату для групповой тренировки:*\n\n';
        message += 'Доступны даты с свободными слотами инструкторов.\n';

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: dateButtons,
                resize_keyboard: true
            }
        });

    } catch (error) {
        console.error('Ошибка при показе дат для своей группы:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при загрузке дат. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад']],
                    resize_keyboard: true
                }
            }
        );
    }
}

/**
 * Показ временных слотов для выбранной даты ("У меня своя группа")
 */
async function showKuligaTimeSlotsForOwnGroup(chatId, selectedDate, data) {
    try {
        const sportType = data.selected_sport || 'ski';
        const location = data.location || 'kuliga';

        const params = [selectedDate, sportType];
        let locationFilter = '';
        if (location && (location === 'kuliga' || location === 'vorona')) {
            params.push(location);
            locationFilter = `AND ks.location = $${params.length}`;
        }

        // Получаем доступные слоты на выбранную дату
        const slotsResult = await pool.query(
            `SELECT ks.id, ks.start_time, ks.end_time, ki.full_name as instructor_name, ki.id as instructor_id
             FROM kuliga_schedule_slots ks
             JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
             WHERE ks.date = $1
               AND ks.status = 'available'
               AND NOT EXISTS (
                   SELECT 1 FROM kuliga_group_trainings kgt
                   WHERE kgt.slot_id = ks.id
                     AND kgt.status IN ('open', 'confirmed')
               )
               AND ki.is_active = TRUE
               AND (ki.sport_type = $2 OR ki.sport_type = 'both')
               ${locationFilter}
               AND (
                   ks.date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                   OR (
                       ks.date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                       AND ks.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                   )
               )
             ORDER BY ks.start_time`,
            params
        );

        if (slotsResult.rows.length === 0) {
            return bot.sendMessage(chatId,
                '❌ *На выбранную дату нет доступных временных слотов!*\n\n' +
                'Выберите другую дату.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад']],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Формируем кнопки с временными слотами
        const timeButtons = [];
        const slots = slotsResult.rows;

        slots.forEach((slot, index) => {
            const timeStr = String(slot.start_time).substring(0, 5);
            const endTimeStr = String(slot.end_time).substring(0, 5);
            const buttonText = `${timeStr} - ${endTimeStr} (${slot.instructor_name})`;
            
            if (index % 2 === 0) {
                timeButtons.push([buttonText]);
            } else {
                timeButtons[timeButtons.length - 1].push(buttonText);
            }
        });

        timeButtons.push(['🔙 Назад']);

        // Сохраняем слоты в состояние
        const state = userStates.get(chatId) || {};
        state.data = state.data || {};
        state.data.available_slots = slots;
        state.data.selected_date = selectedDate;
        state.step = 'kuliga_group_own_time';
        userStates.set(chatId, state);

        const date = moment(selectedDate).tz('Asia/Yekaterinburg');
        const dateStr = date.format('DD.MM.YYYY');
        const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.day()];

        let message = `⏰ *Выберите время для групповой тренировки*\n\n`;
        message += `📅 Дата: ${dateStr} (${dayName})\n\n`;
        message += 'Доступные временные слоты:\n';

        slots.forEach((slot) => {
            const timeStr = String(slot.start_time).substring(0, 5);
            const endTimeStr = String(slot.end_time).substring(0, 5);
            message += `• ${timeStr} - ${endTimeStr} (${slot.instructor_name})\n`;
        });

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: timeButtons,
                resize_keyboard: true
            }
        });

    } catch (error) {
        console.error('Ошибка при показе временных слотов:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при загрузке временных слотов. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад']],
                    resize_keyboard: true
                }
            }
        );
    }
}

/**
 * Показ дат с групповыми тренировками для "Записаться в группу"
 */
async function showKuligaGroupTrainingDates(chatId, clientId, sportType = null, location = 'kuliga') {
    try {
        const now = moment().tz('Asia/Yekaterinburg');
        const endDate = now.clone().add(30, 'days');

        // Получаем уникальные даты с групповыми тренировками
        // ВАЖНО: Исключаем приватные тренировки (is_private = TRUE) - к ним нельзя добавиться
        // ВАЖНО: Подсчитываем участников из активных бронирований (status IN ('pending', 'confirmed'))
        let sportFilter = '';
        let locationFilter = '';
        const params = [now.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')];
        if (sportType) {
            sportFilter = 'AND kgt.sport_type = $3';
            params.push(sportType);
        }
        if (location && (location === 'kuliga' || location === 'vorona')) {
            const paramIndex = params.length + 1;
            locationFilter = `AND kgt.location = $${paramIndex}`;
            params.push(location);
        }

        const datesResult = await pool.query(
            `SELECT DISTINCT kgt.date
             FROM kuliga_group_trainings kgt
             JOIN kuliga_instructors ki ON kgt.instructor_id = ki.id
             LEFT JOIN kuliga_bookings kb ON kgt.id = kb.group_training_id 
                 AND kb.status IN ('pending', 'confirmed')
             WHERE kgt.date >= $1::date
               AND kgt.date <= $2::date
               AND kgt.status IN ('open', 'confirmed')
               AND kgt.is_private = FALSE
               AND ki.is_active = TRUE
               ${sportFilter}
               ${locationFilter}
               AND (
                   kgt.date > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                   OR (
                       kgt.date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date
                       AND kgt.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                   )
               )
             GROUP BY kgt.id, kgt.date, kgt.max_participants
             HAVING COALESCE(SUM(kb.participants_count), 0) < kgt.max_participants
             ORDER BY kgt.date`,
            params
        );

        if (datesResult.rows.length === 0) {
            return bot.sendMessage(chatId,
                '❌ *На ближайшие 30 дней нет созданных групповых тренировок!*\n\n' +
                'Попробуйте выбрать вариант "У меня своя группа" или обратитесь к администратору.',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад']],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Формируем кнопки с датами
        const dateButtons = [];
        const dateMap = new Map();

        datesResult.rows.forEach((row, index) => {
            const date = moment(row.date).tz('Asia/Yekaterinburg');
            const dateStr = date.format('DD.MM.YYYY');
            const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.day()];
            const buttonText = `${dateStr} (${dayName})`;
            dateMap.set(buttonText, row.date);
            
            if (index % 2 === 0) {
                dateButtons.push([buttonText]);
            } else {
                dateButtons[dateButtons.length - 1].push(buttonText);
            }
        });

        dateButtons.push(['🔙 Назад']);

        // Сохраняем маппинг дат в состояние
        const state = userStates.get(chatId) || {};
        state.data = state.data || {};
        state.data.client_id = clientId;
        if (sportType) {
            state.data.selected_sport = sportType;
        }
        // Сохраняем location, если он был передан
        if (location) {
            state.data.location = location;
        }
        state.data.available_dates = Array.from(dateMap.values());
        state.data.date_map = Object.fromEntries(dateMap);
        state.step = 'kuliga_group_existing_date';
        userStates.set(chatId, state);

        let message = '📅 *Выберите дату групповой тренировки:*\n\n';
        message += 'Доступны даты с созданными групповыми тренировками.\n';

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: dateButtons,
                resize_keyboard: true
            }
        });

    } catch (error) {
        console.error('Ошибка при показе дат с групповыми тренировками:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при загрузке дат. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад']],
                    resize_keyboard: true
                }
            }
        );
    }
}

/**
 * Показ списка участников с кнопками для выбора
 */
async function showParticipantsList(chatId, state, showError = false) {
    // Всегда загружаем свежий список детей из базы данных
    const childrenResult = await pool.query(
        'SELECT id, full_name, birth_date FROM children WHERE parent_id = $1 ORDER BY birth_date',
        [state.data.client_id]
    );
    state.data.children = childrenResult.rows;
    
    // Если данные клиента не загружены, загружаем их
    if (!state.data.client) {
        const clientResult = await pool.query(
            'SELECT id, full_name, birth_date FROM clients WHERE id = $1',
            [state.data.client_id]
        );
        state.data.client = clientResult.rows[0] || {};
    }
    
    // Сохраняем обновленное состояние
    userStates.set(chatId, state);

    let message = '👥 *Участники групповой тренировки:*\n\n';
    
    if (state.data.selected_participants && state.data.selected_participants.length > 0) {
        state.data.selected_participants.forEach((p, index) => {
            message += `${index + 1}. ${p.fullName} (${p.age})\n`;
        });
        message += '\nВы можете добавить еще участников или нажмите "✅ Все указано, продолжить" для продолжения.';
    } else {
        message += 'Список пуст. Выберите участников из списка ниже или введите через запятую.\n';
        message += 'Например: Иван 10, Мария 8';
    }

    if (showError) {
        message = '❌ *Пожалуйста, выберите хотя бы одного участника.*\n\n' + message;
    }

    const participantButtons = [];
    
    // Кнопка "Себя"
    const isSelfSelected = state.data.selected_participants && state.data.selected_participants.find(p => p.isSelf);
    participantButtons.push([isSelfSelected ? '✅ Себя' : '👤 Себя']);

    // Кнопки детей - формат: "👶 Имя (возраст)"
    if (state.data.children && state.data.children.length > 0) {
        state.data.children.forEach((child, index) => {
            const age = moment().diff(moment(child.birth_date), 'years');
            const isSelected = state.data.selected_participants && state.data.selected_participants.find(p => p.childId === child.id);
            // Формат: "👶 Имя (возраст)"
            const buttonText = isSelected 
                ? `✅ ${child.full_name} (${age})` 
                : `👶 ${child.full_name} (${age})`;
            
            if (index % 2 === 0) {
                participantButtons.push([buttonText]);
            } else {
                participantButtons[participantButtons.length - 1].push(buttonText);
            }
        });
    }

    participantButtons.push(['✅ Все указано, продолжить']);
    participantButtons.push(['🔙 Назад']);

    // ВАЖНО: Сохраняем состояние перед отправкой сообщения с кнопками
    userStates.set(chatId, state);
    console.log('💾 Состояние сохранено в showParticipantsList:', {
        step: state.step,
        participantsCount: state.data.selected_participants ? state.data.selected_participants.length : 0,
        hasChildren: !!state.data.children,
        childrenCount: state.data.children ? state.data.children.length : 0
    });

    return bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
            keyboard: participantButtons,
            resize_keyboard: true
        }
    });
}

/**
 * Расчет стоимости и подтверждение бронирования для "У меня своя группа"
 */
async function calculateAndConfirmKuligaOwnGroupBooking(chatId, state) {
    try {
        const participants = state.data.selected_participants || [];
        const participantsCount = participants.length;

        if (participantsCount === 0) {
            return bot.sendMessage(chatId,
                '❌ Пожалуйста, укажите хотя бы одного участника.',
                {
                    reply_markup: {
                        keyboard: [['🔙 Назад']],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Получаем прайсы для групповых тренировок
        const pricesResult = await pool.query(
            `SELECT id, participants, price, duration, description
             FROM winter_prices
             WHERE type = 'group'
               AND participants >= $1
               AND is_active = TRUE
             ORDER BY participants ASC
             LIMIT 1`,
            [participantsCount]
        );

        if (!pricesResult.rows.length) {
            return bot.sendMessage(chatId,
                `❌ Не найдена цена для группы из ${participantsCount} человек.\n` +
                'Обратитесь к администратору.',
                {
                    reply_markup: {
                        keyboard: [['🔙 Назад']],
                        resize_keyboard: true
                    }
                }
            );
        }

        const priceData = pricesResult.rows[0];
        const baseParticipants = Number(priceData.participants) || participantsCount;
        const totalPriceForGroup = Number(priceData.price) || 0;
        const pricePerPerson = totalPriceForGroup / baseParticipants;
        const totalPrice = pricePerPerson * participantsCount;

        // Получаем данные клиента
        const clientResult = await pool.query(
            'SELECT id, full_name, phone, email, birth_date FROM clients WHERE id = $1',
            [state.data.client_id]
        );

        if (!clientResult.rows.length) {
            return bot.sendMessage(chatId, '❌ Клиент не найден.');
        }

        const client = clientResult.rows[0];

        // Получаем баланс кошелька
        const walletResult = await pool.query(
            'SELECT balance FROM wallets WHERE client_id = $1',
            [state.data.client_id]
        );
        const balance = walletResult.rows[0] ? parseFloat(walletResult.rows[0].balance || 0) : 0;

        // Формируем информацию о тренировке
        const date = moment(state.data.selected_date).tz('Asia/Yekaterinburg');
        const dateStr = date.format('DD.MM.YYYY');
        const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.day()];
        const timeStr = String(state.data.selected_start_time).substring(0, 5);
        const endTimeStr = String(state.data.selected_end_time).substring(0, 5);
        const sportType = state.data.selected_sport === 'ski' ? '⛷️ Горные лыжи' : '🏂 Сноуборд';

        const location = state.data.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        let message = '📋 *Подтверждение бронирования групповой тренировки*\n\n';
        message += `📅 *Дата:* ${dateStr} (${dayName})\n`;
        message += `⏰ *Время:* ${timeStr} - ${endTimeStr}\n`;
        message += `🎿 *Вид спорта:* ${sportType}\n`;
        message += `👨‍🏫 *Инструктор:* ${state.data.selected_instructor_name}\n`;
        message += `🏔️ *Место:* ${locationName}\n\n`;
        message += `👥 *Участники (${participantsCount}):*\n`;
        participants.forEach((p, index) => {
            message += `${index + 1}. ${p.fullName} (${p.age})\n`;
        });
        message += `\n💰 *Стоимость:*\n`;
        message += `• За человека: ${pricePerPerson.toFixed(2)} ₽\n`;
        message += `• Всего: ${totalPrice.toFixed(2)} ₽\n\n`;
        message += `💳 *Ваш баланс:* ${balance.toFixed(2)} ₽\n`;

        // Сохраняем расчет стоимости
        state.data.price_id = priceData.id;
        state.data.price_per_person = pricePerPerson;
        state.data.total_price = totalPrice;
        state.data.price_duration = priceData.duration;
        state.step = 'kuliga_group_own_confirm';
        userStates.set(chatId, state);

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['✅ Подтвердить и оплатить'],
                    ['🔙 Назад']
                ],
                resize_keyboard: true
            }
        });

    } catch (error) {
        console.error('Ошибка при расчете стоимости:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при расчете стоимости. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад']],
                    resize_keyboard: true
                }
            }
        );
    }
}

/**
 * Подтверждение и оплата для "Записаться в группу"
 */
async function confirmAndPayKuligaExistingGroupBooking(chatId, state) {
    try {
        const participants = state.data.selected_participants || [];

        if (participants.length === 0) {
            return bot.sendMessage(chatId,
                '❌ Пожалуйста, выберите участника.',
                {
                    reply_markup: {
                        keyboard: [
                            ['👤 Себя'],
                            ...(state.data.children || []).map(child => {
                                const age = moment().diff(moment(child.birth_date), 'years');
                                return [`👶 ${child.full_name} (${age} лет)`];
                            }),
                            ['🔙 Назад']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Получаем данные клиента
        const clientResult = await pool.query(
            'SELECT id, full_name, phone, email, birth_date FROM clients WHERE id = $1',
            [state.data.client_id]
        );

        if (!clientResult.rows.length) {
            return bot.sendMessage(chatId, '❌ Клиент не найден.');
        }

        const client = clientResult.rows[0];

        // Формируем информацию о тренировке
        const date = moment(state.data.selected_date).tz('Asia/Yekaterinburg');
        const dateStr = date.format('DD.MM.YYYY');
        const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.day()];
        const timeStr = String(state.data.selected_start_time).substring(0, 5);
        const endTimeStr = String(state.data.selected_end_time).substring(0, 5);
        const sportType = state.data.selected_sport === 'ski' ? '⛷️ Горные лыжи' : '🏂 Сноуборд';
        const freePlaces = state.data.max_participants - state.data.current_participants;
        const totalPrice = state.data.price_per_person * participants.length;

        const location = state.data.location || 'kuliga';
        const locationName = getLocationDisplayName(location);
        let message = '📋 *Подтверждение бронирования групповой тренировки*\n\n';
        message += `📅 *Дата:* ${dateStr} (${dayName})\n`;
        message += `⏰ *Время:* ${timeStr} - ${endTimeStr}\n`;
        message += `🎿 *Вид спорта:* ${sportType}\n`;
        message += `👨‍🏫 *Инструктор:* ${state.data.selected_instructor_name}\n`;
        message += `🏔️ *Место:* ${locationName}\n`;
        const occupiedPlacesAfter = (state.data.current_participants || 0) + participants.length;
        message += `👥 *Занято мест:* ${occupiedPlacesAfter}/${state.data.max_participants}\n`;
        if (state.data.training_description) {
            message += `📝 *Описание:* ${state.data.training_description}\n`;
        }
        message += `\n👤 *Участник:*\n`;
        participants.forEach((p, index) => {
            message += `${index + 1}. ${p.fullName} (${p.age} лет)\n`;
        });
        message += `\n💰 *Стоимость:* ${totalPrice.toFixed(2)} ₽\n`;
        const pricePerPerson = Number(state.data.price_per_person || 0);
        message += `• За человека: ${pricePerPerson.toFixed(2)} ₽\n`;
        message += `• Всего: ${totalPrice.toFixed(2)} ₽\n`;

        // Сохраняем данные для оплаты
        state.data.total_price = totalPrice;
        state.step = 'kuliga_group_existing_confirm';
        userStates.set(chatId, state);

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['✅ Подтвердить и оплатить'],
                    ['🔙 Назад']
                ],
                resize_keyboard: true
            }
        });

    } catch (error) {
        console.error('Ошибка при подтверждении бронирования:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка при подтверждении. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [['🔙 Назад']],
                    resize_keyboard: true
                }
            }
        );
    }
}

/**
 * Создание бронирования для "У меня своя группа"
 */
async function createKuligaOwnGroupBooking(chatId, state) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Получаем данные клиента и его кошелек
        const clientResult = await client.query(
            `SELECT c.id, c.full_name, c.phone, c.email, c.birth_date, w.id as wallet_id, w.balance
             FROM clients c
             LEFT JOIN wallets w ON c.id = w.client_id
             WHERE c.id = $1`,
            [state.data.client_id]
        );

        if (!clientResult.rows.length) {
            await client.query('ROLLBACK');
            return bot.sendMessage(chatId, '❌ Клиент не найден.');
        }

        const clientData = clientResult.rows[0];
        const balance = parseFloat(clientData.balance || 0);
        const totalPrice = parseFloat(state.data.total_price || 0);

        // Проверяем баланс
        if (balance < totalPrice) {
            await client.query('ROLLBACK');
            return bot.sendMessage(chatId,
                `❌ На вашем балансе недостаточно средств.\n\n` +
                `Требуется: ${totalPrice.toFixed(2)} руб.\n` +
                `Доступно: ${balance.toFixed(2)} руб.\n\n` +
                `Пополните баланс и попробуйте снова.`,
                {
                    reply_markup: {
                        keyboard: [['💳 Пополнить баланс'], ['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Проверяем, не занят ли слот другой групповой тренировкой
        const existingTrainingCheck = await client.query(
            `SELECT id, status, current_participants, max_participants
             FROM kuliga_group_trainings
             WHERE slot_id = $1
               AND date = $2
               AND start_time = $3
               AND status IN ('open', 'confirmed')
             FOR UPDATE`,
            [state.data.selected_slot_id, state.data.selected_date, state.data.selected_start_time]
        );

        let groupTrainingId;
        
        let selectedInstructorId = state.data.selected_instructor_id;
        let locationFromTraining = state.data.location || 'kuliga';
        
        if (existingTrainingCheck.rows.length > 0) {
            // Слот уже занят групповой тренировкой - используем существующую
            const existingTraining = existingTrainingCheck.rows[0];
            groupTrainingId = existingTraining.id;
            
            // Получаем instructor_id и location из существующей тренировки
            const existingTrainingDetails = await client.query(
                'SELECT instructor_id, location FROM kuliga_group_trainings WHERE id = $1',
                [groupTrainingId]
            );
            
            if (existingTrainingDetails.rows.length > 0) {
                selectedInstructorId = existingTrainingDetails.rows[0].instructor_id || selectedInstructorId;
                locationFromTraining = existingTrainingDetails.rows[0].location || locationFromTraining;
            }
            
            // Проверяем, есть ли свободные места
            const freePlaces = existingTraining.max_participants - existingTraining.current_participants;
            if (freePlaces < state.data.selected_participants.length) {
                await client.query('ROLLBACK');
                return bot.sendMessage(chatId,
                    `❌ В этой групповой тренировке недостаточно свободных мест.\n\n` +
                    `Доступно: ${freePlaces} мест\n` +
                    `Требуется: ${state.data.selected_participants.length} мест\n\n` +
                    `Выберите другой слот или другую дату.`,
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            console.log(`ℹ️ Используем существующую групповую тренировку id=${groupTrainingId} для слота ${state.data.selected_slot_id}, инструктор ID: ${selectedInstructorId}`);
        } else {
            // Создаем новую групповую тренировку (ЗАКРЫТУЮ для "У меня своя группа")
            // is_private = TRUE означает, что к этой тренировке нельзя добавиться
            const groupTrainingResult = await client.query(
                `INSERT INTO kuliga_group_trainings (
                    instructor_id, slot_id, date, start_time, end_time,
                    sport_type, level, price_per_person,
                    min_participants, max_participants, current_participants, status, is_private
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', TRUE)
                RETURNING id`,
                [
                    state.data.selected_instructor_id,
                    state.data.selected_slot_id,
                    state.data.selected_date,
                    state.data.selected_start_time,
                    state.data.selected_end_time,
                    state.data.selected_sport,
                    'beginner',
                    state.data.price_per_person,
                    state.data.selected_participants.length,
                    state.data.selected_participants.length,
                    state.data.selected_participants.length,
                ]
            );

            groupTrainingId = groupTrainingResult.rows[0].id;

            // Обновляем статус слота
            await client.query(
                `UPDATE kuliga_schedule_slots
                 SET status = 'group', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [state.data.selected_slot_id]
            );
            
            console.log(`✅ Создана новая закрытая групповая тренировка id=${groupTrainingId} для слота ${state.data.selected_slot_id}`);
        }

        // Создаем бронирование
        // ВАЖНО: Для "своя группа" мы создали групповую тренировку, поэтому используем только group_training_id
        // instructor_id и slot_id должны быть NULL согласно констрейнту
        const participantsNames = state.data.selected_participants.map(p => p.fullName);
        const participantsBirthYears = state.data.selected_participants.map(p => p.birthYear);

        // Получаем location из групповой тренировки или из state
        // locationFromTraining уже получен выше для существующей тренировки
        const location = locationFromTraining;
        
        const bookingResult = await client.query(
            `INSERT INTO kuliga_bookings (
                client_id, booking_type, instructor_id, slot_id, group_training_id,
                date, start_time, end_time, sport_type,
                participants_count, participants_names, participants_birth_years,
                price_id, price_total, price_per_person, location, status
            ) VALUES ($1, 'group', NULL, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'confirmed')
            RETURNING id`,
            [
                state.data.client_id,
                groupTrainingId,
                state.data.selected_date,
                state.data.selected_start_time,
                state.data.selected_end_time,
                state.data.selected_sport,
                state.data.selected_participants.length,
                participantsNames,
                participantsBirthYears,
                state.data.price_id,
                totalPrice,
                state.data.price_per_person,
                location, // МИГРАЦИЯ 038: Передаем location
            ]
        );

        const bookingId = bookingResult.rows[0].id;

        // Списываем средства с кошелька
        await client.query(
            `UPDATE wallets SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP WHERE client_id = $2`,
            [totalPrice, state.data.client_id]
        );

        // Создаем транзакцию
        const description = `Групповая тренировка Кулига: ${state.data.selected_sport === 'ski' ? 'лыжи' : 'сноуборд'} ${moment(state.data.selected_date).format('DD.MM.YYYY')}, ${String(state.data.selected_start_time).substring(0, 5)}`;
        await client.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
             VALUES ($1, $2, 'payment', $3)`,
            [clientData.wallet_id, -totalPrice, description]
        );

        await client.query('COMMIT');

        // Получаем данные инструктора для уведомления
        // selectedInstructorId может быть из существующей тренировки или из state
        const instructorResult = await pool.query(
            'SELECT full_name, telegram_id, admin_percentage FROM kuliga_instructors WHERE id = $1',
            [selectedInstructorId]
        );
        const instructor = instructorResult.rows[0] || {};
        const adminPercentage = instructor.admin_percentage !== null && instructor.admin_percentage !== undefined 
            ? Number(instructor.admin_percentage) 
            : 20; // По умолчанию 20%

        // Отправляем уведомления
        setImmediate(async () => {
            try {
                if (instructor.telegram_id) {
                    // location уже получен выше (locationFromTraining)
                    await notifyInstructorKuligaTrainingBooking({
                        instructor_telegram_id: instructor.telegram_id,
                        instructor_name: instructor.full_name || state.data.selected_instructor_name,
                        client_name: clientData.full_name,
                        participant_name: participantsNames.join(', '),
                        participants_count: state.data.selected_participants.length,
                        client_phone: clientData.phone,
                        date: state.data.selected_date,
                        time: String(state.data.selected_start_time).substring(0, 5),
                        booking_type: 'group',
                        price: totalPrice,
                        admin_percentage: adminPercentage,
                        location: location, // МИГРАЦИЯ 038: Передаем location
                    });
                }

                await notifyAdminNaturalSlopeTrainingBooking({
                    client_name: clientData.full_name,
                    client_phone: clientData.phone,
                    participant_name: participantsNames.join(', '),
                    date: state.data.selected_date, // Передаем дату без форматирования
                    time: String(state.data.selected_start_time).substring(0, 5),
                    sport_type: state.data.selected_sport === 'ski' ? 'лыжи' : 'сноуборд',
                    instructor_name: instructor.full_name || state.data.selected_instructor_name,
                    price: totalPrice,
                    booking_type: 'group',
                    participants_count: state.data.selected_participants.length,
                    location: location, // МИГРАЦИЯ 038: Передаем location для корректного отображения места
                });
            } catch (notificationError) {
                console.error('Ошибка при отправке уведомлений:', notificationError);
            }
        });

        // Сообщение клиенту
        const date = moment(state.data.selected_date).tz('Asia/Yekaterinburg');
        const dateStr = date.format('DD.MM.YYYY');
        const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.day()];
        const timeStr = String(state.data.selected_start_time).substring(0, 5);

        // Формируем список участников с возрастом
        const participantsWithAge = state.data.selected_participants.map(p => `${p.fullName} (${p.age})`).join(', ');

        const bookingLocation = state.data.location || locationFromTraining || 'kuliga';
        const locationName = getLocationDisplayName(bookingLocation);
        let message = `✅ *Групповая тренировка в ${locationName} успешно забронирована!*\n\n`;
        message += `👤 *Участники:* ${participantsWithAge}\n`;
        message += `📅 *Дата:* ${dateStr} (${dayName})\n`;
        message += `⏰ *Время:* ${timeStr}\n`;
        message += `🎿 *Вид спорта:* ${state.data.selected_sport === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
        message += `👨‍🏫 *Инструктор:* ${instructor.full_name || state.data.selected_instructor_name}\n`;
        message += `🏔️ *Место:* ${locationName}\n`;
        message += `💰 *Стоимость:* ${totalPrice.toFixed(2)} руб.\n`;
        message += `💳 *Остаток на балансе:* ${(balance - totalPrice).toFixed(2)} руб.\n\n`;
        message += `🎿 Удачной тренировки!`;

        userStates.delete(chatId);

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [['🔙 Назад в меню']],
                resize_keyboard: true
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании бронирования (своя группа):', error);
        return bot.sendMessage(chatId,
            `❌ Произошла ошибка: ${error.message}\n\nПопробуйте позже или обратитесь в поддержку.`,
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    } finally {
        client.release();
    }
}

/**
 * Создание бронирования для "Записаться в группу"
 */
async function createKuligaExistingGroupBooking(chatId, state) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const clientResult = await client.query(
            `SELECT c.id, c.full_name, c.phone, c.email, c.birth_date, w.id as wallet_id, w.balance
             FROM clients c
             LEFT JOIN wallets w ON c.id = w.client_id
             WHERE c.id = $1`,
            [state.data.client_id]
        );

        if (!clientResult.rows.length) {
            await client.query('ROLLBACK');
            return bot.sendMessage(chatId, '❌ Клиент не найден.');
        }

        const clientData = clientResult.rows[0];
        const balance = parseFloat(clientData.balance || 0);
        const totalPrice = parseFloat(state.data.total_price || 0);

        if (balance < totalPrice) {
            await client.query('ROLLBACK');
            return bot.sendMessage(chatId,
                `❌ Недостаточно средств.\nТребуется: ${totalPrice.toFixed(2)} руб.\nДоступно: ${balance.toFixed(2)} руб.`,
                {
                    reply_markup: {
                        keyboard: [['💳 Пополнить баланс'], ['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        const trainingResult = await client.query(
            `SELECT id, instructor_id, date, start_time, end_time, sport_type,
                    price_per_person, max_participants
             FROM kuliga_group_trainings
             WHERE id = $1
             FOR UPDATE`,
            [state.data.selected_training_id]
        );

        if (!trainingResult.rows.length) {
            await client.query('ROLLBACK');
            return bot.sendMessage(chatId, '❌ Групповая тренировка не найдена.');
        }

        const training = trainingResult.rows[0];

        // Пересчитываем текущее количество участников из бронирований
        const participantsCountResult = await client.query(
            `SELECT COALESCE(SUM(participants_count), 0)::INTEGER as current_participants
             FROM kuliga_bookings
             WHERE group_training_id = $1
               AND status IN ('pending', 'confirmed')`,
            [state.data.selected_training_id]
        );
        
        const currentParticipants = participantsCountResult.rows[0]?.current_participants || 0;
        const participants = state.data.selected_participants || [];
        const newParticipantsCount = participants.length;

        if (currentParticipants + newParticipantsCount > training.max_participants) {
            await client.query('ROLLBACK');
            return bot.sendMessage(chatId, 
                `❌ Группа заполнена. Выберите другую тренировку.\n\n` +
                `Занято мест: ${currentParticipants}/${training.max_participants}\n` +
                `Требуется: ${newParticipantsCount} мест`,
                {
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        const participantsNames = participants.map(p => p.fullName);
        const participantsBirthYears = participants.map(p => p.birthYear);

        // Получаем location из групповой тренировки
        const trainingLocationResult = await client.query(
            'SELECT location FROM kuliga_group_trainings WHERE id = $1',
            [state.data.selected_training_id]
        );
        const location = trainingLocationResult.rows[0]?.location || state.data.location || 'kuliga';
        
        const bookingResult = await client.query(
            `INSERT INTO kuliga_bookings (
                client_id, booking_type, group_training_id,
                date, start_time, end_time, sport_type,
                participants_count, participants_names, participants_birth_years,
                price_total, price_per_person, location, status
            ) VALUES ($1, 'group', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'confirmed')
            RETURNING id`,
            [
                state.data.client_id,
                state.data.selected_training_id,
                training.date,
                training.start_time,
                training.end_time,
                training.sport_type,
                participants.length,
                participantsNames,
                participantsBirthYears,
                totalPrice,
                training.price_per_person,
                location, // МИГРАЦИЯ 038: Передаем location
            ]
        );

        await client.query(
            `UPDATE kuliga_group_trainings
             SET current_participants = current_participants + $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [participants.length, state.data.selected_training_id]
        );

        await client.query(
            `UPDATE wallets SET balance = balance - $1, last_updated = CURRENT_TIMESTAMP WHERE client_id = $2`,
            [totalPrice, state.data.client_id]
        );

        const description = `Групповая тренировка Кулига: ${training.sport_type === 'ski' ? 'лыжи' : 'сноуборд'} ${moment(training.date).format('DD.MM.YYYY')}, ${String(training.start_time).substring(0, 5)}`;
        await client.query(
            `INSERT INTO transactions (wallet_id, amount, type, description)
             VALUES ($1, $2, 'payment', $3)`,
            [clientData.wallet_id, -totalPrice, description]
        );

        await client.query('COMMIT');

        const instructorResult = await pool.query(
            'SELECT full_name, telegram_id, admin_percentage FROM kuliga_instructors WHERE id = $1',
            [training.instructor_id]
        );
        const instructor = instructorResult.rows[0] || {};

        setImmediate(async () => {
            try {
                if (instructor.telegram_id) {
                    // location уже получен выше на строке 14228
                    await notifyInstructorKuligaTrainingBooking({
                        instructor_telegram_id: instructor.telegram_id,
                        instructor_name: instructor.full_name || state.data.selected_instructor_name,
                        client_name: clientData.full_name,
                        participant_name: participantsNames.join(', '),
                        client_phone: clientData.phone,
                        date: training.date,
                        time: String(training.start_time).substring(0, 5),
                        booking_type: 'group',
                        price: totalPrice,
                        admin_percentage: Number(instructor.admin_percentage || 20),
                        location: location, // МИГРАЦИЯ 038: Передаем location
                    });
                }

                await notifyAdminNaturalSlopeTrainingBooking({
                    client_name: clientData.full_name,
                    client_phone: clientData.phone,
                    participant_name: participantsNames.join(', '),
                    date: moment(training.date).format('DD.MM.YYYY'),
                    time: String(training.start_time).substring(0, 5),
                    sport_type: training.sport_type === 'ski' ? 'лыжи' : 'сноуборд',
                    instructor_name: instructor.full_name || state.data.selected_instructor_name,
                    price: totalPrice,
                    booking_type: 'group',
                    participants_count: participants.length,
                    location: location, // МИГРАЦИЯ 038: Передаем location для корректного отображения места
                });
            } catch (notificationError) {
                console.error('Ошибка при отправке уведомлений:', notificationError);
            }
        });

        const date = moment(training.date).tz('Asia/Yekaterinburg');
        const dateStr = date.format('DD.MM.YYYY');
        const dayName = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.day()];
        const timeStr = String(training.start_time).substring(0, 5);

        // Формируем список участников с возрастом
        const participantsWithAge = participants.map(p => `${p.fullName} (${p.age})`).join(', ');

        const finalLocation = training.location || state.data.location || 'kuliga';
        const locationName = getLocationDisplayName(finalLocation);
        let message = `✅ *Групповая тренировка в ${locationName} успешно забронирована!*\n\n`;
        message += `👤 *Участник:* ${participantsWithAge}\n`;
        message += `📅 *Дата:* ${dateStr} (${dayName})\n`;
        message += `⏰ *Время:* ${timeStr}\n`;
        message += `🎿 *Вид спорта:* ${training.sport_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
        message += `👨‍🏫 *Инструктор:* ${instructor.full_name || state.data.selected_instructor_name}\n`;
        message += `🏔️ *Место:* ${locationName}\n`;
        message += `💰 *Стоимость:* ${totalPrice.toFixed(2)} руб.\n`;
        message += `💳 *Остаток на балансе:* ${(balance - totalPrice).toFixed(2)} руб.\n\n`;
        message += `🎿 Удачной тренировки!`;

        userStates.delete(chatId);

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [['🔙 Назад в меню']],
                resize_keyboard: true
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Ошибка при создании бронирования (существующая группа):', error);
        return bot.sendMessage(chatId,
            `❌ Ошибка: ${error.message}\n\nПопробуйте позже или обратитесь в поддержку.`,
            {
                reply_markup: {
                    keyboard: [['🔙 Назад в меню']],
                    resize_keyboard: true
                }
            }
        );
    } finally {
        client.release();
    }
}
