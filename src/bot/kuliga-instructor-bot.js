require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const moment = require('moment-timezone');

const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 6432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Проверяем наличие токена бота
if (!process.env.KULIGA_INSTRUKTOR_BOT) {
    console.error('❌ Ошибка: KULIGA_INSTRUKTOR_BOT не настроен в .env файле');
    process.exit(1);
}

// Создаем экземпляр бота
const bot = new TelegramBot(process.env.KULIGA_INSTRUKTOR_BOT, { polling: true });

console.log('🤖 Бот инструкторов Кулиги запущен...');

// Хранилище состояний пользователей
const userStates = new Map();

const DAY_LABELS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const DAY_SHORT_LABELS = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

// Функция форматирования даты
function formatDate(dateStr) {
    const date = moment(dateStr).tz('Asia/Yekaterinburg');
    const day = date.date().toString().padStart(2, '0');
    const month = (date.month() + 1).toString().padStart(2, '0');
    const year = date.year();
    const weekday = DAY_SHORT_LABELS[date.day()];
    return `${day}.${month}.${year} (${weekday})`;
}

// Функция форматирования времени
function formatTime(timeStr) {
    if (!timeStr) return '';
    return timeStr.toString().slice(0, 5);
}

// Главное меню
function showMainMenu(chatId) {
    return bot.sendMessage(chatId,
        '📋 *Меню инструктора Кулиги*\n\n' +
        'Выберите действие:',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['📅 Посмотреть расписание'],
                    ['💰 Финансы']
                ],
                resize_keyboard: true
            }
        }
    );
}

