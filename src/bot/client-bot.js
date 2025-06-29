require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const { notifyNewTrainingRequest, notifyNewIndividualTraining, notifyAdminGroupTrainingCancellation, notifyAdminIndividualTrainingCancellation, notifyNewClient } = require('./admin-notify');
const { Booking } = require('../models/Booking');

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
                ['🎁 Сертификаты', '💰 Кошелек'],
                ['📤 Поделиться ботом']
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
    if (trainingType === 'individual') {
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
    console.log('Начало регистрации клиента:', data);
    
    // Проверяем обязательные поля
    if (!data.full_name || !data.birth_date || !data.phone || !data.telegram_id) {
        throw new Error('Отсутствуют обязательные поля для регистрации');
    }

    const client = await pool.connect();
    try {
        console.log('Начало транзакции');
        await client.query('BEGIN');
        
        // Вставляем клиента с skill_level = 1 по умолчанию
        const res = await client.query(
            `INSERT INTO clients (full_name, birth_date, phone, telegram_id, telegram_username, nickname, skill_level) 
             VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING id`,
            [data.full_name, data.birth_date, data.phone, data.telegram_id, data.username || null, data.nickname]
        );
        
        console.log('Клиент создан, ID:', res.rows[0].id);
        const clientId = res.rows[0].id;
        
        // Создаем кошелек
        const walletNumber = await generateUniqueWalletNumber();
        console.log('Создание кошелька:', walletNumber);
        await client.query(
            `INSERT INTO wallets (client_id, wallet_number, balance) 
             VALUES ($1, $2, 0)`,
            [clientId, walletNumber]
        );
        
        // Если есть данные о ребенке, создаем запись
        if (data.child && data.child.full_name && data.child.birth_date) {
            console.log('Создание записи о ребенке');
            await client.query(
                `INSERT INTO children (parent_id, full_name, birth_date, sport_type, skill_level) 
                 VALUES ($1, $2, $3, 'ski', 1)`,
                [clientId, data.child.full_name, data.child.birth_date]
            );
            console.log('Запись о ребенке создана');
        }
        
        await client.query('COMMIT');
        console.log('Транзакция успешно завершена');
        return { walletNumber: formatWalletNumber(walletNumber) };
    } catch (e) {
        console.error('Ошибка при регистрации клиента:', e);
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
        // Уведомляем админов о новом клиенте
        await notifyNewClient({
            full_name: data.full_name,
            birth_date: data.birth_date,
            phone: data.phone,
            skill_level: 1, // всегда 1 при регистрации
            child: data.child
        });
        await bot.sendMessage(chatId,
            '✅ *Регистрация успешно завершена!*\n\n' +
            '🎉 Добро пожаловать в Ski-instruktor!\n\n' +
            '— *Записывайтесь на тренировки, управляйте своими занятиями и балансом прямо в Telegram!*\n\n' +
            '👥 *Групповые тренировки выгоднее!* Если не удалось собрать свою команду, просто оставьте заявку через пункт меню "Записаться на тренировку" → "Предложить тренировку". Мы с радостью поможем вам найти единомышленников! 🏂\n\n' +
            '👶 *Есть дети?* Добавляйте их в личном кабинете и записывайте на тренировки. Пусть растут чемпионами!\n\n' +
            '💳 *Пополнение баланса* — легко и просто! Пополняйте счет на любую сумму. Главное — не забудьте указать номер вашего кошелька в комментарии к платежу. Если забыли — не беда, поддержка всегда на связи! 😉\n\n' +
            '🎁 *Подарочные сертификаты* — отличный способ порадовать друга или близкого. Дарите спорт и хорошее настроение!\n\n' +
            `• Если возникли вопросы — пишите или звоните в поддержку: ${process.env.ADMIN_PHONE || 'не указан'}\n\n`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        ['📝 Записаться на тренировку'],
                        ['📋 Мои записи', '👤 Личный кабинет'],
                        ['🎁 Сертификаты', '💰 Кошелек'],
                        ['📤 Поделиться ботом']
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
        return handleTextMessage(msg);
    } catch (error) {
        console.error('Ошибка при обработке сообщения:', error);
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
        '👶 *Есть дети?* Добавляйте их в личном кабинете и записывайте на тренировки. Пусть растут чемпионами!\n\n' +
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

    // Получаем прайс из базы
    let prices;
    try {
        const res = await pool.query('SELECT * FROM prices ORDER BY type, with_trainer DESC, participants, duration');
        prices = res.rows;
    } catch (e) {
        console.error('Ошибка при получении прайса:', e);
        await bot.sendMessage(chatId, '❌ Не удалось получить прайс. Попробуйте позже.');
        return;
    }

    // Группируем прайс
    const individual = prices.filter(p => p.type === 'individual');
    const group = prices.filter(p => p.type === 'group');

    // Индивидуальные
    const indWithTrainer = individual.filter(p => p.with_trainer);
    const indWithoutTrainer = individual.filter(p => !p.with_trainer);

    // Групповые
    const groupWithTrainer = group.filter(p => p.with_trainer);
    const groupWithoutTrainer = group.filter(p => !p.with_trainer);

    // Формируем текст
    let message = `💸 *Актуальный прайс на тренировки*\nна дату: ${dateStr}\n\n`;

    // Индивидуальные
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
    message += '---\n\n';

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
        'Пока наши строения новые, адреса еще делаются, но мы уже ждем вас! \n\n' +
        '<b>📍 Ориентир:</b> улица Источник, 2А, село Яр\n' +
        '<b>🚪 Въезд:</b> напротив этого дома, распашные железные ворота с кирпичным забором\n\n' +
        '<b>🗺️ Как добраться:</b>\n' +
        'Район Мыса, Поселок Яр → проезжаем мимо горячего источника → доезжаем до кирпичного забора → едем вдоль забора → как только забор заканчивается, сразу направо в открытые ворота!\n\n' +
        '<b>🗺️ Наше точное местоположение:</b>\n' +
        '• 🟡 Яндекс Карты: <a href="https://clck.ru/3MiVTy">Открыть карту</a>\n' +
        '• 🔵 Google Maps: <a href="https://golnk.ru/XA1zz">Открыть карту</a>\n' +
        '• 🟢 2ГИС: <a href="https://go.2gis.com/HMDnG">Открыть карту</a>\n\n' +
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

// Обработчик текстовых сообщений
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const state = userStates.get(chatId);

        // Обработка кнопки "Кошелек"
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

    if (msg.text === '🔙 В главное меню' || msg.text === '🔙 Назад в меню') {
        const client = state && state.data && state.data.client_id ? 
            { id: state.data.client_id } : 
            await getClientByTelegramId(msg.from.id.toString());
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

    // Глобальная обработка "Записаться на тренировку"
    if (msg.text === '📝 Записаться на тренировку') {
        console.log('Начало процесса записи на тренировку');
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
            '🎿 *Выберите тип тренировки:*\n\n' +
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

    // Обработка состояний
    if (!state) return;

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
            } else if (msg.text === '2. Для ребенка' || msg.text === '3. Для себя и ребенка') {
                trainingFor = msg.text === '2. Для ребенка' ? 'child' : 'both';
                
                // Получаем список детей клиента
                const childrenResult = await pool.query(
                    'SELECT id, full_name FROM children WHERE parent_id = $1',
                    [state.data.client_id]
                );

                if (childrenResult.rows.length === 0) {
                    return bot.sendMessage(chatId,
                        '❌ У вас нет добавленных детей в профиле.\n\n' +
                        'Пожалуйста, сначала добавьте ребенка через меню "Личный кабинет" -> "➕ Добавить ребенка"',
                        {
                            reply_markup: {
                                keyboard: [['🔙 Назад в меню']],
                                resize_keyboard: true
                            }
                        }
                    );
                }

                let message = '👶 *Выберите ребенка:*\n\n';
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
                        'SELECT id, full_name, phone FROM clients WHERE telegram_id = $1',
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
                // Если это регистрация нового клиента (нет client_id), инициализируем объект child
                if (!state.data.client_id) {
                    state.data.child = {};
                }
                
                // Если детей нет или массив не определён — сразу просим ввести ФИО
                if (!state.data.children || state.data.children.length === 0) {
                    state.step = 'add_child_name';
                    userStates.set(chatId, state);
                    return bot.sendMessage(chatId, '👶 Введите ФИО ребенка:', {
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
                        '👶 *Выберите ребенка из списка:*\n\n' + childrenList,
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
                await finishRegistration(chatId, state.data);
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
                            message += `${index + 1}. ${dateStr} (${weekday}) ${session.start_time}\n`;
                            message += `   👥 ${groupName} (${currentParticipants}/${maxParticipants})\n`;
                            message += `   📊 Уровень: ${skillLevel}/10\n`;
                            message += `   💰 ${price} руб.\n\n`;
                        });
                        message += "Чтобы выбрать тренировку, введите её номер в чат.\nНапример: 1 - для выбора первой тренировки\n\n";
                        message += "⚠️ Важно: При записи на тренировку убедитесь, что ваш уровень подготовки соответствует или выше указанного уровня тренировки. Это обеспечит комфортное и эффективное обучение для всех участников группы.";
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
                        'SELECT id, full_name, phone FROM clients WHERE telegram_id = $1',
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
                // Если это регистрация нового клиента (нет client_id), инициализируем объект child
                if (!state.data.client_id) {
                    state.data.child = {};
                }
                
                // Если детей нет или массив не определён — сразу просим ввести ФИО
                if (!state.data.children || state.data.children.length === 0) {
                    state.step = 'add_child_name';
                    userStates.set(chatId, state);
                    return bot.sendMessage(chatId, '👶 Введите ФИО ребенка:', {
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
                        '👶 *Выберите ребенка из списка:*\n\n' + childrenList,
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
                await finishRegistration(chatId, state.data);
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
                            message += `${index + 1}. ${dateStr} (${weekday}) ${session.start_time}\n`;
                            message += `   👥 ${groupName} (${currentParticipants}/${maxParticipants})\n`;
                            message += `   📊 Уровень: ${skillLevel}/10\n`;
                            message += `   💰 ${price} руб.\n\n`;
                        });
                        message += "Чтобы выбрать тренировку, введите её номер в чат.\nНапример: 1 - для выбора первой тренировки\n\n";
                        message += "⚠️ Важно: При записи на тренировку убедитесь, что ваш уровень подготовки соответствует или выше указанного уровня тренировки. Это обеспечит комфортное и эффективное обучение для всех участников группы.";
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
                        'SELECT id, full_name, phone FROM clients WHERE telegram_id = $1',
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
                                EXTRACT(YEAR FROM AGE(CURRENT_DATE, birth_date)) as age,
                                skill_level
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
            const selectedIndex = parseInt(msg.text) - 1;
            const state = userStates.get(chatId);
            
            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= state.data.available_children.length) {
                return bot.sendMessage(chatId,
                    '❌ Пожалуйста, выберите ребенка из списка.',
                    {
                        reply_markup: {
                            keyboard: [
                                ...state.data.available_children.map((child, i) => [`${i + 1}. ${child.full_name} (${child.skill_level} ур.)`]),
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
            message += `👨‍🏫 *Тренер:* ${selectedSession.trainer_name}\n`;
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
                        `👨‍🏫 *Тренер:* ${selectedSession.trainer_name}\n` +
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
                    // Получаем все записи клиента и его детей
                    const result = await pool.query(
                        `WITH client_sessions AS (
                            -- Групповые тренировки
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
                                (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id AND status = 'confirmed') as current_participants,
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
                            AND sp.status = 'confirmed'
                            AND (
                              (ts.session_date::timestamp + ts.start_time::interval + (ts.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
                            )
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
                    let message = `📋 *Ваши записи на тренировки:*\n\n`;
                    let allSessions = [];
                    let counter = 1;
                    if (groupSessions.length > 0) {
                        message += '\n👥 *Групповые тренировки:*\n';
                        groupSessions.forEach(session => {
                            const date = new Date(session.session_date);
                            const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                            const [hours, minutes] = session.start_time.split(':');
                            const formattedTime = `${hours}:${minutes}`;
                            message += `\n${counter}. 👤 *${session.participant_name}*\n`;
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
                    if (individualSessions.length > 0) {
                        message += '\n👤 *Индивидуальные тренировки:*\n';
                        individualSessions.forEach(session => {
                            const date = new Date(session.session_date);
                            const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                            const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                            const [hours, minutes] = session.start_time.split(':');
                            const formattedTime = `${hours}:${minutes}`;
                            message += `\n${counter}. 👤 *${session.participant_name}*\n`;
                            message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                            message += `⏰ *Время:* ${formattedTime}\n`;
                            message += `🎿 *Снаряжение:* ${session.equipment_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂'}\n`;
                            message += `👨‍🏫 *${session.with_trainer ? 'С тренером' : 'Без тренера'}*\n`;
                            message += `🎿 *Тренажер:* ${session.simulator_name}\n`;
                            message += `⏱ *Длительность:* ${session.duration} мин\n`;
                            message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n`;
                            allSessions.push({ ...session, session_type: 'individual' });
                            counter++;
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

                    // Считаем сколько мест осталось после удаления
                    const seatsRes = await pool.query(
                        'SELECT COUNT(*) FROM session_participants WHERE session_id = $1',
                        [selectedSession.session_id]
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
                } else if (selectedSession.session_type === 'individual') {
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
                            selectedSession.end_time
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
                '📅 *Введите дату рождения ребенка в формате ДД.ММ.ГГГГ:*\n\n' +
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

            // Если это регистрация нового клиента, сохраняем дату в объекте child и завершаем регистрацию
            if (state.data.child) {
                state.data.child.birth_date = birthDate;
                await finishRegistration(chatId, state.data);
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
                    '✅ *Ребенок успешно добавлен!*',
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
                console.error('Ошибка при добавлении ребенка:', error);
                return bot.sendMessage(chatId,
                    '❌ Произошла ошибка при добавлении ребенка. Пожалуйста, попробуйте позже.',
                    {
                        reply_markup: {
                            keyboard: [['🔙 В главное меню']],
                            resize_keyboard: true
                        }
                    }
                );
            }
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

                    // Отправляем уведомление администратору
                    await notifyNewIndividualTraining({
                        id: result.rows[0].id,
                        client_id: state.data.client_id,
                        child_id: state.data.is_child ? state.data.child_id : null,
                        equipment_type: state.data.equipment_type,
                        with_trainer: state.data.with_trainer,
                        duration: state.data.duration,
                        preferred_date: state.data.preferred_date,
                        preferred_time: startTime,
                        simulator_id: state.data.simulator_id,
                        price: state.data.price
                    });

                    // Очищаем состояние
                    userStates.delete(chatId);

                    // Формируем сообщение об успешной записи
                    const [year, month, day] = state.data.preferred_date.split('-');
                    const formattedDate = `${day}.${month}.${year}`;
                    const [hours, minutes] = startTime.split(':');
                    const formattedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;

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

        // ... rest of the states ...
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

        // --- Групповые тренировки ---
        const groupResult = await pool.query(
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
                    (SELECT COUNT(*) FROM session_participants WHERE session_id = ts.id AND status = 'confirmed') as current_participants,
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
                AND sp.status = 'confirmed'
                AND (
                  (ts.session_date::timestamp + ts.start_time::interval + (ts.duration || ' minutes')::interval) > (NOW() AT TIME ZONE 'Asia/Yekaterinburg')
                )
            )
            SELECT * FROM client_sessions
            ORDER BY session_date, start_time`,
            [client.id]
        );

        // --- Индивидуальные тренировки ---
        const individualResult = await pool.query(
            `SELECT 
                its.id,
                its.child_id,
                COALESCE(ch.full_name, cl.full_name) as participant_name,
                its.preferred_date as session_date,
                its.preferred_time as start_time,
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
            [client.id]
        );

        // --- Формируем общий список ---
        const groupSessions = groupResult.rows;
        const individualSessions = individualResult.rows;
        if (groupSessions.length === 0 && individualSessions.length === 0) {
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
            message += '\n👥 *Групповые тренировки:*\n';
            groupSessions.forEach(session => {
                const date = new Date(session.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = session.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;
                message += `\n${counter}. 👤 *${session.participant_name}*\n`;
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
        if (individualSessions.length > 0) {
            message += '\n👤 *Индивидуальные тренировки:*\n';
            individualSessions.forEach(session => {
                const date = new Date(session.session_date);
                const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
                const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
                const [hours, minutes] = session.start_time.split(':');
                const formattedTime = `${hours}:${minutes}`;
                message += `\n${counter}. 👤 *${session.participant_name}*\n`;
                message += `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n`;
                message += `⏰ *Время:* ${formattedTime}\n`;
                message += `🎿 *Снаряжение:* ${session.equipment_type === 'ski' ? 'Горные лыжи 🎿' : 'Сноуборд 🏂'}\n`;
                message += `👨‍🏫 *${session.with_trainer ? 'С тренером' : 'Без тренера'}*\n`;
                message += `🎿 *Тренажер:* ${session.simulator_name}\n`;
                message += `⏱ *Длительность:* ${session.duration} мин\n`;
                message += `💰 *Стоимость:* ${Number(session.price).toFixed(2)} руб.\n`;
                allSessions.push({ ...session, session_type: 'individual' });
                counter++;
            });
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
    if (typeof dateStr === 'string' && dateStr.includes('.')) {
        return dateStr;
    }
    
    // Если дата в формате YYYY-MM-DD, преобразуем в DD.MM.YYYY
    if (typeof dateStr === 'string' && dateStr.includes('-')) {
        const [year, month, day] = dateStr.split('-');
        return `${day}.${month}.${year}`;
    }
    
    // Если это объект Date, преобразуем в DD.MM.YYYY
    const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
    
    // Проверяем, что дата валидна
    if (isNaN(date.getTime())) {
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
        message += `🎿 *Уровень катания:* ${client.skill_level || 'Не указан'}/10\n\n`;

        // Информация о детях
        if (childrenResult.rows.length > 0) {
            message += `*Информация о детях:*\n`;
            childrenResult.rows.forEach((child, index) => {
                const childAge = calculateAge(child.birth_date);
                const childBirthDate = formatBirthDate(child.birth_date);
                message += `\n*Ребенок ${index + 1}:*\n`;
                message += `👶 *ФИО:* ${child.full_name}\n`;
                message += `📅 *Дата рождения:* ${childBirthDate} (${childAge} лет)\n`;
                message += `🎿 *Уровень катания:* ${child.skill_level || 'Не указан'}/10\n`;
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
        '👶 *Есть дети?* Добавляйте их в личном кабинете и записывайте на тренировки. Пусть растут чемпионами!\n\n' +
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
                parse_mode: 'Markdown',
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
        await showMainMenu(chatId);
    }
});

// Обработчик команды "Поделиться ботом"
async function handleShareBotCommand(msg) {
    const chatId = msg.chat.id;
    const botShareLink = process.env.BOT_SHARE_LINK || 'https://t.me/Ski_Instruktor72_bot';
    const botUsername = process.env.BOT_USERNAME || 'Ski_Instruktor72_bot';

    const message = `🎿 <b>Поделитесь нашим ботом с друзьями!</b>\n\n` +
        `🏂 <b>Ski-instruktor</b> — ваш помощник для записи на горнолыжный тренажер\n\n` +
        `✨ <b>Что умеет наш бот:</b>\n` +
        `• 📝 Запись на групповые и индивидуальные тренировки\n` +
        `• 👥 Управление детскими занятиями\n` +
        `• 💰 Пополнение баланса\n` +
        `• 📋 Просмотр своих записей\n` +
        `• 🎁 Подарочные сертификаты\n` +
        `• 📍 Подскажет адрес\n` +
        `• 👥 Поделится информацией о тренере\n` +
        `• 💰 Всегда актуальная информация цен\n\n` +
        `🎯 <b>Поделитесь ссылкой:</b>\n` +
        `<code>${botShareLink}</code>\n\n` +
        `💡 <b>Или просто перешлите это сообщение друзьям!</b>`;

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: {
            keyboard: [['🔙 В главное меню']],
            resize_keyboard: true
        }
    });
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
