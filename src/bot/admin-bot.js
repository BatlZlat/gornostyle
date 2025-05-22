const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');

// Создаем экземпляр бота
const bot = new TelegramBot(process.env.ADMIN_BOT_TOKEN, { polling: true });

// Настройка подключения к БД
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId === parseInt(process.env.ADMIN_TELEGRAM_ID) || chatId === parseInt(process.env.ADMIN_TELEGRAM_ID_2)) {
        bot.sendMessage(chatId, 
            'Добро пожаловать в панель управления!\n\n' +
            'Я буду информировать вас о важных событиях в системе:\n' +
            '• Создание нового расписания\n' +
            '• Новые заявки на тренировки\n' +
            '• Важные изменения в системе'
        );
    } else {
        bot.sendMessage(chatId, 'Извините, у вас нет доступа к этому боту.');
    }
});

// Функция для отправки уведомления о создании расписания
async function notifyScheduleCreated(month) {
    try {
        const message = `✅ Расписание на ${month} успешно создано!`;
        await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message);
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления о новой заявке на тренировку
async function notifyNewTrainingRequest(trainingData) {
    try {
        const adminChatId = process.env.ADMIN_TELEGRAM_ID;
        if (!adminChatId) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = `
🔔 Новая заявка на тренировку!

👤 Клиент: ${trainingData.client_name}
📅 Дата: ${trainingData.date}
⏰ Время: ${trainingData.time}
🎯 Тип: ${trainingData.type}
👥 Группа: ${trainingData.group_name || 'Индивидуальная'}
👨‍🏫 Тренер: ${trainingData.trainer_name}
💰 Стоимость: ${trainingData.price} руб.
        `;

        await bot.sendMessage(adminChatId, message);
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления о новой индивидуальной тренировке
async function notifyNewIndividualTraining(trainingData) {
    try {
        const adminChatId = process.env.ADMIN_TELEGRAM_ID;
        if (!adminChatId) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = `
🔔 Новая индивидуальная тренировка!

👤 Клиент: ${trainingData.client_name}
📅 Дата: ${trainingData.date}
⏰ Время: ${trainingData.time}
👨‍🏫 Тренер: ${trainingData.trainer_name}
💰 Стоимость: ${trainingData.price} руб.
        `;

        await bot.sendMessage(adminChatId, message);
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления о новой записи на групповую тренировку
async function notifyNewGroupTrainingParticipant(trainingData) {
    try {
        // Форматируем дату из YYYY-MM-DD в DD.MM.YYYY
        const date = new Date(trainingData.session_date);
        const dayOfWeek = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'][date.getDay()];
        const formattedDate = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
        
        // Форматируем время в ЧЧ:ММ
        const [hours, minutes] = trainingData.start_time.split(':');
        const formattedTime = `${hours}:${minutes}`;

        const message = 
            '👥 *Новая запись на групповую тренировку*\n\n' +
            `👤 *Клиент:* ${trainingData.client_name}\n` +
            (trainingData.child_name ? `👶 *Ребенок:* ${trainingData.child_name}\n` : '') +
            `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `👥 *Группа:* ${trainingData.group_name}\n` +
            `🎿 *Тренажер:* ${trainingData.simulator_name}\n` +
            `💰 *Стоимость:* ${trainingData.price} руб.\n` +
            `📅 *Дата:* ${formattedDate} (${dayOfWeek})\n` +
            `⏰ *Время:* ${formattedTime}\n` +
            `👥 *Участников:* ${trainingData.current_participants}/${trainingData.max_participants}`;

        await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { 
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Ошибка при отправке уведомления о новой записи на групповую тренировку:', error);
    }
}

// Обработка callback-запросов
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    if (chatId !== parseInt(process.env.ADMIN_TELEGRAM_ID) && chatId !== parseInt(process.env.ADMIN_TELEGRAM_ID_2)) {
        return;
    }

    if (data.startsWith('approve_') || data.startsWith('reject_')) {
        const requestId = data.split('_')[1];
        const action = data.startsWith('approve_') ? 'approved' : 'rejected';
        
        try {
            await pool.query(
                'UPDATE group_training_requests SET status = $1 WHERE id = $2',
                [action, requestId]
            );
            
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: action === 'approved' ? '✅ Заявка одобрена' : '❌ Заявка отклонена'
            });
            
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id
                }
            );
        } catch (error) {
            console.error('Ошибка при обработке заявки:', error);
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Произошла ошибка'
            });
        }
    }
});

// Функция для отправки уведомления об отмене групповой тренировки
async function notifyAdminGroupTrainingCancellation(trainingData) {
    try {
        const adminChatId = process.env.ADMIN_TELEGRAM_ID;
        if (!adminChatId) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = `
❌ Отмена групповой тренировки!

👤 Клиент: ${trainingData.client_name}
📅 Дата: ${trainingData.date}
⏰ Время: ${trainingData.time}
👥 Группа: ${trainingData.group_name}
👨‍🏫 Тренер: ${trainingData.trainer_name}
        `;

        await bot.sendMessage(adminChatId, message);
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления об отмене индивидуальной тренировки
async function notifyAdminIndividualTrainingCancellation(trainingData) {
    try {
        const adminChatId = process.env.ADMIN_TELEGRAM_ID;
        if (!adminChatId) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = `
❌ Отмена индивидуальной тренировки!

👤 Клиент: ${trainingData.client_name}
📅 Дата: ${trainingData.date}
⏰ Время: ${trainingData.time}
👨‍🏫 Тренер: ${trainingData.trainer_name}
        `;

        await bot.sendMessage(adminChatId, message);
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Уведомление о неудачном платеже
async function notifyAdminFailedPayment({ amount, wallet_number, date, time }) {
    const message = 
        `❌ Платеж не обработан\n\n` +
        `💵 Сумма: ${amount} руб.\n` +
        `📝 Номер кошелька: ${wallet_number}\n` +
        `📅 Дата: ${date}\n` +
        `⏰ Время: ${time}\n\n` +
        `⚠️ Автор платежа не найден. Деньги не зачислены.`;

    try {
        await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Ошибка при отправке уведомления о неудачном платеже:', error);
    }
}

// Функция для отправки уведомления о пополнении кошелька
async function notifyAdminWalletRefilled({ clientName, amount, walletNumber, balance }) {
    try {
        const adminChatId = process.env.ADMIN_TELEGRAM_ID;
        if (!adminChatId) {
            console.error('ADMIN_TELEGRAM_ID не настроен в .env файле');
            return;
        }

        const message = `
✅ Пополнение кошелька

👤 Клиент: ${clientName}
💳 Кошелек: ${walletNumber}
💰 Сумма пополнения: ${amount} руб.
💵 Итоговый баланс: ${balance} руб.
        `;

        await bot.sendMessage(adminChatId, message);
    } catch (error) {
        console.error('Ошибка при отправке уведомления о пополнении кошелька:', error);
    }
}

module.exports = {
    bot,
    notifyScheduleCreated,
    notifyNewTrainingRequest,
    notifyNewIndividualTraining,
    notifyNewGroupTrainingParticipant,
    notifyAdminGroupTrainingCancellation,
    notifyAdminIndividualTrainingCancellation,
    notifyAdminFailedPayment,
    notifyAdminWalletRefilled
}; 