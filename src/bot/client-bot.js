require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const { notifyNewTrainingRequest, notifyNewIndividualTraining } = require('./admin-bot');

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

    console.log('Получено сообщение:', {
        text: msg.text,
        chatId: chatId,
        currentState: state ? state.step : 'no state',
        stateData: state ? state.data : null
    });

    // Обработка кнопок "Назад"
    if (msg.text === '🔙 Назад в меню') {
        userStates.delete(chatId);
        return showMainMenu(chatId);
    }

    // Обработка кнопки "Записаться на тренировку"
    if (msg.text === '📝 Записаться на тренировку') {
        // Получаем информацию о клиенте
        const client = await getClientByTelegramId(msg.from.id.toString());
        if (!client) {
            return bot.sendMessage(chatId,
                '❌ Вы не зарегистрированы в системе. Пожалуйста, начните с команды /start',
                {
                    reply_markup: {
                        keyboard: [['🔙 Назад в меню']],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Устанавливаем начальное состояние
        userStates.set(chatId, {
            step: 'select_location',
            data: {
                client_id: client.id
            }
        });

        return bot.sendMessage(chatId,
            '🏔 *Выберите место тренировки:*\n\n' +
            '• 🎿 Горнолыжный тренажер\n' +
            '• ⛷ Кулига. естественный склон',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['🎿 Горнолыжный тренажер'],
                        ['⛷ Кулига. естественный склон'],
                        ['🔙 Назад в меню']
                    ],
                    resize_keyboard: true
                }
            }
        );
    }

    // Обработка состояний
    if (!state) return;

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
            } else if (msg.text === '💡 Предложить тренировку') {
                console.log('Начало процесса предложения тренировки');
                userStates.set(chatId, {
                    step: 'suggest_has_group',
                    data: { 
                        telegram_id: msg.from.id.toString(),
                        is_suggestion: true // Флаг для различения логики
                    }
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
            break;
        }

        case '💡 Предложить тренировку': {
            console.log('Начало процесса предложения тренировки');
            userStates.set(chatId, {
                step: 'suggest_has_group',
                data: { 
                    telegram_id: msg.from.id.toString(),
                    is_suggestion: true // Флаг для различения логики
                }
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
                                keyboard: [['🔙 Назад в меню']],
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

        case 'suggest_training_frequency': {
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

        case 'suggest_preferred_date': {
            const dateRegex = /^(\d{2})\.(\d{2})\.(\d{4})$/;
            const match = msg.text.match(dateRegex);
            
            if (!match) {
                return bot.sendMessage(chatId,
                    '❌ Неверный формат даты. Пожалуйста, используйте формат ДД.ММ.ГГГГ\n' +
                    'Например: 15.05.2024',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            const [, day, month, year] = match;
            const date = new Date(year, month - 1, day);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if (date < today) {
                return bot.sendMessage(chatId,
                    '❌ Нельзя выбрать прошедшую дату. Пожалуйста, выберите дату не раньше сегодняшней.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            
            const state = userStates.get(chatId);
            state.data.preferred_date = `${year}-${month}-${day}`;
            state.step = 'suggest_preferred_time';
            userStates.set(chatId, state);
            
            return bot.sendMessage(chatId,
                '⏰ *Введите желаемое время в формате ЧЧ:ММ:*\n\n' +
                'Например: 14:30',
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
                    'Например: 14:30',
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
            
            try {
                // Получаем информацию о клиенте
                const clientResult = await pool.query(
                    'SELECT id, full_name, phone FROM clients WHERE telegram_id = $1',
                    [state.data.telegram_id]
                );
                const clientInfo = clientResult.rows[0];

                // Форматируем дату
                const [year, month, day] = state.data.preferred_date.split('-');
                const formattedDate = `${day}.${month}.${year}`;

                // Формируем сообщение с введенными данными
                let summaryMessage = '📝 *Вы заполнили заявку на формирование групповой тренировки*\n\n';
                
                // Добавляем информацию о заказчике
                summaryMessage += `👤 *ФИО:* ${clientInfo.full_name}\n`;
                
                // Добавляем информацию об участниках в зависимости от выбора
                if (state.data.training_for === 'child') {
                    summaryMessage += `👶 *Участник:* ${state.data.child_name}\n`;
                } else if (state.data.training_for === 'both') {
                    summaryMessage += `👥 *Участники:* ${clientInfo.full_name} и ${state.data.child_name}\n`;
                }
                
                summaryMessage += `📱 *Телефон:* ${clientInfo.phone}\n`;
                summaryMessage += state.data.has_group ? 
                    `👥 *Готовая группа:* ${state.data.group_size} человек\n` :
                    `👥 *Ищет группу:* ${state.data.training_for === 'self' ? 'Для себя' : 
                          state.data.training_for === 'child' ? 'Для ребенка' : 'Для себя и ребенка'}\n`;
                summaryMessage += `🔄 *Частота:* ${state.data.training_frequency === 'regular' ? 'Регулярно' : 'Разово'}\n`;
                summaryMessage += `🏂 *Тип:* ${state.data.sport_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
                summaryMessage += `📊 *Уровень:* ${state.data.skill_level}/10\n`;
                summaryMessage += `📅 *Дата:* ${formattedDate}\n`;
                summaryMessage += `⏰ *Время:* ${state.data.preferred_time}\n\n`;
                summaryMessage += 'Выберите действие:';

                state.step = 'confirm_suggestion';
                userStates.set(chatId, state);

                return bot.sendMessage(chatId, summaryMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['✅ Отправить заявку'],
                            ['🔙 Вернуться в главное меню']
                        ],
                        resize_keyboard: true
                    }
                });
            } catch (error) {
                console.error('Ошибка при формировании заявки:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при формировании заявки. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }

        case 'confirm_suggestion': {
            if (msg.text === '✅ Отправить заявку') {
                try {
                    const state = userStates.get(chatId);
                    
                    // Получаем информацию о клиенте
                    const clientResult = await pool.query(
                        'SELECT id, full_name, phone FROM clients WHERE telegram_id = $1',
                        [state.data.telegram_id]
                    );
                    const clientInfo = clientResult.rows[0];

                    // Получаем ID ребенка, если тренировка для ребенка
                    let childId = null;
                    if (state.data.training_for === 'child' || state.data.training_for === 'both') {
                        childId = state.data.child_id;
                    }

                    // Создаем заявку в базе данных
                    const result = await pool.query(
                        `INSERT INTO training_requests (
                            client_id,
                            child_id,
                            equipment_type,
                            duration,
                            preferred_date,
                            preferred_time,
                            has_group,
                            group_size,
                            training_frequency,
                            skill_level
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        RETURNING id`,
                        [
                            clientInfo.id,
                            childId,
                            state.data.sport_type,
                            60,
                            state.data.preferred_date,
                            state.data.preferred_time,
                            state.data.has_group,
                            state.data.group_size || null,
                            state.data.training_frequency,
                            state.data.skill_level
                        ]
                    );

                    // Отправляем уведомление администратору
                    await notifyNewTrainingRequest({
                        id: result.rows[0].id,
                        client_name: clientInfo.full_name,
                        client_phone: clientInfo.phone,
                        has_group: state.data.has_group,
                        group_size: state.data.group_size,
                        training_for: state.data.training_for,
                        training_frequency: state.data.training_frequency,
                        sport_type: state.data.sport_type,
                        skill_level: state.data.skill_level,
                        preferred_date: state.data.preferred_date,
                        preferred_time: state.data.preferred_time
                    });

                    // Очищаем состояние
                    userStates.delete(chatId);

                    // Формируем сообщение об успешной отправке
                    const adminPhone = process.env.ADMIN_PHONE;
                    let successMessage = '✅ *Ваша заявка на формирование групповой тренировки успешно отправлена!*\n\n';
                    successMessage += 'Мы рассмотрим вашу заявку и свяжемся с вами в ближайшее время.\n\n';
                    successMessage += 'Вы также можете связаться с нами для уточнения деталей:\n';
                    successMessage += `📱 Телефон: ${adminPhone}`;

                    return bot.sendMessage(chatId, successMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при сохранении заявки:', error);
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при сохранении заявки. Пожалуйста, попробуйте позже.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            } else if (msg.text === '🔙 Вернуться в главное меню') {
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
        case 'has_child': {
            if (msg.text === 'Да') {
                const state = userStates.get(chatId);
                if (state.data.children.length > 1) {
                    // Если детей несколько, показываем список
                    const childrenList = state.data.children.map((child, index) => 
                        `${index + 1}. ${child.full_name} (${new Date(child.birth_date).toLocaleDateString()})`
                    ).join('\n');

                    state.step = 'select_child';
                    userStates.set(chatId, state);
                    
                    return bot.sendMessage(chatId,
                        '👶 *Выберите ребенка из списка:*\n\n' +
                        childrenList,
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
                } else {
                    // Если ребенок один, сразу переходим к выбору типа тренировки
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
                // Если не хотят записывать ребенка, переходим к выбору типа тренировки для себя
                const state = userStates.get(chatId);
                userStates.set(chatId, {
                    step: 'training_type',
                    data: {
                        client_id: state.data.client_id,
                        is_child: false
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
                                COUNT(sp.id) as current_participants
                            FROM training_sessions ts
                            LEFT JOIN groups g ON ts.group_id = g.id
                            LEFT JOIN simulators s ON ts.simulator_id = s.id
                            LEFT JOIN trainers t ON ts.trainer_id = t.id
                            LEFT JOIN session_participants sp ON ts.id = sp.session_id
                            WHERE ts.training_type = true
                            AND ts.session_date >= CURRENT_DATE
                            AND ts.session_date <= CURRENT_DATE + INTERVAL '14 days'
                            AND ts.status = 'scheduled'
                            GROUP BY ts.id, g.name, s.name, t.full_name
                            HAVING COUNT(sp.id) < ts.max_participants
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
                        result.rows.forEach((session, index) => {
                            const date = new Date(session.session_date);
                            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                            const [hours, minutes] = session.start_time.split(':');
                            const formattedTime = `${hours}:${minutes}`;
                            
                            message += `${index + 1}. ${formattedDate} ${formattedTime}\n`;
                            message += `   • Группа: ${session.group_name}\n`;
                            message += `   • Участников: ${session.current_participants}/${session.max_participants}\n`;
                            message += `   • Уровень: ${session.skill_level}/10\n`;
                            message += `   • Тренажер: ${session.simulator_name}\n`;
                            message += `   • Тренер: ${session.trainer_name}\n`;
                            message += `   • Цена: ${session.price} руб.\n\n`;
                        });

                        message += 'Выберите номер тренировки:';

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ...result.rows.map((_, i) => [`${i + 1}`]),
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        });
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
                    // Существующая логика для индивидуальных тренировок
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
            }
            break;
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
            const date = validateDate(msg.text);
            if (!date) {
                return bot.sendMessage(chatId,
                    '❌ Неверный формат даты. Пожалуйста, используйте формат ДД.ММ.ГГГГ\n' +
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

            const state = userStates.get(chatId);
            state.data.preferred_date = date;

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
                    [date]
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
        case 'select_time': {
            const data = msg.text;
            console.log('Обработка select_time:', {
                data,
                state: state,
                message: msg
            });

            if (data === 'back_to_date') {
                console.log('Возврат к выбору даты');
                // Возвращаемся к выбору даты
                userStates.get(chatId).step = 'preferred_date';
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
                console.log('Попытка выбрать занятое время');
                // Игнорируем нажатие на занятое время
                return bot.answerCallbackQuery(msg.id, {
                    text: 'Это время уже занято',
                    show_alert: true
                });
            }

            if (data.startsWith('time_')) {
                console.log('Обработка выбора времени:', data);
                const [, simulatorId, time] = data.split('_');
                console.log('Разобранные данные:', { simulatorId, time });
                
                try {
                    console.log('Получение баланса клиента:', state.data.client_id);
                    // Получаем баланс клиента
                    const balanceResult = await pool.query(
                        'SELECT balance FROM wallets WHERE client_id = $1',
                        [state.data.client_id]
                    );
                    console.log('Результат запроса баланса:', balanceResult.rows[0]);
                    const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
                    const price = parseFloat(state.data.price);
                    console.log('Баланс и цена:', { balance, price });

                    // Получаем информацию о тренажере
                    const simulatorResult = await pool.query(
                        'SELECT name FROM simulators WHERE id = $1',
                        [simulatorId]
                    );
                    const simulatorName = simulatorResult.rows[0].name;

                    // Форматируем дату и время
                    const [year, month, day] = state.data.preferred_date.split('-');
                    const formattedDate = `${day}.${month}.${year}`;
                    const [hours, minutes] = time.split(':');
                    const formattedTime = `${hours}:${minutes}`;
                    console.log('Отформатированные дата и время:', { formattedDate, formattedTime });

                    // Формируем итоговое сообщение
                    let summaryMessage = '📋 *Проверьте данные заявки:*\n\n';
                    summaryMessage += '*Детали тренировки:*\n';
                    if (state.data.is_child) {
                        summaryMessage += `• ФИО участника: ${state.data.child_name}\n`;
                    } else {
                        const clientResult = await pool.query(
                            'SELECT full_name FROM clients WHERE id = $1',
                            [state.data.client_id]
                        );
                        summaryMessage += `• ФИО участника: ${clientResult.rows[0].full_name}\n`;
                    }
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
                    console.log('Сформированное сообщение:', summaryMessage);

                    // Сохраняем состояние для следующего шага
                    state.step = 'confirm_booking';
                    state.data.preferred_time = time;
                    state.data.simulator_id = simulatorId;
                    state.data.simulator_name = simulatorName;
                    userStates.set(chatId, state);
                    console.log('Обновленное состояние:', state);

                    // Удаляем сообщение с кнопками
                    console.log('Удаление сообщения с кнопками:', msg.message_id);
                    await bot.deleteMessage(chatId, msg.message_id);

                    // Отвечаем на callback-запрос
                    console.log('Отправка ответа на callback-запрос');
                    await bot.answerCallbackQuery(msg.id);

                    console.log('Отправка итогового сообщения');
                    return bot.sendMessage(chatId, summaryMessage, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['✅ Записаться на тренировку'],
                                ['❌ Я передумал'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при проверке времени:', error);
                    console.error('Детали ошибки:', {
                        error: error.message,
                        stack: error.stack,
                        state: state,
                        data: msg
                    });
                    await bot.answerCallbackQuery(msg.id, {
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
        }
        case 'confirm_booking': {
            const state = userStates.get(chatId);
            
            if (msg.text === '✅ Записаться на тренировку') {
                try {
                    // Получаем информацию о клиенте
                    const clientResult = await pool.query(
                        'SELECT id, full_name, phone FROM clients WHERE id = $1',
                        [state.data.client_id]
                    );
                    
                    if (!clientResult.rows[0]) {
                        console.error('Клиент не найден:', { client_id: state.data.client_id });
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

                    const clientInfo = clientResult.rows[0];

                    // Проверяем баланс
                    const balanceResult = await pool.query(
                        'SELECT balance FROM wallets WHERE client_id = $1',
                        [clientInfo.id]
                    );
                    const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
                    const price = parseFloat(state.data.price);

                    if (balance < price) {
                        return bot.sendMessage(chatId,
                            '❌ На вашем балансе недостаточно средств для записи на тренировку.\n' +
                            'Пожалуйста, пополните баланс и попробуйте снова.',
                            {
                                reply_markup: {
                                    keyboard: [['💳 Пополнить кошелек'], ['🔙 Назад в меню']],
                                    resize_keyboard: true
                                }
                            }
                        );
                    }

                    // Создаем запись в базе данных
                    const result = await pool.query(
                        `INSERT INTO individual_training_sessions (
                            client_id,
                            child_id,
                            equipment_type,
                            with_trainer,
                            duration,
                            preferred_date,
                            preferred_time,
                            simulator_id,
                            price
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        RETURNING id`,
                        [
                            clientInfo.id,
                            state.data.is_child ? state.data.child_id : null,
                            state.data.equipment_type,
                            state.data.with_trainer,
                            state.data.duration,
                            state.data.preferred_date,
                            state.data.preferred_time,
                            state.data.simulator_id,
                            state.data.price
                        ]
                    );

                    // Бронируем слоты в расписании
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

                    // Бронируем каждый слот
                    for (const slot of slotsToBook.rows) {
                        await pool.query(
                            'UPDATE schedule SET is_booked = true WHERE id = $1',
                            [slot.id]
                        );
                    }

                    // Обновляем баланс клиента
                    await pool.query(
                        'UPDATE wallets SET balance = balance - $1 WHERE client_id = $2',
                        [state.data.price, clientInfo.id]
                    );

                    // Получаем ID кошелька для создания транзакции
                    const walletResult = await pool.query(
                        'SELECT id FROM wallets WHERE client_id = $1',
                        [clientInfo.id]
                    );
                    const walletId = walletResult.rows[0].id;

                    // Формируем описание транзакции
                    const transactionDescription = 
                        `Индивидуальная тренировка; ` +
                        `Дата: ${state.data.preferred_date}; ` +
                        `Время: ${state.data.preferred_time}; ` +
                        `Длительность: ${state.data.duration} минут`;

                    // Создаем запись о транзакции
                    await pool.query(
                        `INSERT INTO transactions (
                            wallet_id,
                            amount,
                            type,
                            description
                        ) VALUES ($1, $2, 'payment', $3)`,
                        [
                            walletId,
                            state.data.price,
                            transactionDescription
                        ]
                    );

                    // Форматируем дату и время
                    const [year, month, day] = state.data.preferred_date.split('-');
                    const formattedDate = `${day}.${month}.${year}`;
                    const [hours, minutes] = state.data.preferred_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    // Формируем сообщение об успешной записи
                    let message = '✅ *Запись на тренировку успешно создана!*\n\n';
                    message += `📅 Дата: ${formattedDate}\n`;
                    message += `⏰ Время: ${formattedTime}\n`;
                    message += `🎿 Тип тренировки: Индивидуальная\n`;
                    message += `🏂 Тренажер: ${state.data.simulator_name}\n`;
                    message += `💰 Сумма списания: ${state.data.price} руб.\n`;
                    
                    if (state.data.is_child) {
                        message += `👶 Ребенок: ${state.data.child_name}\n`;
                    }

                    message += '\nПроверить запись вы можете на главной странице бота, нажав кнопку Мои Записи.';

                    // Отправляем уведомление администратору
                    const adminMessage = 
                        '📝 *Новая индивидуальная тренировка*\n\n' +
                        `👤 *ФИО:* ${clientInfo.full_name}\n` +
                        `📱 *Телефон:* ${clientInfo.phone}\n` +
                        `🎿 *Тип:* Индивидуальная\n` +
                        `🏂 *Снаряжение:* ${state.data.equipment_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n` +
                        `👨‍🏫 *Тренер:* ${state.data.with_trainer ? 'С тренером' : 'Без тренера'}\n` +
                        `⏱ *Длительность:* ${state.data.duration} минут\n` +
                        `📅 *Дата:* ${formattedDate}\n` +
                        `⏰ *Время:* ${formattedTime}\n` +
                        `💰 *Стоимость:* ${state.data.price} руб.`;

                    // Импортируем и вызываем функцию уведомления администратора
                    await notifyNewIndividualTraining({
                        id: result.rows[0].id,
                        client_name: clientInfo.full_name,
                        child_name: state.data.is_child ? state.data.child_name : null,
                        client_phone: clientInfo.phone,
                        with_trainer: state.data.with_trainer,
                        equipment_type: state.data.equipment_type,
                        duration: state.data.duration,
                        simulator_id: state.data.simulator_id,
                        simulator_name: state.data.simulator_name,
                        price: state.data.price,
                        preferred_date: formattedDate,
                        preferred_time: formattedTime
                    });

                    // Очищаем состояние
                    userStates.delete(chatId);

                    return bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    console.error('Ошибка при создании записи:', {
                        error: error.message,
                        stack: error.stack,
                        state: state,
                        data: msg
                    });
                    return bot.sendMessage(chatId,
                        '❌ Произошла ошибка при создании записи. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
            } else if (msg.text === '❌ Я передумал') {
                userStates.delete(chatId);
                return bot.sendMessage(chatId,
                    '❌ Запись на тренировку отменена.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
            } else if (msg.text === '🔙 Назад в меню') {
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
                            keyboard: [['🔙 Назад в меню']],
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
                    '❌ Пожалуйста, выберите номер тренировки из списка.',
                    {
                        reply_markup: {
                            keyboard: [
                                ...state.data.available_sessions.map((_, i) => [`${i + 1}`]),
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const selectedSession = state.data.available_sessions[selectedIndex];

            // Проверяем баланс клиента
            const walletResult = await pool.query(
                'SELECT w.*, c.full_name, c.phone FROM wallets w JOIN clients c ON w.client_id = c.id WHERE w.client_id = $1',
                [state.data.client_id]
            );

            const wallet = walletResult.rows[0];
            const requiredAmount = parseFloat(selectedSession.price);
            const currentBalance = parseFloat(wallet.balance);

            // Форматируем дату и время
            const date = new Date(selectedSession.session_date);
            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
            const [hours, minutes] = selectedSession.start_time.split(':');
            const formattedTime = `${hours}:${minutes}`;

            // Формируем сообщение с деталями тренировки
            let message = '📋 *Проверьте данные тренировки:*\n\n';
            if (state.data.selected_child) {
                message += `👶 Ребенок: ${state.data.selected_child.full_name}\n`;
            }
            message += `📅 Дата: ${formattedDate}\n`;
            message += `⏰ Время: ${formattedTime}\n`;
            message += `👥 Группа: ${selectedSession.group_name}\n`;
            message += `👥 Участников: ${selectedSession.current_participants}/${selectedSession.max_participants}\n`;
            message += `📊 Уровень: ${selectedSession.skill_level}/10\n`;
            message += `🎿 Тренажер: ${selectedSession.simulator_name}\n`;
            message += `👨‍🏫 Тренер: ${selectedSession.trainer_name}\n`;
            message += `💰 Цена: ${requiredAmount.toFixed(2)} руб.\n`;
            message += `💳 Баланс: ${currentBalance.toFixed(2)} руб.\n\n`;
            message += 'Выберите действие:';

            // Сохраняем выбранную тренировку в состоянии
            state.data.selected_session = selectedSession;
            state.step = 'confirm_group_training';
            userStates.set(chatId, state);

            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['✅ Записаться на тренировку'],
                        ['❌ Я передумал'],
                        ['🔙 Назад в меню']
                    ],
                    resize_keyboard: true
                }
            });
        }
        case 'confirm_group_training': {
            if (msg.text !== '✅ Записаться на тренировку') {
                return bot.sendMessage(chatId,
                    '❌ Запись отменена. Выберите действие:',
                    {
                        reply_markup: {
                            keyboard: [
                                ['🎿 Записаться на тренировку'],
                                ['📋 Мои записи'],
                                ['👤 Мой профиль'],
                                ['❓ Помощь']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const state = userStates.get(chatId);
            const selectedSession = state.data.selected_session;

            try {
                // Проверяем баланс клиента
                const walletResult = await pool.query(
                    'SELECT w.*, c.full_name, c.phone FROM wallets w JOIN clients c ON w.client_id = c.id WHERE w.client_id = $1',
                    [state.data.client_id]
                );

                const wallet = walletResult.rows[0];
                const requiredAmount = parseFloat(selectedSession.price);
                const currentBalance = parseFloat(wallet.balance);

                if (!wallet || currentBalance < requiredAmount) {
                    return bot.sendMessage(chatId,
                        `❌ Недостаточно средств на счете. Требуется: ${requiredAmount.toFixed(2)} руб.\nТекущий баланс: ${currentBalance.toFixed(2)} руб.`,
                        {
                            reply_markup: {
                                keyboard: [
                                    ['💳 Пополнить счет'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                // Проверяем, не заполнена ли группа
                const participantsResult = await pool.query(
                    'SELECT COUNT(*) as count FROM session_participants WHERE session_id = $1',
                    [selectedSession.id]
                );

                if (participantsResult.rows[0].count >= selectedSession.max_participants) {
                    return bot.sendMessage(chatId,
                        '❌ К сожалению, группа уже заполнена. Пожалуйста, выберите другую тренировку.',
                        {
                            reply_markup: {
                                keyboard: [
                                    ['🎿 Записаться на тренировку'],
                                    ['📋 Мои записи'],
                                    ['👤 Мой профиль'],
                                    ['❓ Помощь']
                                ],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                // Начинаем транзакцию
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // Создаем запись о записи на тренировку
                    await client.query(
                        'INSERT INTO session_participants (session_id, client_id, child_id, status) VALUES ($1, $2, $3, $4)',
                        [
                            selectedSession.id,
                            state.data.client_id,
                            state.data.selected_child ? state.data.selected_child.id : null,
                            'confirmed'
                        ]
                    );

                    // Списываем средства со счета
                    await client.query(
                        'UPDATE wallets SET balance = balance - $1 WHERE client_id = $2',
                        [requiredAmount, state.data.client_id]
                    );

                    // Форматируем дату и время для description
                    const date = new Date(selectedSession.session_date);
                    const formattedDate = `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
                    const [hours, minutes] = selectedSession.start_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    // Создаем запись о транзакции
                    await client.query(
                        'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                        [
                            wallet.id,
                            requiredAmount,
                            'payment',
                            `Группа: ${selectedSession.group_name}, Дата: ${formattedDate}, Время: ${formattedTime}, Длительность: ${selectedSession.duration} мин.`
                        ]
                    );

                    await client.query('COMMIT');

                    // Форматируем дату и время для сообщения
                    const formattedDateMsg = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const formattedTimeMsg = `${hours}:${minutes}`;

                    // Получаем обновленное количество участников
                    const updatedParticipantsResult = await pool.query(
                        'SELECT COUNT(*) as count FROM session_participants WHERE session_id = $1',
                        [selectedSession.id]
                    );
                    const updatedParticipantsCount = updatedParticipantsResult.rows[0].count;

                    // Формируем сообщение об успешной записи
                    let message = '✅ *Вы успешно записались на тренировку!*\n\n';
                    if (state.data.selected_child) {
                        message += `👶 Ребенок: ${state.data.selected_child.full_name}\n`;
                    }
                    message += `📅 Дата: ${formattedDateMsg}\n`;
                    message += `⏰ Время: ${formattedTimeMsg}\n`;
                    message += `👥 Группа: ${selectedSession.group_name}\n`;
                    message += `🎿 Тренажер: ${selectedSession.simulator_name}\n`;
                    message += `👨‍🏫 Тренер: ${selectedSession.trainer_name}\n`;
                    message += `💰 Цена: ${requiredAmount.toFixed(2)} руб.\n`;
                    message += `💳 Баланс: ${(currentBalance - requiredAmount).toFixed(2)} руб.\n\n`;
                    message += 'Вы можете проверить свои записи в разделе "📋 Мои записи"';

                    // Отправляем уведомление администратору
                    const { notifyNewGroupTrainingParticipant } = require('./admin-bot');
                    await notifyNewGroupTrainingParticipant({
                        ...selectedSession,
                        client_name: wallet.full_name,
                        client_phone: wallet.phone,
                        child_name: state.data.selected_child ? state.data.selected_child.full_name : null,
                        current_participants: updatedParticipantsCount
                    });

                    // Очищаем состояние
                    state.step = 'main_menu';
                    state.data = {};
                    userStates.set(chatId, state);

                    return bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [
                                ['🎿 Записаться на тренировку'],
                                ['📋 Мои записи'],
                                ['👤 Мой профиль'],
                                ['❓ Помощь']
                            ],
                            resize_keyboard: true
                        }
                    });
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                } finally {
                    client.release();
                }
            } catch (error) {
                console.error('Error confirming group training:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при записи на тренировку. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [
                                ['🎿 Записаться на тренировку'],
                                ['📋 Мои записи'],
                                ['👤 Мой профиль'],
                                ['❓ Помощь']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }
        }
    }
    return;
});

// Добавляем обработчик callback_query для инлайн-кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const state = userStates.get(chatId);

    try {
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
                            ['🔙 Назад в меню']
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