// Показать расписание инструктора
async function showInstructorSchedule(chatId, instructorId, dateFrom = null, dateTo = null) {
    try {
        // Если даты не указаны, показываем расписание на ближайшие 7 дней
        if (!dateFrom) {
            dateFrom = moment().tz('Asia/Yekaterinburg').format('YYYY-MM-DD');
        }
        if (!dateTo) {
            dateTo = moment().tz('Asia/Yekaterinburg').add(6, 'days').format('YYYY-MM-DD');
        }

        // Получаем расписание инструктора
        const scheduleRes = await pool.query(
            `SELECT 
                ks.id,
                ks.date,
                ks.start_time,
                ks.end_time,
                ks.status,
                kb.id as booking_id,
                kb.participants_names,
                kb.price_total,
                kb.sport_type,
                kc.phone as client_phone,
                ki.admin_percentage
            FROM kuliga_schedule_slots ks
            LEFT JOIN kuliga_bookings kb ON ks.id = kb.slot_id AND kb.status IN ('pending', 'confirmed')
            LEFT JOIN kuliga_clients kc ON kb.client_id = kc.id
            LEFT JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
            WHERE ks.instructor_id = $1
              AND ks.date >= $2
              AND ks.date <= $3
            ORDER BY ks.date, ks.start_time`,
            [instructorId, dateFrom, dateTo]
        );

        if (scheduleRes.rows.length === 0) {
            return bot.sendMessage(chatId,
                '📭 У вас нет расписания на ближайшие 7 дней.\n\n' +
                'Создайте слоты в вашем личном кабинете:\n' +
                'https://gornostyle72.ru/trainer_kuliga.html',
                {
                    reply_markup: {
                        keyboard: [
                            ['📅 Посмотреть расписание'],
                            ['💰 Финансы']
                        ],
                        resize_keyboard: true
                    }
                }
            );
        }

        // Группируем по датам
        const scheduleByDate = {};
        scheduleRes.rows.forEach(row => {
            const dateKey = row.date;
            if (!scheduleByDate[dateKey]) {
                scheduleByDate[dateKey] = [];
            }
            scheduleByDate[dateKey].push(row);
        });

        // Формируем сообщение
        let message = '📅 *Ваше расписание*\n\n';

        for (const [date, slots] of Object.entries(scheduleByDate)) {
            message += `*${formatDate(date)}*\n`;

            for (const slot of slots) {
                const timeRange = `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`;
                
                if (slot.status === 'available') {
                    message += `${timeRange} - ✅ Свободно\n`;
                } else if (slot.status === 'blocked') {
                    message += `${timeRange} - 🚫 Заблокировано\n`;
                } else if (slot.status === 'booked' && slot.booking_id) {
                    const participantName = slot.participants_names && slot.participants_names[0] 
                        ? slot.participants_names[0] 
                        : 'Участник';
                    const sportType = slot.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
                    const totalPrice = parseFloat(slot.price_total || 0);
                    const adminPercentage = parseFloat(slot.admin_percentage || 20);
                    const instructorEarnings = totalPrice * (1 - adminPercentage / 100);

                    message += `${timeRange} - 📋 Индивидуальное\n`;
                    message += `  👤 ${participantName}\n`;
                    message += `  ${sportType}\n`;
                    message += `  📱 ${slot.client_phone || 'не указан'}\n`;
                    message += `  💵 Ваш заработок: ${instructorEarnings.toFixed(2)} руб.\n`;
                }
            }

            message += '\n';
        }

        // Разбиваем сообщение на части, если оно слишком длинное
        const maxLength = 4000;
        if (message.length > maxLength) {
            const parts = [];
            let currentPart = '';
            
            message.split('\n').forEach(line => {
                if ((currentPart + line + '\n').length > maxLength) {
                    parts.push(currentPart);
                    currentPart = line + '\n';
                } else {
                    currentPart += line + '\n';
                }
            });
            
            if (currentPart) {
                parts.push(currentPart);
            }

            for (let i = 0; i < parts.length; i++) {
                await bot.sendMessage(chatId, parts[i], {
                    parse_mode: 'Markdown',
                    reply_markup: i === parts.length - 1 ? {
                        keyboard: [
                            ['📅 Посмотреть расписание'],
                            ['💰 Финансы']
                        ],
                        resize_keyboard: true
                    } : undefined
                });
            }
        } else {
            return bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['📅 Посмотреть расписание'],
                        ['💰 Финансы']
                    ],
                    resize_keyboard: true
                }
            });
        }
    } catch (error) {
        console.error('Ошибка при получении расписания:', error);
        return bot.sendMessage(chatId,
            '❌ Ошибка при загрузке расписания. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [
                        ['📅 Посмотреть расписание'],
                        ['💰 Финансы']
                    ],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Показать финансы
async function showFinances(chatId, instructorId) {
    try {
        // Получаем статистику по заработку
        const statsRes = await pool.query(
            `SELECT 
                COUNT(*) as total_trainings,
                SUM(kb.price_total) as total_revenue,
                SUM(kb.price_total * (1 - ki.admin_percentage / 100)) as total_earnings
            FROM kuliga_bookings kb
            JOIN kuliga_instructors ki ON kb.instructor_id = ki.id
            WHERE kb.instructor_id = $1
              AND kb.status IN ('pending', 'confirmed', 'completed')`,
            [instructorId]
        );

        const stats = statsRes.rows[0];
        const totalTrainings = parseInt(stats.total_trainings || 0);
        const totalRevenue = parseFloat(stats.total_revenue || 0);
        const totalEarnings = parseFloat(stats.total_earnings || 0);

        // Получаем статистику за текущий месяц
        const currentMonth = moment().tz('Asia/Yekaterinburg').format('YYYY-MM');
        const monthStatsRes = await pool.query(
            `SELECT 
                COUNT(*) as month_trainings,
                SUM(kb.price_total) as month_revenue,
                SUM(kb.price_total * (1 - ki.admin_percentage / 100)) as month_earnings
            FROM kuliga_bookings kb
            JOIN kuliga_instructors ki ON kb.instructor_id = ki.id
            WHERE kb.instructor_id = $1
              AND kb.status IN ('pending', 'confirmed', 'completed')
              AND TO_CHAR(kb.date, 'YYYY-MM') = $2`,
            [instructorId, currentMonth]
        );

        const monthStats = monthStatsRes.rows[0];
        const monthTrainings = parseInt(monthStats.month_trainings || 0);
        const monthRevenue = parseFloat(monthStats.month_revenue || 0);
        const monthEarnings = parseFloat(monthStats.month_earnings || 0);

        const message =
            '💰 *Финансовая статистика*\n\n' +
            '*За текущий месяц:*\n' +
            `📊 Проведено тренировок: ${monthTrainings}\n` +
            `💵 Ваш заработок: ${monthEarnings.toFixed(2)} руб.\n` +
            `💰 Общая выручка: ${monthRevenue.toFixed(2)} руб.\n\n` +
            '*За все время:*\n' +
            `📊 Проведено тренировок: ${totalTrainings}\n` +
            `💵 Ваш заработок: ${totalEarnings.toFixed(2)} руб.\n` +
            `💰 Общая выручка: ${totalRevenue.toFixed(2)} руб.\n\n` +
            '_💡 Подробная информация о выплатах доступна в вашем личном кабинете_';

        return bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['📅 Посмотреть расписание'],
                    ['💰 Финансы']
                ],
                resize_keyboard: true
            }
        });
    } catch (error) {
        console.error('Ошибка при получении финансовой статистики:', error);
        return bot.sendMessage(chatId,
            '❌ Ошибка при загрузке финансовой статистики. Попробуйте позже.',
            {
                reply_markup: {
                    keyboard: [
                        ['📅 Посмотреть расписание'],
                        ['💰 Финансы']
                    ],
                    resize_keyboard: true
                }
            }
        );
    }
}

