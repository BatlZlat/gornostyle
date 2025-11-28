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

// Создаем экземпляр бота с обработкой ошибок
let bot;

try {
    // Создаем бота с отложенным запуском polling для избежания падения при сетевых ошибках
    bot = new TelegramBot(process.env.KULIGA_INSTRUKTOR_BOT, { polling: false });
    
    // Глобальные обработчики ошибок бота
    bot.on('polling_error', (error) => {
        console.error('❌ Ошибка polling бота инструкторов:', error.code || 'EFATAL', error.message);
        // Не падаем, просто логируем ошибку
        // Бот автоматически попытается переподключиться
    });
    
    bot.on('error', (error) => {
        console.error('❌ Ошибка бота инструкторов:', error.code || 'ERROR', error.message);
    });
    
    // Запускаем polling с обработкой ошибок асинхронно
    // Это предотвращает падение приложения при проблемах с сетью
    setTimeout(() => {
        bot.startPolling().catch((error) => {
            console.error('❌ Ошибка при запуске polling бота инструкторов:', error.message);
            console.log('⚠️ Бот инструкторов будет перезапущен через 30 секунд...');
            
            // Retry через 30 секунд
            setTimeout(() => {
                bot.startPolling().catch((retryError) => {
                    console.error('❌ Ошибка при повторном подключении:', retryError.message);
                    console.log('⚠️ Бот инструкторов будет работать в ограниченном режиме');
                });
            }, 30000);
        });
    }, 1000); // Небольшая задержка для инициализации
    
    console.log('🤖 Бот инструкторов Кулиги запущен...');
} catch (error) {
    console.error('❌ Критическая ошибка при создании бота инструкторов:', error.message);
    console.log('⚠️ Приложение продолжит работу, но бот инструкторов недоступен');
    // Создаем заглушку, чтобы не падало приложение
    bot = {
        sendMessage: async () => {
            console.warn('⚠️ Бот инструкторов недоступен, сообщение не отправлено');
            return Promise.resolve();
        },
        onText: () => {},
        on: () => {},
        onMessage: () => {},
        startPolling: () => Promise.resolve()
    };
}

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
        // ВАЖНО: Если статус слота = 'group', значит на нем есть групповая тренировка, 
        // поэтому JOIN должен возвращать групповую тренировку даже если ее статус не 'open' или 'confirmed'
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
                kb.payer_rides,
                c.full_name as client_name,
                c.phone as client_phone,
                ki.admin_percentage,
                kgt.id as group_training_id,
                kgt.is_private,
                kgt.max_participants,
                kgt.price_per_person,
                kgt.level as group_level,
                kgt.sport_type as group_sport_type,
                kgt.status as group_training_status,
                -- Реальное количество участников из активных бронирований
                (SELECT COALESCE(SUM(kb_gr.participants_count), 0)::INTEGER
                 FROM kuliga_bookings kb_gr
                 WHERE kb_gr.group_training_id = kgt.id 
                   AND kb_gr.status IN ('pending', 'confirmed')) as real_participants_count,
                -- Реальная сумма из активных бронирований
                (SELECT COALESCE(SUM(kb_gr.price_total), 0)::DECIMAL
                 FROM kuliga_bookings kb_gr
                 WHERE kb_gr.group_training_id = kgt.id 
                   AND kb_gr.status IN ('pending', 'confirmed')) as real_total_price
            FROM kuliga_schedule_slots ks
            LEFT JOIN kuliga_bookings kb ON ks.id = kb.slot_id AND kb.status IN ('pending', 'confirmed')
            LEFT JOIN clients c ON kb.client_id = c.id
            LEFT JOIN kuliga_instructors ki ON ks.instructor_id = ki.id
            -- Если статус слота = 'group', обязательно возвращаем групповую тренировку (независимо от ее статуса)
            LEFT JOIN kuliga_group_trainings kgt ON ks.id = kgt.slot_id 
                AND (kgt.status IN ('open', 'confirmed') OR ks.status = 'group')
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

        // Группируем по датам, избегая дубликатов для групповых тренировок
        const scheduleByDate = {};
        const seenGroupSlots = new Set(); // Для отслеживания уже обработанных групповых тренировок
        
        scheduleRes.rows.forEach(row => {
            const dateKey = row.date;
            if (!scheduleByDate[dateKey]) {
                scheduleByDate[dateKey] = [];
            }
            
            // Для групповых тренировок берем только первую запись (остальные - дубликаты из-за LEFT JOIN)
            if (row.group_training_id) {
                const slotKey = `${row.date}_${row.start_time}_${row.group_training_id}`;
                if (seenGroupSlots.has(slotKey)) {
                    return; // Пропускаем дубликаты
                }
                seenGroupSlots.add(slotKey);
            }
            
            scheduleByDate[dateKey].push(row);
        });

        // Формируем сообщение
        let message = '📅 *Ваше расписание*\n\n';

        for (const [date, slots] of Object.entries(scheduleByDate)) {
            message += `*${formatDate(date)}*\n`;

            for (const slot of slots) {
                // Сначала проверяем наличие групповой тренировки (приоритет выше статуса слота)
                if (slot.group_training_id || slot.status === 'group') {
                    // Для занятых слотов (групповые и индивидуальные) время жирное
                    const timeRange = `*${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}*`;
                    // Групповая тренировка
                    // Если group_training_id есть, используем данные из JOIN, иначе пробуем получить из БД
                    if (slot.group_training_id) {
                        const isPrivate = slot.is_private;
                        const sportType = slot.group_sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
                        // Используем реальное количество участников из активных бронирований
                        const currentParticipants = parseInt(slot.real_participants_count || 0, 10);
                        const maxParticipants = parseInt(slot.max_participants || 0, 10);
                        // Используем реальную сумму из активных бронирований
                        const totalPrice = parseFloat(slot.real_total_price || 0);
                        const adminPercentage = parseFloat(slot.admin_percentage || 20);
                        const instructorEarnings = totalPrice * (1 - adminPercentage / 100);
                        
                        // Конвертируем уровень в цифры
                        let levelDisplay = null;
                        if (slot.group_level) {
                            const levelStr = String(slot.group_level).trim();
                            if (/^\d+$/.test(levelStr)) {
                                // Уже цифра
                                levelDisplay = parseInt(levelStr, 10);
                            } else {
                                // Старые значения: beginner, intermediate, advanced
                                if (levelStr === 'beginner') levelDisplay = 1;
                                else if (levelStr === 'intermediate') levelDisplay = 2;
                                else if (levelStr === 'advanced') levelDisplay = 3;
                            }
                        }
                        
                        if (isPrivate) {
                            message += `${timeRange} - 👥 Групповая закрытая\n`;
                        } else {
                            message += `${timeRange} - 👥 Групповая общая\n`;
                        }
                        
                        message += `  ${sportType}\n`;
                        message += `  👤 Участников: ${currentParticipants}/${maxParticipants}\n`;
                        if (levelDisplay !== null) {
                            message += `  📊 Уровень: ${levelDisplay}\n`;
                        }
                        message += `  💵 Ваш заработок: ${instructorEarnings.toFixed(2)} руб.\n`;
                    } else {
                        // Статус 'group', но group_training_id не получен из JOIN - возможно, тренировка с другим статусом
                        // Попробуем получить информацию напрямую из БД
                        // Для занятых слотов (групповые и индивидуальные) время жирное
                        const timeRange = `*${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}*`;
                        try {
                            const groupTrainingRes = await pool.query(
                                `SELECT kgt.id, kgt.is_private, kgt.max_participants, kgt.price_per_person, 
                                        kgt.level, kgt.sport_type,
                                        (SELECT COALESCE(SUM(kb_gr.participants_count), 0)::INTEGER
                                         FROM kuliga_bookings kb_gr
                                         WHERE kb_gr.group_training_id = kgt.id 
                                           AND kb_gr.status IN ('pending', 'confirmed')) as real_participants_count,
                                        (SELECT COALESCE(SUM(kb_gr.price_total), 0)::DECIMAL
                                         FROM kuliga_bookings kb_gr
                                         WHERE kb_gr.group_training_id = kgt.id 
                                           AND kb_gr.status IN ('pending', 'confirmed')) as real_total_price
                                 FROM kuliga_group_trainings kgt
                                 JOIN kuliga_schedule_slots ks ON kgt.slot_id = ks.id
                                 WHERE ks.id = $1 AND ks.date = $2 AND ks.start_time = $3
                                 LIMIT 1`,
                                [slot.id, slot.date, slot.start_time]
                            );
                            
                            if (groupTrainingRes.rows.length > 0) {
                                const gt = groupTrainingRes.rows[0];
                                const isPrivate = gt.is_private;
                                const sportType = gt.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
                                const currentParticipants = parseInt(gt.real_participants_count || 0, 10);
                                const maxParticipants = parseInt(gt.max_participants || 0, 10);
                                const totalPrice = parseFloat(gt.real_total_price || 0);
                                const adminPercentage = parseFloat(slot.admin_percentage || 20);
                                const instructorEarnings = totalPrice * (1 - adminPercentage / 100);
                                
                                let levelDisplay = null;
                                if (gt.level) {
                                    const levelStr = String(gt.level).trim();
                                    if (/^\d+$/.test(levelStr)) {
                                        levelDisplay = parseInt(levelStr, 10);
                                    } else {
                                        if (levelStr === 'beginner') levelDisplay = 1;
                                        else if (levelStr === 'intermediate') levelDisplay = 2;
                                        else if (levelStr === 'advanced') levelDisplay = 3;
                                    }
                                }
                                
                                if (isPrivate) {
                                    message += `${timeRange} - 👥 Групповая закрытая\n`;
                                } else {
                                    message += `${timeRange} - 👥 Групповая общая\n`;
                                }
                                
                                message += `  ${sportType}\n`;
                                message += `  👤 Участников: ${currentParticipants}/${maxParticipants}\n`;
                                if (levelDisplay !== null) {
                                    message += `  📊 Уровень: ${levelDisplay}\n`;
                                }
                                message += `  💵 Ваш заработок: ${instructorEarnings.toFixed(2)} руб.\n`;
                            } else {
                                // Если групповая тренировка не найдена, показываем как занято
                                message += `${timeRange} - 👥 Групповая\n`;
                            }
                        } catch (error) {
                            console.error('Ошибка при получении групповой тренировки:', error);
                            message += `${timeRange} - 👥 Групповая\n`;
                        }
                    }
                } else if (slot.status === 'booked' && slot.booking_id) {
                    // Индивидуальная тренировка
                    // Для занятых слотов время жирное
                    const timeRange = `*${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}*`;
                    const participantName = slot.participants_names && slot.participants_names[0] 
                        ? slot.participants_names[0] 
                        : 'Участник';
                    const clientName = slot.client_name || 'Клиент';
                    const payerRides = slot.payer_rides !== false; // по умолчанию true
                    const sportType = slot.sport_type === 'ski' ? '⛷️ Лыжи' : '🏂 Сноуборд';
                    const totalPrice = parseFloat(slot.price_total || 0);
                    const adminPercentage = parseFloat(slot.admin_percentage || 20);
                    const instructorEarnings = totalPrice * (1 - adminPercentage / 100);

                    message += `${timeRange} - 📋 Индивидуальная\n`;
                    
                    // Если клиент не является участником, показываем обоих
                    if (!payerRides) {
                        message += `  👨‍💼 Клиент: ${clientName}\n`;
                        message += `  👤 Участник: ${participantName}\n`;
                    } else {
                        // Если клиент является участником, показываем только участника
                        message += `  👤 Участник: ${participantName}\n`;
                    }
                    
                    message += `  ${sportType}\n`;
                    message += `  📱 ${slot.client_phone || 'не указан'}\n`;
                    message += `  💵 Ваш заработок: ${instructorEarnings.toFixed(2)} руб.\n`;
                } else if (slot.status === 'available') {
                    // Для свободных слотов время обычное (не жирное)
                    const timeRange = `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`;
                    message += `${timeRange} - ✅ Свободно\n`;
                } else if (slot.status === 'blocked') {
                    // Для заблокированных слотов время обычное (не жирное)
                    const timeRange = `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`;
                    message += `${timeRange} - 🚫 Заблокировано\n`;
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
        const TIMEZONE = 'Asia/Yekaterinburg';
        // Условие для завершенных тренировок (как в веб-странице)
        const COMPLETION_CONDITION = `
            AND (
                kb.status = 'completed'
                OR (
                    kb.status IN ('confirmed', 'pending')
                    AND (kb.date::timestamp + kb.end_time::interval) <= (NOW() AT TIME ZONE '${TIMEZONE}')
                )
            )
        `;

        // Получаем статистику по заработку за все время
        // Для групповых тренировок инструктор связан через group_training_id
        // Для групповых тренировок считаем уникальные group_training_id, для индивидуальных - уникальные id
        const statsRes = await pool.query(
            `SELECT 
                kb.booking_type,
                COUNT(DISTINCT CASE 
                    WHEN kb.booking_type = 'group' THEN kb.group_training_id
                    ELSE kb.id
                END) as trainings_count,
                SUM(kb.price_total * (1 - COALESCE(ki.admin_percentage, 20) / 100)) as earnings
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            JOIN kuliga_instructors ki ON COALESCE(kb.instructor_id, kgt.instructor_id) = ki.id
            WHERE COALESCE(kb.instructor_id, kgt.instructor_id) = $1
              ${COMPLETION_CONDITION}
            GROUP BY kb.booking_type`,
            [instructorId]
        );

        let totalIndividualTrainings = 0;
        let totalGroupTrainings = 0;
        let totalEarnings = 0;

        statsRes.rows.forEach(row => {
            const count = parseInt(row.trainings_count || 0);
            const earnings = parseFloat(row.earnings || 0);
            
            if (row.booking_type === 'individual') {
                totalIndividualTrainings = count;
                totalEarnings += earnings;
            } else if (row.booking_type === 'group') {
                totalGroupTrainings = count;
                totalEarnings += earnings;
            }
        });

        // Получаем статистику за текущий месяц
        // Для групповых тренировок инструктор связан через group_training_id
        // Для групповых тренировок считаем уникальные group_training_id, для индивидуальных - уникальные id
        const currentMonth = moment().tz('Asia/Yekaterinburg').format('YYYY-MM');
        const monthStatsRes = await pool.query(
            `SELECT 
                kb.booking_type,
                COUNT(DISTINCT CASE 
                    WHEN kb.booking_type = 'group' THEN kb.group_training_id
                    ELSE kb.id
                END) as trainings_count,
                SUM(kb.price_total * (1 - COALESCE(ki.admin_percentage, 20) / 100)) as earnings
            FROM kuliga_bookings kb
            LEFT JOIN kuliga_group_trainings kgt ON kb.group_training_id = kgt.id
            JOIN kuliga_instructors ki ON COALESCE(kb.instructor_id, kgt.instructor_id) = ki.id
            WHERE COALESCE(kb.instructor_id, kgt.instructor_id) = $1
              ${COMPLETION_CONDITION}
              AND TO_CHAR(kb.date, 'YYYY-MM') = $2
            GROUP BY kb.booking_type`,
            [instructorId, currentMonth]
        );

        let monthIndividualTrainings = 0;
        let monthGroupTrainings = 0;
        let monthEarnings = 0;

        monthStatsRes.rows.forEach(row => {
            const count = parseInt(row.trainings_count || 0);
            const earnings = parseFloat(row.earnings || 0);
            
            if (row.booking_type === 'individual') {
                monthIndividualTrainings = count;
                monthEarnings += earnings;
            } else if (row.booking_type === 'group') {
                monthGroupTrainings = count;
                monthEarnings += earnings;
            }
        });

        // Получаем информацию о выплатах из новой таблицы kuliga_instructor_payouts
        // Выплаты за текущий месяц
        let monthPayouts = 0;
        try {
            const monthPayoutsRes = await pool.query(
                `SELECT COALESCE(SUM(instructor_earnings), 0) as total_payouts
                 FROM kuliga_instructor_payouts
                 WHERE instructor_id = $1
                   AND status = 'paid'
                   AND TO_CHAR(period_start, 'YYYY-MM') = $2`,
                [instructorId, currentMonth]
            );
            monthPayouts = parseFloat(monthPayoutsRes.rows[0]?.total_payouts || 0);
        } catch (error) {
            console.error('Ошибка получения выплат за месяц (таблица может не существовать):', error);
        }
        
        // Выплаты за текущий год
        const currentYear = moment().tz('Asia/Yekaterinburg').format('YYYY');
        let yearPayouts = 0;
        try {
            const yearPayoutsRes = await pool.query(
                `SELECT COALESCE(SUM(instructor_earnings), 0) as total_payouts
                 FROM kuliga_instructor_payouts
                 WHERE instructor_id = $1
                   AND status = 'paid'
                   AND TO_CHAR(period_start, 'YYYY') = $2`,
                [instructorId, currentYear]
            );
            yearPayouts = parseFloat(yearPayoutsRes.rows[0]?.total_payouts || 0);
        } catch (error) {
            console.error('Ошибка получения выплат за год (таблица может не существовать):', error);
        }
        
        // Выплаты за все время
        let totalPayouts = 0;
        try {
            const totalPayoutsRes = await pool.query(
                `SELECT COALESCE(SUM(instructor_earnings), 0) as total_payouts
                 FROM kuliga_instructor_payouts
                 WHERE instructor_id = $1
                   AND status = 'paid'`,
                [instructorId]
            );
            totalPayouts = parseFloat(totalPayoutsRes.rows[0]?.total_payouts || 0);
        } catch (error) {
            console.error('Ошибка получения выплат за все время (таблица может не существовать):', error);
        }
        
        // Рассчитываем долги
        const monthDebt = monthEarnings - monthPayouts;
        const totalDebt = totalEarnings - totalPayouts;
        
        // Получаем последние выплаты из новой таблицы kuliga_instructor_payouts
        let payoutsList = '';
        try {
            const recentPayoutsRes = await pool.query(
                `SELECT period_start, period_end, instructor_earnings, status, payment_date
                 FROM kuliga_instructor_payouts
                 WHERE instructor_id = $1
                   AND status = 'paid'
                 ORDER BY payment_date DESC, created_at DESC
                 LIMIT 10`,
                [instructorId]
            );
            
            if (recentPayoutsRes.rows.length > 0) {
                payoutsList = '\n*📋 Последние выплаты:*\n';
                recentPayoutsRes.rows.forEach(payout => {
                    const date = payout.payment_date 
                        ? moment(payout.payment_date).tz('Asia/Yekaterinburg').format('DD.MM.YYYY')
                        : moment(payout.period_end).tz('Asia/Yekaterinburg').format('DD.MM.YYYY');
                    const period = `${moment(payout.period_start).format('DD.MM')} - ${moment(payout.period_end).format('DD.MM.YYYY')}`;
                    payoutsList += `• ${date} (${period}) — ${parseFloat(payout.instructor_earnings).toFixed(2)} руб.\n`;
                });
            }
        } catch (error) {
            console.error('Ошибка получения последних выплат (таблица может не существовать):', error);
        }
        
        const message =
            '💰 *Финансовая статистика*\n\n' +
            '*За текущий месяц:*\n' +
            `👤 Индивидуальных: ${monthIndividualTrainings}\n` +
            `👥 Групповых: ${monthGroupTrainings}\n` +
            `💵 Ваш заработок: ${monthEarnings.toFixed(2)} руб.\n` +
            `💳 Выплачено: ${monthPayouts.toFixed(2)} руб.\n` +
            `📊 Долг Gornostyle72: ${monthDebt.toFixed(2)} руб.\n\n` +
            '*За текущий год:*\n' +
            `💳 Выплачено: ${yearPayouts.toFixed(2)} руб.\n\n` +
            '*За все время:*\n' +
            `👤 Индивидуальных: ${totalIndividualTrainings}\n` +
            `👥 Групповых: ${totalGroupTrainings}\n` +
            `💵 Общий заработок: ${totalEarnings.toFixed(2)} руб.\n` +
            `💳 Всего выплачено: ${totalPayouts.toFixed(2)} руб.\n` +
            `📊 Общий долг Gornostyle72: ${totalDebt.toFixed(2)} руб.` +
            payoutsList;

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
            `👋 Добро пожаловать, ${instructor.full_name}!\n\n` +
            'Это информационный бот для инструкторов Кулиги.\n\n' +
            'Здесь вы можете:\n\n' +
            '📅 Просматривать свое расписание\n\n' +
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

// Функция для восстановления состояния инструктора из базы данных
async function restoreInstructorState(chatId, telegramId) {
    try {
        // Ищем инструктора по telegram_id
        const instructorRes = await pool.query(
            'SELECT id, full_name, is_active FROM kuliga_instructors WHERE telegram_id = $1',
            [telegramId]
        );

        if (instructorRes.rows.length === 0) {
            return null;
        }

        const instructor = instructorRes.rows[0];

        if (!instructor.is_active) {
            return null;
        }

        // Восстанавливаем состояние
        const state = {
            instructor_id: instructor.id,
            instructor_name: instructor.full_name
        };

        userStates.set(chatId, state);
        return state;
    } catch (error) {
        console.error('Ошибка при восстановлении состояния инструктора:', error);
        return null;
    }
}

// Обработчик текстовых сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const telegramId = msg.from.id;

    // Игнорируем команды
    if (text && text.startsWith('/')) return;

    let state = userStates.get(chatId);

    // Если состояния нет, пытаемся восстановить его из базы данных
    if (!state || !state.instructor_id) {
        state = await restoreInstructorState(chatId, telegramId);
    }

    // Если состояние не удалось восстановить, показываем ошибку
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

