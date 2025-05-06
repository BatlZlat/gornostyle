require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const { notifyNewTrainingRequest } = require('./admin-bot');

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
    // Создаем дату в UTC с учетом часового пояса Екатеринбурга (UTC+5)
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    // Проверяем корректность даты
    if (date.getUTCDate() !== parseInt(day) || 
        date.getUTCMonth() !== parseInt(month) - 1 || 
        date.getUTCFullYear() !== parseInt(year)) {
        return null;
    }
    // Возвращаем дату в формате YYYY-MM-DD
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

// Функция завершения регистрации
async function finishRegistration(chatId, data) {
    try {
        const result = await registerClient(data);
        await bot.sendMessage(chatId,
            '✅ *Регистрация успешно завершена!*\n\n' +
            '🎉 Добро пожаловать в Ski-instruktor!\n\n' +
            'Ваш номер кошелька: `' + result.walletNumber + '`\n\n' +
            'Теперь вы можете:\n' +
            '• 📝 Записаться на тренировки\n' +
            '• 💳 Пополнить баланс\n' +
            '• 🎁 Приобрести сертификаты\n\n' +
            'Выберите действие в меню:',
            {
                parse_mode: 'Markdown',
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

    // Обработка кнопок "Назад"
    if (msg.text === '🔙 Назад') {
        if (state) {
            // Возвращаемся на предыдущий шаг
            switch (state.step) {
                case 'training_frequency':
                    state.step = 'has_group';
                    return bot.sendMessage(chatId,
                        '👥 *У вас есть своя компания и вы хотите все вместе приехать?*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['Да', 'Нет'], ['🔙 Назад']],
                                resize_keyboard: true
                            }
                        }
                    );
                case 'sport_type':
                    state.step = 'training_frequency';
                    return bot.sendMessage(chatId,
                        '🔄 *Как часто вы хотите тренироваться?*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['Регулярно', 'Разово'], ['🔙 Назад']],
                                resize_keyboard: true
                            }
                        }
                    );
                case 'skill_level':
                    state.step = 'sport_type';
                    return bot.sendMessage(chatId,
                        '🏂 *На чем планируете кататься?*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['Лыжи', 'Сноуборд'], ['🔙 Назад']],
                                resize_keyboard: true
                            }
                        }
                    );
                case 'preferred_date':
                    state.step = 'skill_level';
                    return bot.sendMessage(chatId, '📊 *Ваш уровень катания от 0 до 10:*', {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад']],
                            resize_keyboard: true
                        }
                    });
                case 'preferred_time':
                    state.step = 'preferred_date';
                    return bot.sendMessage(chatId,
                        '📅 *Предложите удобную для вас дату в формате ДД.ММ.ГГГГ:*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад']],
                                resize_keyboard: true
                            }
                        }
                    );
            }
        }
        return showMainMenu(chatId);
    }

    if (msg.text === '🔙 Назад в меню') {
        userStates.delete(chatId);
        return showMainMenu(chatId);
    }

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
            case 'edit_data': {
                const client = await getClientByTelegramId(msg.from.id.toString());
                const childRes = await pool.query('SELECT * FROM children WHERE parent_id = $1', [client.id]);
                const hasChild = childRes.rows.length > 0;
                
                if (msg.text === '1. ФИО') {
                    userStates.set(chatId, {
                        step: 'edit_full_name',
                        data: { 
                            telegram_id: msg.from.id.toString()
                        }
                    });
                    return bot.sendMessage(chatId,
                        '📝 *Введите новое ФИО:*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                if (msg.text === '2. Телефон') {
                    userStates.set(chatId, {
                        step: 'edit_phone',
                        data: { 
                            telegram_id: msg.from.id.toString()
                        }
                    });
                    return bot.sendMessage(chatId,
                        '📱 *Введите новый номер телефона в формате +79999999999:*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                if (msg.text === '3. Дата рождения') {
                    userStates.set(chatId, {
                        step: 'edit_birth_date',
                        data: { 
                            telegram_id: msg.from.id.toString()
                        }
                    });
                    return bot.sendMessage(chatId,
                        '📅 *Введите новую дату рождения в формате ДД.ММ.ГГГГ:*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                if (msg.text === '4. ФИО ребенка') {
                    userStates.set(chatId, {
                        step: 'edit_child_name',
                        data: { 
                            telegram_id: msg.from.id.toString(),
                            child_id: childRes.rows[0].id
                        }
                    });
                    return bot.sendMessage(chatId,
                        '👶 *Введите новое ФИО ребенка:*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                
                if (msg.text === '5. Дата рождения ребенка') {
                    userStates.set(chatId, {
                        step: 'edit_child_birth_date',
                        data: { 
                            telegram_id: msg.from.id.toString(),
                            child_id: childRes.rows[0].id
                        }
                    });
                    return bot.sendMessage(chatId,
                        '📅 *Введите новую дату рождения ребенка в формате ДД.ММ.ГГГГ:*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                let message = '✏️ *Что вы хотите изменить?*\n\n' +
                             '1. ФИО\n' +
                             '2. Телефон\n' +
                             '3. Дата рождения';
                 
                if (hasChild) {
                    message += '\n4. ФИО ребенка\n' +
                              '5. Дата рождения ребенка';
                }

                const keyboard = [
                    ['1. ФИО', '2. Телефон'],
                    ['3. Дата рождения']
                ];

                if (hasChild) {
                    keyboard.push(['4. ФИО ребенка', '5. Дата рождения ребенка']);
                }

                keyboard.push(['🔙 Назад в меню']);

                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: keyboard,
                        resize_keyboard: true
                    }
                });
            }
            case 'edit_full_name': {
                if (msg.text.length < 5) {
                    return bot.sendMessage(chatId,
                        '❌ Имя должно содержать минимум 5 символов. Попробуйте еще раз:',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                try {
                    const client = await getClientByTelegramId(state.data.telegram_id);
                    await pool.query(
                        'UPDATE clients SET full_name = $1 WHERE id = $2',
                        [msg.text, client.id]
                    );
                    await bot.sendMessage(chatId, '✅ ФИО успешно обновлено!');
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении данных. Попробуйте позже.');
                }
            }
            case 'edit_phone': {
                const phone = validatePhone(msg.text);
                if (!phone) {
                    return bot.sendMessage(chatId,
                        '❌ Неверный формат номера телефона. Используйте формат +79999999999:',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                try {
                    const client = await getClientByTelegramId(state.data.telegram_id);
                    await pool.query(
                        'UPDATE clients SET phone = $1 WHERE id = $2',
                        [phone, client.id]
                    );
                    await bot.sendMessage(chatId, '✅ Номер телефона успешно обновлен!');
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении данных. Попробуйте позже.');
                }
            }
            case 'edit_birth_date': {
                const birthDate = validateDate(msg.text);
                if (!birthDate) {
                    return bot.sendMessage(chatId,
                        '❌ Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                try {
                    const client = await getClientByTelegramId(state.data.telegram_id);
                    await pool.query(
                        'UPDATE clients SET birth_date = $1 WHERE id = $2',
                        [birthDate, client.id]
                    );
                    await bot.sendMessage(chatId, '✅ Дата рождения успешно обновлена!');
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении данных. Попробуйте позже.');
                }
            }
            case 'edit_child_name': {
                if (msg.text.length < 5) {
                    return bot.sendMessage(chatId,
                        '❌ Имя ребенка должно содержать минимум 5 символов. Попробуйте еще раз:',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                try {
                    await pool.query(
                        'UPDATE children SET full_name = $1 WHERE id = $2',
                        [msg.text, state.data.child_id]
                    );
                    await bot.sendMessage(chatId, '✅ ФИО ребенка успешно обновлено!');
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении данных. Попробуйте позже.');
                }
            }
            case 'edit_child_birth_date': {
                const birthDate = validateDate(msg.text);
                if (!birthDate) {
                    return bot.sendMessage(chatId,
                        '❌ Неверный формат даты. Используйте формат ДД.ММ.ГГГГ:',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                try {
                    await pool.query(
                        'UPDATE children SET birth_date = $1 WHERE id = $2',
                        [birthDate, state.data.child_id]
                    );
                    await bot.sendMessage(chatId, '✅ Дата рождения ребенка успешно обновлена!');
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Произошла ошибка при обновлении данных. Попробуйте позже.');
                }
            }
        }
        return;
    }
    // Главное меню
    switch (msg.text) {
        case '📝 Записаться на тренировку': {
            return bot.sendMessage(chatId,
                '🎿 *Выберите тип тренировки:*\n\n\n' +
                '1️⃣ *Горнолыжный тренажер Горностайл72*\n\n' +
                '2️⃣ *Кулига. Естественный склон* (только зимой)\n\n' +
                'Выберите вариант:',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['🏂 Горнолыжный тренажер'],
                            ['⛷ Кулига.Естественный склон'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }
        case '🏂 Горнолыжный тренажер': {
            try {
                // Получаем групповые тренировки на ближайшие 2 недели
                const twoWeeksFromNow = new Date();
                twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
                
                const result = await pool.query(
                    `SELECT ts.*, g.name as group_name, ts.max_participants, ts.price
                     FROM training_sessions ts
                     JOIN groups g ON ts.group_id = g.id
                     WHERE ts.session_date BETWEEN CURRENT_DATE AND $1
                     AND ts.training_type = true
                     ORDER BY ts.session_date, ts.start_time`,
                    [twoWeeksFromNow]
                );

                let message = '🎯 *Ближайшие групповые тренировки:*\n\n';
                
                if (result.rows.length === 0) {
                    message += 'На ближайшие 2 недели групповых тренировок не запланировано.\n\n';
                    message += '*ВЫ ВСЕГДА МОЖЕТЕ ЗАПИСАТЬСЯ НА ИНДИВИДУАЛЬНУЮ ТРЕНИРОВКУ.*\n\n';
                } else {
                    result.rows.forEach(training => {
                        const date = new Date(training.session_date).toLocaleDateString('ru-RU');
                        message += `📅 *${date} ${training.start_time}*\n`;
                        message += `👥 Группа: ${training.group_name}\n`;
                        message += `👤 Макс. участников: ${training.max_participants}\n`;
                        message += `💰 Цена: ${training.price} руб.\n\n`;
                    });
                }
                message += '*Вы всегда можете записаться не только групповую тренировку, но и на индивидуальную.*\n\n';
                message += 'Выберите действие:';
                
                return bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['📝 Записаться'],
                            ['💡 Предложить тренировку'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                });
            } catch (error) {
                console.error('Ошибка при получении групповых тренировок:', error);
                return bot.sendMessage(chatId, 'Произошла ошибка при загрузке расписания. Попробуйте позже.');
            }
        }
        case '⛷ Естественный склон': {
            return bot.sendMessage(chatId,
                '🔄 *Система записи на естественный склон находится в разработке*\n\n' +
                'Скоро здесь появится возможность записаться на тренировки в Кулиге!',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
        case '📝 Записаться на тренировку': {
            const bookingUrl = process.env.BOOKING_PAGE_URL;
            return bot.sendMessage(chatId,
                '🎯 *Запись на тренировку*\n\n' +
                'Для записи на тренировку перейдите по ссылке ниже:\n' +
                `[Открыть форму записи](${bookingUrl}?simulator=1)\n\n` +
                'После заполнения формы мы свяжемся с вами для подтверждения.',
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
        case '💡 Предложить тренировку': {
            userStates.set(chatId, {
                step: 'has_group',
                data: { telegram_id: msg.from.id.toString() }
            });
            return bot.sendMessage(chatId,
                '👥 *У вас есть своя компания и вы хотите все вместе приехать?*',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['Да', 'Нет']],
                        resize_keyboard: true
                    }
                }
            );
        }
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
            return bot.sendMessage(chatId,
                '👶 *Введите полное имя ребенка (ФИО):*',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
        case '✏️ Редактировать данные': {
            const client = await getClientByTelegramId(msg.from.id.toString());
            const childRes = await pool.query('SELECT * FROM children WHERE parent_id = $1', [client.id]);
            const hasChild = childRes.rows.length > 0;
            
            userStates.set(chatId, {
                step: 'edit_data',
                data: { 
                    telegram_id: msg.from.id.toString(),
                    has_child: hasChild,
                    child_id: hasChild ? childRes.rows[0].id : null
                }
            });

            let message = '✏️ *Что вы хотите изменить?*\n\n' +
                         '1. ФИО\n' +
                         '2. Телефон\n' +
                         '3. Дата рождения';
              
            if (hasChild) {
                message += '\n4. ФИО ребенка\n' +
                           '5. Дата рождения ребенка';
            }

            const keyboard = [
                ['1. ФИО', '2. Телефон'],
                ['3. Дата рождения']
            ];

            if (hasChild) {
                keyboard.push(['4. ФИО ребенка', '5. Дата рождения ребенка']);
            }

            keyboard.push(['🔙 Назад в меню']);

            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true
                }
            });
        }
    }
});