// Обработчик команды /start
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const telegramUsername = msg.from.username;
    const startParam = match[1]; // Параметр после /start (например, instructor_123)

    try {
        let instructorId = null;
        
        // Если передан параметр с ID инструктора
        if (startParam && startParam.startsWith('instructor_')) {
            instructorId = parseInt(startParam.replace('instructor_', ''));
        }

        // Проверяем, зарегистрирован ли инструктор
        let instructorRes;
        if (instructorId) {
            // Ищем по ID (из Deep Link)
            instructorRes = await pool.query(
                'SELECT id, full_name, is_active, telegram_id, telegram_username FROM kuliga_instructors WHERE id = $1',
                [instructorId]
            );
        } else {
            // Ищем по telegram_id
            instructorRes = await pool.query(
                'SELECT id, full_name, is_active, telegram_id, telegram_username FROM kuliga_instructors WHERE telegram_id = $1',
                [telegramId]
            );
        }

        if (instructorRes.rows.length === 0) {
            return bot.sendMessage(chatId,
                '❌ Вы не зарегистрированы как инструктор Кулиги.\n\n' +
                'Для регистрации обратитесь к администратору или перейдите в ваш личный кабинет:\n' +
                'https://gornostyle72.ru/trainer_kuliga.html'
            );
        }

        const instructor = instructorRes.rows[0];

        if (!instructor.is_active) {
            return bot.sendMessage(chatId,
                '❌ Ваш аккаунт инструктора деактивирован.\n\n' +
                'Для получения дополнительной информации обратитесь к администратору.'
            );
        }

        // Автоматически обновляем telegram_id и telegram_username при первом визите или при изменении
        if (!instructor.telegram_id || instructor.telegram_id !== telegramId || 
            !instructor.telegram_username || instructor.telegram_username !== telegramUsername) {
            await pool.query(
                `UPDATE kuliga_instructors 
                 SET telegram_id = $1, 
                     telegram_username = $2,
                     telegram_registered = TRUE,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3`,
                [telegramId, telegramUsername || null, instructor.id]
            );
            console.log(`✅ Инструктор ${instructor.full_name} (ID: ${instructor.id}) зарегистрирован в Telegram боте`);
        }

        userStates.set(chatId, {
            instructor_id: instructor.id,
            instructor_name: instructor.full_name
        });

        await bot.sendMessage(chatId,
            `👋 Добро пожаловать, *${instructor.full_name}*!\n\n` +
            'Это информационный бот для инструкторов Кулиги Горностайл72.\n\n' +
            'Здесь вы можете:\n' +
            '📅 Просматривать свое расписание\n' +
            '💰 Отслеживать заработок',
            { parse_mode: 'Markdown' }
        );

        return showMainMenu(chatId);
    } catch (error) {
        console.error('Ошибка при обработке /start:', error);
        return bot.sendMessage(chatId,
            '❌ Произошла ошибка. Попробуйте позже.'
        );
    }
});

// Обработчик текстовых сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Игнорируем команды
    if (text && text.startsWith('/')) return;

    const state = userStates.get(chatId);

    if (!state || !state.instructor_id) {
        return bot.sendMessage(chatId,
            '❌ Сессия истекла. Отправьте команду /start для начала работы.'
        );
    }

    if (text === '📅 Посмотреть расписание') {
        return showInstructorSchedule(chatId, state.instructor_id);
    }

    if (text === '💰 Финансы') {
        return showFinances(chatId, state.instructor_id);
    }

    // Неизвестная команда
    return bot.sendMessage(chatId,
        '❓ Неизвестная команда. Выберите действие из меню.',
        {
            reply_markup: {
                keyboard: [
                    ['📅 Посмотреть расписание'],
                    ['💰 Финансы']
                ],
                resize_keyboard: true
            }
        }
    );
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error);
});

module.exports = { bot };

