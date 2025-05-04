require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');

// Настройка подключения к БД
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const userStates = new Map();

function showMainMenu(chatId) {
    return bot.sendMessage(chatId, 'Выберите действие:', {
        reply_markup: {
            keyboard: [
                ['📝 Записаться на тренировку'],
                ['📋 Мои записи', '👤 Личный кабинет'],
                ['🎁 Сертификаты', '💰 Кошелек']
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
    const date = new Date(year, month - 1, day);
    if (date.getDate() !== parseInt(day) || date.getMonth() !== parseInt(month) - 1 || date.getFullYear() !== parseInt(year)) return null;
    return date.toISOString().split('T')[0];
}
function validatePhone(phone) {
    return /^\+7\d{10}$/.test(phone) ? phone : null;
}
function formatWalletNumber(number) {
    return number.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1-$2-$3-$4');
}

// Получение клиента
async function getClientByTelegramId(telegramId) {
    const res = await pool.query(
        `SELECT c.*, w.wallet_number, w.balance FROM clients c LEFT JOIN wallets w ON c.id = w.client_id WHERE c.telegram_id = $1`,
        [telegramId]
    );
    if (res.rows[0] && res.rows[0].wallet_number) {
        res.rows[0].wallet_number = formatWalletNumber(res.rows[0].wallet_number);
    }
    return res.rows[0];
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
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query(
            `INSERT INTO clients (full_name, birth_date, phone, telegram_id, telegram_username, nickname, skill_level) VALUES ($1, $2, $3, $4, $5, $6, NULL) RETURNING id`,
            [data.full_name, data.birth_date, data.phone, data.telegram_id, data.username || null, data.nickname]
        );
        const clientId = res.rows[0].id;
        const walletNumber = await generateUniqueWalletNumber();
        await client.query(`INSERT INTO wallets (client_id, wallet_number, balance) VALUES ($1, $2, 0)`, [clientId, walletNumber]);
        if (data.child) {
            await client.query(`INSERT INTO children (parent_id, full_name, birth_date, sport_type, skill_level) VALUES ($1, $2, $3, NULL, NULL)`, [clientId, data.child.full_name, data.child.birth_date]);
        }
        await client.query('COMMIT');
        return { walletNumber: formatWalletNumber(walletNumber) };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id.toString();
    const username = msg.from.username || '';
    const nickname = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');
    const client = await getClientByTelegramId(telegramId);
    if (!client) {
        userStates.set(chatId, {
            step: 'full_name',
            data: { telegram_id: telegramId, username, nickname }
        });
        await bot.sendMessage(chatId, '👋 Добро пожаловать! Введите ваше полное имя (ФИО):');
    } else {
        await bot.sendMessage(chatId, '🎿 *С возвращением!* Чем могу помочь?', { parse_mode: 'Markdown' });
        showMainMenu(chatId);
    }
});

// Регистрация и меню
bot.on('message', async (msg) => {
    if (msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const state = userStates.get(chatId);
    if (state) {
        switch (state.step) {
            case 'full_name':
                if (msg.text.length < 5) return bot.sendMessage(chatId, 'Имя должно содержать минимум 5 символов. Попробуйте еще раз:');
                state.data.full_name = msg.text;
                state.step = 'birth_date';
                return bot.sendMessage(chatId, 'Введите вашу дату рождения в формате ДД.ММ.ГГГГ:');
            case 'birth_date':
                const birthDate = validateDate(msg.text);
                if (!birthDate) return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
                state.data.birth_date = birthDate;
                state.step = 'phone';
                return bot.sendMessage(chatId, 'Введите ваш номер телефона в формате +79999999999:');
            case 'phone':
                const phone = validatePhone(msg.text);
                if (!phone) return bot.sendMessage(chatId, 'Неверный формат номера телефона. Используйте формат +79999999999:');
                state.data.phone = phone;
                state.step = 'has_child';
                return bot.sendMessage(chatId, 'У вас есть ребенок, которого вы будете записывать на тренировки?', {
                    reply_markup: {
                        keyboard: [['Да', 'Нет']],
                        resize_keyboard: true,
                        one_time_keyboard: false,
                        persistent: true
                    }
                });
            case 'has_child':
                if (msg.text.toLowerCase() === 'да') {
                    state.step = 'child_name';
                    return bot.sendMessage(chatId, 'Введите полное имя ребенка (ФИО):');
                } else {
                    await finishRegistration(chatId, state.data);
                    return;
                }
            case 'child_name':
                if (msg.text.length < 5) return bot.sendMessage(chatId, 'Имя ребенка должно содержать минимум 5 символов. Попробуйте еще раз:');
                state.data.child = { full_name: msg.text };
                state.step = 'child_birth_date';
                return bot.sendMessage(chatId, 'Введите дату рождения ребенка в формате ДД.ММ.ГГГГ:');
            case 'child_birth_date':
                const childBirthDate = validateDate(msg.text);
                if (!childBirthDate) return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
                state.data.child.birth_date = childBirthDate;
                await finishRegistration(chatId, state.data);
                return;
        }
        return;
    }
    // Главное меню
    switch (msg.text) {
        case '📝 Записаться на тренировку':
            return bot.sendMessage(chatId, '🔄 Функция записи на тренировку в разработке.', { reply_markup: { keyboard: [['🔙 Назад в меню']], resize_keyboard: true } });
        case '📋 Мои записи':
            return bot.sendMessage(chatId, '🔄 Функция просмотра записей в разработке.', { reply_markup: { keyboard: [['🔙 Назад в меню']], resize_keyboard: true } });
        case '👤 Личный кабинет': {
            const client = await getClientByTelegramId(msg.from.id.toString());
            let childInfo = 'нет';
            if (client) {
                const childRes = await pool.query('SELECT * FROM children WHERE parent_id = $1', [client.id]);
                if (childRes.rows[0]) {
                    const birthDate = new Date(childRes.rows[0].birth_date);
                    const age = Math.floor((new Date() - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
                    childInfo = `${childRes.rows[0].full_name} (${age} лет)`;
                }
                return bot.sendMessage(chatId,
                    '👤 *Ваша личная информация:*\n' +
                    `📝 *ФИО:* ${client.full_name}\n` +
                    `📅 *Дата рождения:* ${new Date(client.birth_date).toLocaleDateString()}\n` +
                    `📱 *Телефон:* ${client.phone}\n` +
                    `👶 *Ребенок:* ${childInfo}`,
                    { parse_mode: 'Markdown', reply_markup: { keyboard: [['🔙 Назад в меню']], resize_keyboard: true } }
                );
            }
            break;
        }
        case '💰 Кошелек': {
            const client = await getClientByTelegramId(msg.from.id.toString());
            if (client) {
                return bot.sendMessage(chatId,
                    '💰 *Информация о кошельке:*\n' +
                    `🔢 *Номер кошелька:* ${client.wallet_number}\n` +
                    `💵 *Баланс:* ${client.balance || 0} руб.`,
                    { parse_mode: 'Markdown', reply_markup: { keyboard: [['🔙 Назад в меню']], resize_keyboard: true } }
                );
            }
            break;
        }
        case '🎁 Сертификаты':
            return bot.sendMessage(chatId, '🔄 Функция сертификатов в разработке.', { reply_markup: { keyboard: [['🔙 Назад в меню']], resize_keyboard: true } });
        case '🔙 Назад в меню':
            return showMainMenu(chatId);
    }
});

async function finishRegistration(chatId, data) {
    try {
        const { walletNumber } = await registerClient(data);
        await bot.sendMessage(chatId,
            '✅ Регистрация успешно завершена!\n\n' +
            '📝 Ваши данные:\n' +
            `👤 ФИО: ${data.full_name}\n` +
            `📅 Дата рождения: ${new Date(data.birth_date).toLocaleDateString()}\n` +
            `📱 Телефон: ${data.phone}\n` +
            `💳 Номер кошелька: ${walletNumber}\n\n` +
            'Теперь вы можете использовать все функции бота.'
        );
        userStates.delete(chatId);
        showMainMenu(chatId);
    } catch (e) {
        await bot.sendMessage(chatId, 'Произошла ошибка при регистрации. Пожалуйста, попробуйте позже.');
    }
}

console.log('Клиентский бот запущен!'); 