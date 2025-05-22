require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const { notifyNewTrainingRequest, notifyNewIndividualTraining, notifyAdminGroupTrainingCancellation, notifyAdminIndividualTrainingCancellation } = require('./admin-bot');

// Настройка подключения к БД
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Создаем экземпляр бота
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

    // Глобальная обработка "Сертификаты"
    if (msg.text === '🎁 Сертификаты') {
        return bot.sendMessage(chatId,
            'Функционал для Сертификаты находится в разработке\n\nСкоро здесь появится возможность приобретать и дарить сертификаты.',
            {
                reply_markup: {
                    keyboard: [
                        ['🔙 В главное меню']
                    ],
                    resize_keyboard: true
                }
            }
        );
    }
    
    // Глобальная обработка "Личный кабинет"
    if (msg.text === '👤 Личный кабинет') {
        await showPersonalCabinet(chatId);
    }

    // Глобальная обработка "В главное меню"
    if (msg.text === '🔙 В главное меню' || msg.text === '🔙 Назад в меню') {
        const client = state && state.data && state.data.client_id ? { id: state.data.client_id } : await getClientByTelegramId(msg.from.id.toString());
        userStates.set(chatId, { step: 'main_menu', data: { client_id: client ? client.id : undefined } });
        return showMainMenu(chatId);
    }

    // Глобальная обработка "Добавить ребенка"
    if (msg.text === '➕ Добавить ребенка') {
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
        return bot.sendMessage(chatId, '👶 Введите ФИО ребенка:', {
            reply_markup: {
                keyboard: [['🔙 Отмена']],
                resize_keyboard: true
            }
        });
    }
    
    // Глобальная обработка "Мои записи"
    if (msg.text === '📋 Мои записи') {
        let clientId = state && state.data && state.data.client_id;
        if (!clientId) {
            const client = await getClientByTelegramId(msg.from.id.toString());
            if (!client) {
                return bot.sendMessage(chatId,
                    '❌ Вы не зарегистрированы в системе. Пожалуйста, начните с команды /start',
                    {
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
            clientId = client.id;
        }
        userStates.set(chatId, { step: 'main_menu', data: { client_id: clientId } });
        try {
            const result = await pool.query(
                `WITH client_sessions AS (
                    SELECT 
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
                        (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id) as current_participants,
                        'group' as session_type
                    FROM session_participants sp
                    JOIN training_sessions ts ON sp.session_id = ts.id
                    JOIN simulators s ON ts.simulator_id = s.id
                    LEFT JOIN groups g ON ts.group_id = g.id
                    LEFT JOIN trainers t ON ts.trainer_id = t.id
                    LEFT JOIN children c ON sp.child_id = c.id
                    JOIN clients cl ON sp.client_id = cl.id
                    WHERE sp.client_id = $1
                    AND ts.status = 'scheduled'
                    AND (
                        ts.session_date > CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg'
                        OR (
                            ts.session_date = CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg'
                            AND ts.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                        )
                    )
                    UNION ALL
                    -- Индивидуальные тренировки
                    SELECT 
                        its.id,
                        its.id as session_id,
                        its.child_id,
                        COALESCE(c.full_name, cl.full_name) as participant_name,
                        its.preferred_date as session_date,
                        its.preferred_time as start_time,
                        its.duration,
                        its.equipment_type,
                        s.name as simulator_name,
                        NULL as group_name,
                        NULL as trainer_name,
                        NULL as skill_level,
                        its.price,
                        NULL as max_participants,
                        NULL as current_participants,
                        'individual' as session_type
                    FROM individual_training_sessions its
                    JOIN simulators s ON its.simulator_id = s.id
                    LEFT JOIN children c ON its.child_id = c.id
                    JOIN clients cl ON its.client_id = cl.id
                    WHERE its.client_id = $1
                    AND (
                        its.preferred_date > CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg'
                        OR (
                            its.preferred_date = CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg'
                            AND its.preferred_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                        )
                    )
                )
                SELECT * FROM client_sessions
                ORDER BY session_date, start_time`,
                [clientId]
            );
            if (result.rows.length === 0) {
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
            let message = '📋 *Ваши записи на тренировки:*\n\n';
            result.rows.forEach((session, index) => {
                const date = new Date(session.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = session.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;
                message += `*Запись ${index + 1}:*\n`;
                message += `👤 *Участник:* ${session.participant_name}\n`;
                message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${formattedTime}\n`;
                message += `⏱ *Длительность:* ${session.duration} минут\n`;
                if (session.session_type === 'individual') {
                    message += `🏂 *Тип:* ${session.equipment_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
                } else {
                    message += `👥 *Группа:* ${session.group_name}\n`;
                    message += `👨‍🏫 *Тренер:* ${session.trainer_name}\n`;
                    message += `📊 *Уровень:* ${session.skill_level}/10\n`;
                    message += `👥 *Участников:* ${session.current_participants}/${session.max_participants}\n`;
                }
                message += `🎿 *Тренажер:* ${session.simulator_name}\n`;
                message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n\n`;
            });
            message += 'Для отмены тренировки нажмите "Отменить тренировку"';
            userStates.set(chatId, { step: 'view_sessions', data: { client_id: clientId, sessions: result.rows } });
            return bot.sendMessage(chatId, message, {
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
            return bot.sendMessage(chatId,
                'Произошла ошибка при получении записей. Пожалуйста, попробуйте позже.',
                {
                    reply_markup: {
                        keyboard: [['🔙 В главное меню']],
                        resize_keyboard: true
                    }
                }
            );
        }
    }

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
                    if (state.data.has_group) {
                        successMessage += 'Мы рассмотрим вашу заявку и свяжемся с вами в ближайшее время.\n\n';
                        successMessage += 'Вы также можете связаться с нами для уточнения деталей:\n';
                        successMessage += `📱 Телефон: ${adminPhone}`;
                    } else {
                        successMessage += 'Мы постараемся подобрать для вас группу, но это может занять некоторое время.';
                    }

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
                        
                        // Добавляем информацию о каждой тренировке
                        result.rows.forEach((session, index) => {
                            const date = new Date(session.session_date);
                            const dayOfWeek = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][date.getDay()];
                            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                            const [hours, minutes] = session.start_time.split(':');
                            const formattedTime = `${hours}:${minutes}`;
                            
                            message += `${index + 1}. *${formattedDate} (${dayOfWeek}) ${formattedTime}*\n`;
                            message += `   👥 ${session.group_name} (${session.current_participants}/${session.max_participants})\n`;
                            message += `   💰 ${session.price} руб.\n\n`;
                        });

                        message += 'Чтобы выбрать тренировку, введите её номер в чат.\n';
                        message += 'Например: 1 - для выбора первой тренировки';

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
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
                                ['💳 Пополнить баланс']
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

                    // Отправляем уведомление администратору
                    const { notifyNewIndividualTraining } = require('./admin-bot');
                    await notifyNewIndividualTraining({
                        client_name: clientInfo.full_name,
                        client_phone: clientInfo.phone,
                        child_name: state.data.is_child ? state.data.child_name : null,
                        with_trainer: state.data.with_trainer,
                        equipment_type: state.data.equipment_type,
                        duration: state.data.duration,
                        simulator_id: state.data.simulator_id,
                        price: state.data.price,
                        preferred_date: state.data.preferred_date,
                        preferred_time: state.data.preferred_time
                    });

                    // Списываем средства
                    await pool.query(
                        'UPDATE wallets SET balance = balance - $1 WHERE client_id = $2',
                        [price, clientInfo.id]
                    );

                    // Очищаем состояние
                    userStates.delete(chatId);

                    // Отправляем сообщение об успешной записи
                    return bot.sendMessage(chatId,
                        '✅ Вы успешно записались на тренировку!\n\n' +
                        'Детали тренировки:\n' +
                        `• ФИО участника: ${state.data.is_child ? state.data.child_name : clientInfo.full_name}\n` +
                        `• Тип тренировки: Индивидуальная\n` +
                        `• Снаряжение: ${state.data.equipment_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂'}\n` +
                        `• Тренер: ${state.data.with_trainer ? 'С тренером 👨‍🏫' : 'Без тренера'}\n` +
                        `• Длительность: ${state.data.duration} минут ⏱️\n` +
                        `• Дата: ${formatDate(state.data.preferred_date)}\n` +
                        `• Время: ${state.data.preferred_time}\n` +
                        `• Тренажер: ${state.data.simulator_name} (№${state.data.simulator_id})\n` +
                        `• Стоимость: ${state.data.price} руб. 💰\n\n` +
                        'Ждем вас на тренировке!',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                } catch (error) {
                    console.error('Ошибка при создании записи:', error);
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
                    if (clientAge >= 16) {
                        // Проверяем наличие детей у клиента
                        const childrenResult = await pool.query(
                            `SELECT id, full_name, 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age
                            FROM children 
                            WHERE parent_id = $1 AND 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) < 16`,
                            [state.data.client_id]
                        );

                        if (childrenResult.rows.length === 0) {
                            return bot.sendMessage(chatId,
                                '❌ На данную тренировку можно записать только детей до 16 лет.\n\n' +
                                'У вас нет детей младше 16 лет или вы не добавили их в профиль.\n\n' +
                                'Вы можете:\n' +
                                '• Выбрать другую тренировку\n' +
                                '• Добавить ребенка в профиль',
                                {
                                    reply_markup: {
                                        keyboard: [
                                            ['🎿 Выбрать другую тренировку'],
                                            ['👤 Добавить ребенка'],
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
                        state.step = 'select_child_for_training';
                        userStates.set(chatId, state);

                        let message = '👶 *Выберите ребенка для записи на тренировку:*\n\n';
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
                    // Если клиент младше 16 лет, он может записаться сам
                } else if (isAdultTraining) {
                    if (clientAge < 16) {
                        // Проверяем, есть ли у клиента дети старше 16 лет
                        const childrenResult = await pool.query(
                            `SELECT id, full_name, 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age
                            FROM children 
                            WHERE parent_id = $1 AND 
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) >= 16`,
                            [state.data.client_id]
                        );

                        if (childrenResult.rows.length === 0) {
                            return bot.sendMessage(chatId,
                                '❌ На данную тренировку можно записаться только с 16 лет.\n\n' +
                                'Пожалуйста, выберите детскую тренировку или тренировку без возрастных ограничений.',
                                {
                                    reply_markup: {
                                        keyboard: [['🔙 Назад в меню']],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }

                        // Если есть дети старше 16 лет, предлагаем выбрать ребенка
                        state.data.selected_session = selectedSession;
                        state.data.available_children = childrenResult.rows;
                        state.step = 'select_child_for_training';
                        userStates.set(chatId, state);

                        let message = '👶 *Выберите ребенка для записи на тренировку:*\n\n';
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
                    // Если клиент старше 16 лет, он может записаться сам
                }
                // Для общей тренировки нет возрастных ограничений

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
                message += `👨‍🏫 *Тренер:* ${selectedSession.trainer_name}\n`;
                message += `💰 *Цена:* ${formattedPrice} руб.\n`;
                message += `💳 *Баланс:* ${formattedBalance} руб.\n\n`;
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
            const selectedIndex = parseInt(msg.text) - 1;
            const state = userStates.get(chatId);
            
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.data.available_children.length) {
                // Получаем баланс клиента
                const balanceResult = await pool.query(
                    'SELECT balance FROM wallets WHERE client_id = $1',
                    [state.data.client_id]
                );
                const balance = parseFloat(balanceResult.rows[0]?.balance || 0);
                
                // Сохраняем баланс в состоянии
                state.data.client_balance = balance;
                userStates.set(chatId, state);

                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите ребенка из списка.',
                    {
                        reply_markup: {
                            keyboard: [
                                ...state.data.available_children.map(child => [`${child.full_name}`]),
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }
                );
            }

            const selectedChild = state.data.available_children[selectedIndex];
            const selectedSession = state.data.selected_session;

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
            message += `👨‍🏫 *Тренер:* ${selectedSession.trainer_name}\n`;
            message += `💰 *Цена:* ${price.toFixed(2)} руб.\n`;
            message += `💳 *Баланс:* ${balance.toFixed(2)} руб.\n\n`;
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
                try {
                    const selectedSession = state.data.selected_session;
                    const client = await pool.connect();

                    try {
                        await client.query('BEGIN');

                        // Проверяем баланс
                        const balanceResult = await client.query(
                            'SELECT balance FROM wallets WHERE client_id = $1',
                            [state.data.client_id]
                        );
                        const balance = parseFloat(balanceResult.rows[0].balance);
                        const price = parseFloat(selectedSession.price);

                        if (balance < price) {
                            return bot.sendMessage(chatId,
                                `❌ Недостаточно средств на балансе.\n\n` +
                                `Требуется: ${price.toFixed(2)} руб.\n` +
                                `Доступно: ${balance.toFixed(2)} руб.\n\n` +
                                `Пожалуйста, пополните баланс.`,
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

                        // Проверяем уровень подготовки
                        let participantLevel;
                        if (state.data.selected_child) {
                            const childResult = await client.query(
                                'SELECT skill_level FROM children WHERE id = $1',
                                [state.data.selected_child.id]
                            );
                            participantLevel = childResult.rows[0].skill_level;
                        } else {
                            const clientResult = await client.query(
                                'SELECT skill_level FROM clients WHERE id = $1',
                                [state.data.client_id]
                            );
                            participantLevel = clientResult.rows[0].skill_level;
                        }

                        if (participantLevel > selectedSession.skill_level) {
                            return bot.sendMessage(chatId,
                                `❌ Уровень подготовки не соответствует требованиям тренировки.\n\n` +
                                `Ваш уровень: ${participantLevel}/10\n` +
                                `Требуемый уровень: ${selectedSession.skill_level}/10\n\n` +
                                `Пожалуйста, выберите тренировку соответствующего уровня.`,
                                {
                                    reply_markup: {
                                        keyboard: [['🔙 Назад в меню']],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }

                        // Проверяем наличие свободных мест
                        const participantsResult = await client.query(
                            'SELECT COUNT(*) as count FROM session_participants WHERE session_id = $1',
                            [selectedSession.id]
                        );
                        const currentParticipants = parseInt(participantsResult.rows[0].count);

                        if (currentParticipants >= selectedSession.max_participants) {
                            return bot.sendMessage(chatId,
                                '❌ К сожалению, группа уже заполнена.\n\n' +
                                'Пожалуйста, выберите другую тренировку.',
                                {
                                    reply_markup: {
                                        keyboard: [['🔙 Назад в меню']],
                                        resize_keyboard: true
                                    }
                                }
                            );
                        }

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
                            [price, state.data.client_id]
                        );

                        // Получаем ID кошелька
                        const walletResult = await client.query(
                            'SELECT id FROM wallets WHERE client_id = $1',
                            [state.data.client_id]
                        );

                        // Форматируем дату и время для description
                        const transactionDate = new Date(selectedSession.session_date);
                        const transactionFormattedDate = `${transactionDate.getDate()}.${transactionDate.getMonth() + 1}.${transactionDate.getFullYear()}`;
                        const [transactionHours, transactionMinutes] = selectedSession.start_time.split(':');
                        const transactionFormattedTime = `${transactionHours}:${transactionMinutes}`;

                        // Создаем запись о транзакции
                        await client.query(
                            'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [
                                walletResult.rows[0].id,
                                price,
                                'payment',
                                `Группа: ${selectedSession.group_name}, Дата: ${transactionFormattedDate}, Время: ${transactionFormattedTime}, Длительность: ${selectedSession.duration} мин.`
                            ]
                        );

                        await client.query('COMMIT');

                        // Форматируем дату и время для сообщения
                        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][transactionDate.getDay()];
                        const formattedDateMsg = `${transactionDate.getDate().toString().padStart(2, '0')}.${(transactionDate.getMonth() + 1).toString().padStart(2, '0')}.${transactionDate.getFullYear()}`;
                        const formattedTimeMsg = `${transactionHours}:${transactionMinutes}`;

                        // Формируем сообщение об успешной записи
                        let message = '✅ *Вы успешно записались на тренировку!*\n\n';
                        if (state.data.selected_child) {
                            message += `👶 *Ребенок:* ${state.data.selected_child.full_name}\n`;
                        }
                        message += `📅 *Дата:* ${formattedDateMsg} (${dayOfWeek})\n`;
                        message += `⏰ *Время:* ${formattedTimeMsg}\n`;
                        message += `👥 *Группа:* ${selectedSession.group_name}\n`;
                        message += `🎿 *Тренажер:* ${selectedSession.simulator_name}\n`;
                        message += `👨‍🏫 *Тренер:* ${selectedSession.trainer_name}\n`;
                        message += `💰 *Цена:* ${price.toFixed(2)} руб.\n`;
                        message += `💳 *Баланс:* ${(balance - price).toFixed(2)} руб.\n\n`;
                        message += 'Вы можете проверить свои записи в разделе "📋 *Мои записи*"';

                        // Отправляем уведомление администратору
                        const { notifyNewGroupTrainingParticipant } = require('./admin-bot');
                        
                        // Получаем данные клиента
                        const clientInfoResult = await pool.query(
                            'SELECT full_name, phone FROM clients WHERE id = $1',
                            [state.data.client_id]
                        );
                        
                        const clientData = clientInfoResult.rows[0];
                        
                        await notifyNewGroupTrainingParticipant({
                            ...selectedSession,
                            client_name: clientData.full_name,
                            client_phone: clientData.phone,
                            child_name: state.data.selected_child ? state.data.selected_child.full_name : null,
                            current_participants: currentParticipants + 1
                        });

                        // Очищаем состояние
                        userStates.delete(chatId);

                        return bot.sendMessage(chatId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['📋 Мои записи'],
                                    ['🔙 В главное меню']
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
            }
            break;
        }
        case 'main_menu': {
            if (msg.text === '📋 Мои записи') {
                try {
                    // Получаем все записи клиента и его детей
                    const result = await pool.query(
                        `WITH client_sessions AS (
                            -- Групповые тренировки
                            SELECT 
                                sp.id,
                                sp.session_id,
                                sp.child_id,
                                c.full_name as participant_name,
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
                                (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id) as current_participants,
                                'group' as session_type
                            FROM session_participants sp
                            JOIN training_sessions ts ON sp.session_id = ts.id
                            JOIN simulators s ON ts.simulator_id = s.id
                            LEFT JOIN groups g ON ts.group_id = g.id
                            LEFT JOIN trainers t ON ts.trainer_id = t.id
                            LEFT JOIN children c ON sp.child_id = c.id
                            JOIN clients cl ON sp.client_id = cl.id
                            WHERE sp.client_id = $1
                            AND ts.status = 'scheduled'
                            AND (
                                ts.session_date > CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg'
                                OR (
                                    ts.session_date = CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg'
                                    AND ts.start_time > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::time
                                )
                            )
                            UNION ALL
                            -- Индивидуальные тренировки
                            SELECT 
                                its.id,
                                its.id as session_id,
                                its.child_id,
                                COALESCE(c.full_name, cl.full_name) as participant_name,
                                its.preferred_date as session_date,
                                its.preferred_time as start_time,
                                its.duration,
                                its.equipment_type,
                                s.name as simulator_name,
                                NULL as group_name,
                                NULL as trainer_name,
                                NULL as skill_level,
                                its.price,
                                NULL as max_participants,
                                NULL as current_participants,
                                'individual' as session_type
                            FROM individual_training_sessions its
                            JOIN simulators s ON its.simulator_id = s.id
                            LEFT JOIN children c ON its.child_id = c.id
                            JOIN clients cl ON its.client_id = cl.id
                            WHERE its.client_id = $1
                            AND its.preferred_date >= CURRENT_DATE AT TIME ZONE 'Asia/Yekaterinburg'
                        )
                        SELECT * FROM client_sessions
                        ORDER BY session_date, start_time`,
                        [state.data.client_id]
                    );

                    if (result.rows.length === 0) {
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
                    let message = '📋 *Ваши записи на тренировки:*\n\n';
                    result.rows.forEach((session, index) => {
                        const date = new Date(session.session_date);
                        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                        const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                        const [hours, minutes] = session.start_time.split(':');
                        const formattedTime = `${hours}:${minutes}`;

                        message += `*Запись ${index + 1}:*\n`;
                        message += `👤 *Участник:* ${session.participant_name}\n`;
                        message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                        message += `⏰ *Время:* ${formattedTime}\n`;
                        message += `⏱ *Длительность:* ${session.duration} минут\n`;
                        
                        if (session.session_type === 'individual') {
                            message += `🏂 *Тип:* ${session.equipment_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n`;
                        } else {
                            message += `👥 *Группа:* ${session.group_name}\n`;
                            message += `👨‍🏫 *Тренер:* ${session.trainer_name}\n`;
                            message += `📊 *Уровень:* ${session.skill_level}/10\n`;
                            message += `👥 *Участников:* ${session.current_participants}/${session.max_participants}\n`;
                        }
                        
                        message += `🎿 *Тренажер:* ${session.simulator_name}\n`;
                        message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n\n`;
                    });

                    message += 'Для отмены тренировки нажмите "Отменить тренировку"';

                    // Сохраняем список записей в состоянии
                    state.data.sessions = result.rows;
                    state.step = 'view_sessions';
                    userStates.set(chatId, state);

                    return bot.sendMessage(chatId, message, {
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
                    return bot.sendMessage(chatId,
                        'Произошла ошибка при получении записей. Пожалуйста, попробуйте позже.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 В главное меню']],
                                resize_keyboard: true
                            }
                        }
                    );
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
                    const date = new Date(session.session_date);
                    const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                    const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                    const [hours, minutes] = session.start_time.split(':');
                    const formattedTime = `${hours}:${minutes}`;

                    message += `${index + 1}. ${session.participant_name} - ${formattedDate} (${dayOfWeek}) ${formattedTime}\n`;
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
                    // Получаем параметры тренировки до удаления
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
                    
                    // Считаем сколько мест осталось после удаления
                    const seatsRes = await pool.query(
                        'SELECT COUNT(*) FROM session_participants WHERE session_id = $1',
                        [selectedSession.session_id]
                    );
                    const currentParticipants = parseInt(seatsRes.rows[0].count) - 1; // -1 потому что мы удаляем одного участника
                    const maxParticipants = groupInfo.max_participants;
                    const seatsLeft = `${currentParticipants}/${maxParticipants}`;

                    // Получаем данные клиента
                    const clientRes = await pool.query('SELECT full_name, phone FROM clients WHERE id = $1', [state.data.client_id]);
                    const client = clientRes.rows[0];

                    // Удаляем запись
                    await pool.query('DELETE FROM session_participants WHERE id = $1', [selectedSession.id]);

                    // Возвращаем средства
                    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE client_id = $2', [selectedSession.price, state.data.client_id]);
                    
                    // Получаем ID кошелька
                    const walletResult = await pool.query(
                        'SELECT id FROM wallets WHERE client_id = $1',
                        [state.data.client_id]
                    );

                    // Создаем запись о транзакции
                    await pool.query(
                        'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                        [
                            walletResult.rows[0].id,
                            selectedSession.price,
                            'refund',
                            `Возврат средств за ${selectedSession.session_type === 'group' ? 'групповую' : 'индивидуальную'} тренировку; ${selectedSession.session_type === 'group' ? `Группа: ${groupInfo.group_name},` : `Тренажер: ${ind.simulator_name},`} Дата: ${selectedSession.session_type === 'group' ? groupInfo.session_date : ind.preferred_date}, Время: ${selectedSession.session_type === 'group' ? groupInfo.start_time : ind.preferred_time}`
                        ]
                    );

                    // Уведомляем админа
                    await notifyAdminGroupTrainingCancellation({
                        clientName: client.full_name,
                        clientPhone: client.phone,
                        date: groupInfo.session_date,
                        time: groupInfo.start_time,
                        groupName: groupInfo.group_name,
                        trainerName: groupInfo.trainer_name,
                        simulatorName: groupInfo.simulator_name,
                        seatsLeft,
                        refund: selectedSession.price,
                        adminChatId: process.env.ADMIN_TELEGRAM_ID
                    });

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

                    state.step = 'main_menu';
                    userStates.set(chatId, state);

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
                } else {
                    // Получаем параметры индивидуальной тренировки до удаления
                    const indRes = await pool.query(
                        `SELECT its.preferred_date, its.preferred_time, its.duration, its.simulator_id, its.price, s.name as simulator_name
                         FROM individual_training_sessions its
                         JOIN simulators s ON its.simulator_id = s.id
                         WHERE its.id = $1`,
                        [selectedSession.id]
                    );
                    const ind = indRes.rows[0];

                    // Освобождаем слоты
                    await pool.query(
                        `UPDATE schedule SET is_booked = false
                         WHERE simulator_id = $1 AND date = $2
                         AND start_time >= $3 AND start_time < ($3::time + ($4 * interval '1 minute'))`,
                        [ind.simulator_id, ind.preferred_date, ind.preferred_time, ind.duration]
                    );

                    // Получаем данные клиента
                    const clientRes = await pool.query('SELECT full_name, phone FROM clients WHERE id = $1', [state.data.client_id]);
                    const client = clientRes.rows[0];

                    // Удаляем запись
                    await pool.query('DELETE FROM individual_training_sessions WHERE id = $1', [selectedSession.id]);

                    // Получаем ID кошелька
                    const walletResult = await pool.query(
                        'SELECT id FROM wallets WHERE client_id = $1',
                        [state.data.client_id]
                    );
                    
                    // Создаем запись о транзакции
                    await pool.query(
                        'INSERT INTO transactions (wallet_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                        [
                            walletResult.rows[0].id,
                            selectedSession.price,
                            'refund',
                            `Возврат средств за ${selectedSession.session_type === 'group' ? 'групповую' : 'индивидуальную'} тренировку; ${selectedSession.session_type === 'group' ? `Группа: ${groupInfo.group_name},` : `Тренажер: ${ind.simulator_name},`} Дата: ${selectedSession.session_type === 'group' ? groupInfo.session_date : ind.preferred_date}, Время: ${selectedSession.session_type === 'group' ? groupInfo.start_time : ind.preferred_time}`
                        ]
                    );
                    
                    // Возвращаем средства
                    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE client_id = $2', [selectedSession.price, state.data.client_id]);

                    // Уведомляем админа
                    await notifyAdminIndividualTrainingCancellation({
                        clientName: client.full_name,
                        clientPhone: client.phone,
                        date: ind.preferred_date,
                        time: ind.preferred_time,
                        simulatorName: ind.simulator_name,
                        refund: selectedSession.price,
                        adminChatId: process.env.ADMIN_TELEGRAM_ID
                    });

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

                    state.step = 'main_menu';
                    userStates.set(chatId, state);

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
                // ... остальной код для сообщения пользователю ...
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
        }
        case 'add_child_name': {
            if (msg.text === '🔙 Отмена') {
                userStates.delete(chatId);
                return showPersonalCabinet(chatId);
            }

            state.data.child_name = msg.text;
            state.step = 'add_child_birth_date';
            userStates.set(chatId, state);

            return bot.sendMessage(chatId,
                '📅 Введите дату рождения ребенка в формате ДД.ММ.ГГГГ:',
                {
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
                    '❌ Неверный формат даты. Пожалуйста, используйте формат ДД.ММ.ГГГГ:',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Отмена']],
                            resize_keyboard: true
                        }
                    }
                );
            }

            try {
                await pool.query(
                    'INSERT INTO children (parent_id, full_name, birth_date, sport_type, skill_level) VALUES ($1, $2, $3, $4, $5)',
                    [state.data.client_id, state.data.child_name, birthDate, 'ski', null]
                );

                userStates.delete(chatId);
                await bot.sendMessage(chatId,
                    '✅ Ребенок успешно добавлен!',
                    {
                        reply_markup: {
                            keyboard: [['🔙 Назад в меню']],
                            resize_keyboard: true
                        }
                    }
                );
                return showPersonalCabinet(chatId);
            } catch (error) {
                console.error('Ошибка при добавлении ребенка:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при добавлении ребенка. Пожалуйста, попробуйте позже или обратитесь в поддержку.',
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

        const sessions = await Booking.findByUser(client.id);
        
        if (!sessions || sessions.length === 0) {
            await bot.sendMessage(chatId, 'У вас пока нет записей на тренировки.');
            return;
        }

        let message = '📋 Ваши записи на тренировки:\n\n';
        
        sessions.forEach(session => {
            const price = session.price ? Number(session.price) : 0;
            const formattedPrice = price.toFixed(2);
            
            message += `🏂 Тренировка: ${session.simulator_name}\n`;
            message += `📅 Дата: ${formatDate(session.session_date)}\n`;
            message += `⏰ Время: ${session.start_time} - ${session.end_time}\n`;
            message += `👤 ${session.is_child ? 'Ребенок' : 'Клиент'}: ${session.is_child ? session.child_name : session.client_name}\n`;
            message += `💰 Стоимость: ${formattedPrice} руб.\n`;
            if (session.skill_level) {
                message += `📊 Уровень: ${session.skill_level}\n`;
            }
            message += `🏷️ Статус: ${getStatusText(session.participant_status)}\n\n`;
        });

        await bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('Ошибка при получении записей:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при получении записей. Пожалуйста, попробуйте позже.');
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
    const [year, month, day] = dateStr.split('-');
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
            `<b>Текущий баланс:</b> ${formattedBalance} руб.\n\n` +
            '<b>ВАЖНО!!!</b>\n' +
            'Для пополнения баланса необходимо отправить необходимую сумму по СБП.\n' +
            'В комментарии платежа укажите номер вашего кошелька.\n' +
            'Для этого скопируйте номер кошелька, кликнув по нему.\n\n' +
            `Ссылка для пополнения счета: ${process.env.PAYMENT_LINK}`;

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

// В обработчике сообщений
bot.on('message', async (msg) => {
    if (msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const state = userStates.get(chatId);

    // ... existing code ...

    if (msg.text === '💰 Кошелек') {
        try {
            const clientResult = await pool.query(
                'SELECT c.id, c.full_name, w.wallet_number, w.balance FROM clients c JOIN wallets w ON c.id = w.client_id WHERE c.telegram_id = $1',
                [chatId]
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
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        } catch (error) {
            console.error('Ошибка при получении информации о кошельке:', error);
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

    if (msg.text === '💳 Пополнить баланс') {
        try {
            const state = userStates.get(chatId);
            let clientId;

            if (state && state.client_id) {
                clientId = state.client_id;
            } else {
                const clientResult = await pool.query(
                    'SELECT id FROM clients WHERE telegram_id = $1',
                    [chatId]
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

                clientId = clientResult.rows[0].id;
            }

            await handleTopUpBalance(chatId, clientId);
        } catch (error) {
            console.error('Ошибка при обработке пополнения баланса:', error);
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

    // ... existing code ...
});

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

        // Получаем информацию о детях
        const childrenResult = await pool.query(
            `SELECT c.*, 
                    COALESCE(c.skill_level, 0) as skill_level 
             FROM children c 
             WHERE c.parent_id = $1 
             ORDER BY c.birth_date`,
            [client.id]
        );

        // Формируем сообщение
        let message = `👤 *Личный кабинет*\n\n`;
        
        // Информация о клиенте
        message += `*Информация о вас:*\n`;
        message += `👤 *ФИО:* ${client.full_name}\n`;
        message += `📅 *Дата рождения:* ${formattedBirthDate} (${clientAge} лет)\n`;
        message += `🎿 *Уровень катания:* ${client.skill_level || 'Не указан'}/5\n\n`;

        // Информация о детях
        if (childrenResult.rows.length > 0) {
            message += `*Информация о детях:*\n`;
            childrenResult.rows.forEach((child, index) => {
                const childAge = calculateAge(child.birth_date);
                const childBirthDate = formatBirthDate(child.birth_date);
                message += `\n*Ребенок ${index + 1}:*\n`;
                message += `👶 *ФИО:* ${child.full_name}\n`;
                message += `📅 *Дата рождения:* ${childBirthDate} (${childAge} лет)\n`;
                message += `🎿 *Уровень катания:* ${child.skill_level || 'Не указан'}/5\n`;
            });
        }

        message += `\nВыберите действие:`;

        // Кнопки действий
        const keyboard = [
            ['➕ Добавить ребенка'],
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
        const { notifyAdminWalletRefilled } = require('./admin-bot');
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

