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

    console.log('Получено сообщение:', {
        text: msg.text,
        chatId: chatId,
        currentState: state ? state.step : 'no state',
        stateData: state ? state.data : null
    });

    // Обработка кнопок "Назад"
    if (msg.text === '🔙 Назад') {
        console.log('Нажата кнопка Назад, текущее состояние:', state ? state.step : 'no state');
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
                    
                    if (msg.text === '👤 Индивидуальная') {
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
                    } else {
                        state.step = 'preferred_date';
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
                    }
                }
                break;
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
                        `WITH RECURSIVE time_slots AS (
                            SELECT 
                                s.*,
                                ts.id as training_id,
                                ts.duration,
                                ts.start_time as session_start_time
                            FROM schedule s 
                            LEFT JOIN training_sessions ts ON s.simulator_id = ts.simulator_id 
                            AND s.date = ts.session_date 
                            AND s.start_time >= ts.start_time 
                            AND s.start_time < (ts.start_time + COALESCE(ts.duration, 30) * interval '1 minute')
                            WHERE s.date = $1 AND s.is_holiday = false
                        )
                        SELECT * FROM time_slots
                        ORDER BY start_time`,
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
                            const isBooked = slot && slot.training_id;
                            
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
                if (data === 'back_to_date') {
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
                    // Игнорируем нажатие на занятое время
                    return bot.answerCallbackQuery(msg.id, {
                        text: 'Это время уже занято',
                        show_alert: true
                    });
                }

                if (data.startsWith('time_')) {
                    const [, simulatorId, time] = data.split('_');
                    
                    try {
                        // Получаем баланс клиента
                        const balanceResult = await pool.query(
                            'SELECT balance FROM wallets WHERE client_id = $1',
                            [state.data.client_id]
                        );
                        const balance = balanceResult.rows[0]?.balance || 0;

                        // Форматируем время в HH:MM
                        const [hours, minutes] = time.split(':');
                        const formattedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;

                        // Формируем итоговое сообщение
                        let summaryMessage = '📋 *Проверьте данные заявки:*\n\n';
                        summaryMessage += '*Детали тренировки:*\n';
                        summaryMessage += `• Тип тренировки: ${state.data.training_type === 'individual' ? 'Индивидуальная' : 'Групповая'}\n`;
                        summaryMessage += `• Снаряжение: ${state.data.equipment_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂'}\n`;
                        summaryMessage += `• Тренер: ${state.data.with_trainer ? 'С тренером 👨‍🏫' : 'Без тренера 👤'}\n`;
                        summaryMessage += `• Длительность: ${state.data.duration} минут ⏱\n`;
                        summaryMessage += `• Дата: ${state.data.preferred_date}\n`;
                        summaryMessage += `• Время: ${formattedTime}\n`;
                        summaryMessage += `• Стоимость: ${state.data.price} руб. 💰\n`;
                        summaryMessage += `• Ваш баланс: ${balance} руб. 💳\n\n`;

                        if (balance < state.data.price) {
                            summaryMessage += '⚠️ *Внимание!* На вашем балансе недостаточно средств.\n';
                            summaryMessage += 'Пожалуйста, пополните баланс перед записью на тренировку.\n\n';
                        }

                        summaryMessage += 'Выберите действие:';

                        // Сохраняем состояние для следующего шага
                        state.step = 'confirm_booking';
                        state.data.preferred_time = time;
                        state.data.simulator_id = simulatorId;
                        userStates.set(chatId, state);

                        // Удаляем сообщение с кнопками
                        await bot.deleteMessage(chatId, msg.message_id);

                        // Отвечаем на callback-запрос
                        await bot.answerCallbackQuery(msg.id);

                        return bot.sendMessage(chatId, summaryMessage, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [
                                    ['✅ Записаться на тренировку'],
                                    ['❌ Я передумал'],
                                    ['💳 Пополнить кошелек'],
                                    ['🔙 Назад в меню']
                                ],
                                resize_keyboard: true
                            }
                        });
                    } catch (error) {
                        console.error('Ошибка при проверке времени:', error);
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
                        // Проверяем баланс еще раз
                        const balanceResult = await pool.query(
                            'SELECT balance FROM wallets WHERE client_id = $1',
                            [state.data.client_id]
                        );
                        const balance = balanceResult.rows[0]?.balance || 0;

                        if (balance < state.data.price) {
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
                            `INSERT INTO training_requests (
                                client_id, 
                                child_id, 
                                training_type, 
                                equipment_type,
                                with_trainer,
                                duration,
                                preferred_date, 
                                preferred_time,
                                simulator_id,
                                price,
                                status
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') 
                            RETURNING id`,
                            [
                                state.data.client_id,
                                state.data.is_child ? state.data.child_id : null,
                                state.data.training_type,
                                state.data.equipment_type,
                                state.data.with_trainer,
                                state.data.duration,
                                state.data.preferred_date,
                                state.data.preferred_time,
                                state.data.simulator_id,
                                state.data.price
                            ]
                        );

                        // Получаем информацию о тренажере
                        const simulatorResult = await pool.query(
                            'SELECT name FROM simulators WHERE id = $1',
                            [state.data.simulator_id]
                        );
                        const simulatorName = simulatorResult.rows[0].name;

                        // Обновляем баланс клиента
                        await pool.query(
                            'UPDATE wallets SET balance = balance - $1 WHERE client_id = $2',
                            [state.data.price, state.data.client_id]
                        );

                        // Получаем ID кошелька для создания транзакции
                        const walletResult = await pool.query(
                            'SELECT id FROM wallets WHERE client_id = $1',
                            [state.data.client_id]
                        );
                        const walletId = walletResult.rows[0].id;

                        // Формируем описание транзакции
                        const transactionDescription = 
                            `Тип тренировки: ${state.data.training_type === 'individual' ? 'Индивидуальная' : 'Групповая'}; ` +
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

                        // Формируем сообщение об успешной записи
                        let message = '✅ *Запись на тренировку успешно создана!*\n\n';
                        message += `📅 Дата: ${state.data.preferred_date}\n`;
                        message += `⏰ Время: ${state.data.preferred_time}\n`;
                        message += `🎿 Тип тренировки: ${state.data.training_type === 'individual' ? 'Индивидуальная' : 'Групповая'}\n`;
                        message += `🏂 Тренажер: ${simulatorName}\n`;
                        message += `💰 Сумма списания: ${state.data.price} руб.\n`;
                        
                        if (state.data.is_child) {
                            message += `👶 Ребенок: ${state.data.child_name}\n`;
                        }

                        message += '\nМы свяжемся с вами для подтверждения записи.';

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
                    return bot.sendMessage(chatId,
                        '❌ Запись на тренировку отменена.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                } else if (msg.text === '💳 Пополнить кошелек') {
                    // Показываем меню пополнения баланса
                    return showBalanceMenu(chatId);
                } else if (msg.text === '🔙 Назад в меню') {
                    userStates.delete(chatId);
                    return showMainMenu(chatId);
                }
                break;
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
                    message += 'Вы всегда можете записаться на *"Индивидуальную"* тренировку. Или можете нажать *"Предложить тренировку"*, а мы попробуем подобрать для вас удобный вариант.\n\n';
                } else {
                    result.rows.forEach(training => {
                        const date = new Date(training.session_date).toLocaleDateString('ru-RU');
                        message += `📅 *${date} ${training.start_time}*\n`;
                        message += `👥 Группа: ${training.group_name}\n`;
                        message += `👤 Макс. участников: ${training.max_participants}\n`;
                        message += `💰 Цена: ${training.price} руб.\n\n`;
                    });
                }
                message += 'Нажмите *"Записаться"* для записи на *групповую* или *индивидуальную* тренировку\n\n';
                message += 'Если вы не нашли удобное для вас время в групповых тренировках, вы можете нажать *"Предложить тренировку"*, а мы попробуем подобрать для вас удобный вариант.\n\n';
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
            console.log('Начало процесса предложения тренировки');
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
                if (childRes.rows.length > 0) {
                    childInfo = childRes.rows.map(child => {
                        const birthDate = new Date(child.birth_date);
                        const age = Math.floor((new Date() - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
                        return `${child.full_name} (${age} лет)`;
                    }).join('\n👶 ');
                    childInfo = '👶 ' + childInfo;
                }
                return bot.sendMessage(chatId,
                    '👤 *Ваша личная информация:*\n' +
                    `📝 *ФИО:* ${client.full_name}\n` +
                    `📅 *Дата рождения:* ${new Date(client.birth_date).toLocaleDateString()}\n` +
                    `📱 *Телефон:* ${client.phone}\n` +
                    `👶 *Дети:*\n${childInfo}`,
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
        case '📝 Записаться': {
            try {
                const client = await getClientByTelegramId(msg.from.id.toString());
                if (!client) {
                    return bot.sendMessage(chatId,
                        '❌ Вы не зарегистрированы. Пожалуйста, зарегистрируйтесь сначала.',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                // Получаем список детей клиента
                const childrenResult = await pool.query(
                    'SELECT * FROM children WHERE parent_id = $1',
                    [client.id]
                );
                const children = childrenResult.rows;

                // Сохраняем данные в состоянии
                userStates.set(chatId, {
                    step: 'has_child',
                    data: {
                        client_id: client.id,
                        children: children
                    }
                });

                // Если есть дети, спрашиваем, хотит ли записать ребенка
                if (children.length > 0) {
                    return bot.sendMessage(chatId,
                        '👥 *Хотите записать ребенка на тренировку?*',
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['Да', 'Нет'], ['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                } else {
                    // Если детей нет, сразу переходим к выбору типа тренировки
                    userStates.set(chatId, {
                        step: 'training_type',
                        data: {
                            client_id: client.id,
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
            } catch (error) {
                console.error('Ошибка при проверке регистрации:', error);
                return bot.sendMessage(chatId,
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
    }
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
                // Получаем баланс клиента
                const balanceResult = await pool.query(
                    'SELECT balance FROM wallets WHERE client_id = $1',
                    [state.data.client_id]
                );
                const balance = balanceResult.rows[0]?.balance || 0;

                // Форматируем время в HH:MM
                const [hours, minutes] = time.split(':');
                const formattedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;

                // Формируем итоговое сообщение
                let summaryMessage = '📋 *Проверьте данные заявки:*\n\n';
                summaryMessage += '*Детали тренировки:*\n';
                summaryMessage += `• Тип тренировки: ${state.data.training_type === 'individual' ? 'Индивидуальная' : 'Групповая'}\n`;
                summaryMessage += `• Снаряжение: ${state.data.equipment_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂'}\n`;
                summaryMessage += `• Тренер: ${state.data.with_trainer ? 'С тренером 👨‍🏫' : 'Без тренера 👤'}\n`;
                summaryMessage += `• Длительность: ${state.data.duration} минут ⏱\n`;
                summaryMessage += `• Дата: ${state.data.preferred_date}\n`;
                summaryMessage += `• Время: ${formattedTime}\n`;
                summaryMessage += `• Стоимость: ${state.data.price} руб. 💰\n`;
                summaryMessage += `• Ваш баланс: ${balance} руб. 💳\n\n`;

                if (balance < state.data.price) {
                    summaryMessage += '⚠️ *Внимание!* На вашем балансе недостаточно средств.\n';
                    summaryMessage += 'Пожалуйста, пополните баланс перед записью на тренировку.\n\n';
                }

                summaryMessage += 'Выберите действие:';

                // Сохраняем состояние для следующего шага
                state.step = 'confirm_booking';
                state.data.preferred_time = time;
                state.data.simulator_id = simulatorId;
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
                            ['💳 Пополнить кошелек'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                });
            } catch (error) {
                console.error('Ошибка при проверке времени:', error);
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