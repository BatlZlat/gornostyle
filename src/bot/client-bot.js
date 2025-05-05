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
    
    // Очищаем предыдущее состояние
    userStates.delete(chatId);
    
    if (!client) {
        await bot.sendMessage(chatId,
            '🎿 Добро пожаловать в Ski-instruktor! 🏔\n\n' +
            '🌟 Я - ваш персональный помощник в мире горнолыжного спорта!\n\n' +
            'Я помогу вам:\n' +
            '• 📝 Записаться на тренировки на горнолыжном тренажере\n' +
            '• ⛷ Забронировать занятия в Кулиге зимой\n' +
            '• 💳 Управлять вашим балансом\n' +
            '• 🎁 Приобрести подарочные сертификаты\n\n' +
            '🚀 Давайте начнем! Нажмите на кнопку "Запуск сервиса Ski-instruktor" внизу экрана, и я помогу вам зарегистрироваться в системе! 🎯',
            {
                reply_markup: {
                    keyboard: [[{ text: '🚀 Запуск сервиса Ski-instruktor' }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            }
        );
        userStates.set(chatId, {
            step: 'wait_start',
            data: { telegram_id: telegramId, username, nickname }
        });
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
    if (state && state.step === 'wait_start' && msg.text === '🚀 Запуск сервиса Ski-instruktor') {
        state.step = 'full_name';
        return bot.sendMessage(chatId, 'Введите ваше полное имя (ФИО):');
    }
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
                const registrationChildBirthDate = validateDate(msg.text);
                if (!registrationChildBirthDate) return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
                state.data.child.birth_date = registrationChildBirthDate;
                await finishRegistration(chatId, state.data);
                return;
            case 'edit_full_name':
                if (msg.text.length < 5) return bot.sendMessage(chatId, 'Имя должно содержать минимум 5 символов. Попробуйте еще раз:');
                try {
                    await pool.query('UPDATE clients SET full_name = $1 WHERE telegram_id = $2', [msg.text, state.data.telegram_id]);
                    await bot.sendMessage(chatId, '✅ ФИО успешно обновлено!');
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении данных. Попробуйте позже.');
                }
            case 'edit_phone':
                const newPhone = validatePhone(msg.text);
                if (!newPhone) return bot.sendMessage(chatId, 'Неверный формат номера телефона. Используйте формат +79999999999:');
                try {
                    await pool.query('UPDATE clients SET phone = $1 WHERE telegram_id = $2', [newPhone, state.data.telegram_id]);
                    await bot.sendMessage(chatId, '✅ Номер телефона успешно обновлен!');
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении данных. Попробуйте позже.');
                }
            case 'add_child_name':
                if (msg.text.length < 5) return bot.sendMessage(chatId, 'Имя ребенка должно содержать минимум 5 символов. Попробуйте еще раз:');
                state.data.child_name = msg.text;
                state.step = 'add_child_birth_date';
                return bot.sendMessage(chatId, 'Введите дату рождения ребенка в формате ДД.ММ.ГГГГ:');
            case 'add_child_birth_date':
                const newChildBirthDate = validateDate(msg.text);
                if (!newChildBirthDate) return bot.sendMessage(chatId, 'Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:');
                try {
                    const client = await getClientByTelegramId(state.data.telegram_id);
                    await pool.query(
                        'INSERT INTO children (parent_id, full_name, birth_date) VALUES ($1, $2, $3)',
                        [client.id, state.data.child_name, newChildBirthDate]
                    );
                    await bot.sendMessage(chatId, '✅ Ребенок успешно добавлен!');
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Произошла ошибка при добавлении ребенка. Попробуйте позже.');
                }
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
                    { 
                        parse_mode: 'Markdown', 
                        reply_markup: { 
                            keyboard: [
                                ['➕ Добавить ребенка'],
                                ['✏️ Редактировать данные'],
                                ['🔙 Назад в меню']
                            ], 
                            resize_keyboard: true 
                        } 
                    }
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
                    { 
                        parse_mode: 'Markdown', 
                        reply_markup: { 
                            keyboard: [
                                ['💳 Пополнить кошелек'],
                                ['🔙 Назад в меню']
                            ], 
                            resize_keyboard: true 
                        } 
                    }
                );
            }
            break;
        }
        case '💳 Пополнить кошелек': {
            const paymentLink = process.env.PAYMENT_LINK;
            const adminPhone = process.env.ADMIN_PHONE || '+79123924956';
            if (!paymentLink) {
                return bot.sendMessage(chatId, 'Извините, в данный момент пополнение кошелька недоступно.');
            }
            const client = await getClientByTelegramId(msg.from.id.toString());
            if (!client) {
                return bot.sendMessage(chatId, 'Пожалуйста, сначала зарегистрируйтесь в системе.');
            }
            return bot.sendMessage(chatId,
                '✨ *Пополняйте баланс легко и быстро всего в 1 клик!*\n\n' +
                '*Вот как это работает:*\n' +
                '1️⃣ Нажмите на ссылку ниже\n' +
                '2️⃣ Укажите в комментарии номер вашего кошелька\n' +
                `💎 *КОШЕЛЕК:* \`${client.wallet_number}\`\n\n` +
                '3️⃣ В течение 15 минут баланс будет пополнен\n\n' +
                `👉 [Пополнить баланс](${paymentLink}) 👈\n\n` +
                '⚡ Ваши деньги прилетят к нам в течении 15 минут!\n\n' +
                '💫 Горнолыжные приключения ждут вас! ⛷️✨\n\n' +
                `*P.S.* Нужна помощь? Свяжитесь с администратором ${adminPhone}! 😊`,
                { 
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: { 
                        keyboard: [['🔙 Назад в меню']], 
                        resize_keyboard: true 
                    }
                }
            );
        }
        case '➕ Добавить ребенка': {
            userStates.set(chatId, {
                step: 'add_child_name',
                data: { telegram_id: msg.from.id.toString() }
            });
            return bot.sendMessage(chatId, 'Введите полное имя ребенка (ФИО):');
        }
        case '✏️ Редактировать данные': {
            return bot.sendMessage(chatId, 'Выберите, что хотите отредактировать:', {
                reply_markup: {
                    keyboard: [
                        ['📝 Редактировать ФИО'],
                        ['📱 Редактировать телефон'],
                        ['➕ Добавить ребенка'],
                        ['🔙 Назад в меню']
                    ],
                    resize_keyboard: true
                }
            });
        }
        case '📝 Редактировать ФИО': {
            userStates.set(chatId, {
                step: 'edit_full_name',
                data: { telegram_id: msg.from.id.toString() }
            });
            return bot.sendMessage(chatId, 'Введите новое полное имя (ФИО):');
        }
        case '📱 Редактировать телефон': {
            userStates.set(chatId, {
                step: 'edit_phone',
                data: { telegram_id: msg.from.id.toString() }
            });
            return bot.sendMessage(chatId, 'Введите новый номер телефона в формате +79999999999:');
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