const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../db');

// Конфигурация бота
const BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID || 546668421;

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId === parseInt(ADMIN_ID)) {
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
        await bot.sendMessage(ADMIN_ID, message);
    } catch (error) {
        console.error('Ошибка при отправке уведомления:', error);
    }
}

// Функция для отправки уведомления о новой заявке
async function notifyNewTrainingRequest(requestData) {
    try {
        // Форматируем дату из YYYY-MM-DD в DD.MM.YYYY
        const [year, month, day] = requestData.preferred_date.split('-');
        const formattedDate = `${day}.${month}.${year}`;

        const message = 
            '📝 *Заявка на Групповую тренировку*\n\n' +
            `👤 *ФИО:* ${requestData.client_name}\n` +
            `📱 *Телефон:* ${requestData.client_phone}\n` +
            (requestData.has_group ? 
                `👥 *Готовая группа:* ${requestData.group_size} человек\n` :
                `👥 *Ищет группу:* ${requestData.training_for === 'self' ? 'Для себя' : 
                                  requestData.training_for === 'child' ? 'Для ребенка' : 'Для себя и ребенка'}\n`) +
            `🔄 *Частота:* ${requestData.training_frequency === 'regular' ? 'Регулярно' : 'Разово'}\n` +
            `🏂 *Тип:* ${requestData.sport_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n` +
            `📊 *Уровень:* ${requestData.skill_level}/10\n` +
            `📅 *Дата:* ${formattedDate}\n` +
            `⏰ *Время:* ${requestData.preferred_time}`;

        await bot.sendMessage(ADMIN_ID, message, { 
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Ошибка при отправке уведомления о новой заявке:', error);
    }
}

// Функция для отправки уведомления о новой индивидуальной записи
async function notifyNewIndividualTraining(trainingData) {
    try {
        // Форматируем дату и время
        const [year, month, day] = trainingData.preferred_date.split('-');
        const formattedDate = `${day}.${month}.${year}`;
        const [hours, minutes] = trainingData.preferred_time.split(':');
        const formattedTime = `${hours}:${minutes}`;

        const message = 
            '🎿 *Запись на индивидуальную тренировку*\n\n' +
            `👤 *ФИО:* ${trainingData.client_name}\n` +
            (trainingData.child_name ? `👶 *ФИО ребенка:* ${trainingData.child_name}\n` : '') +
            `📱 *Телефон:* ${trainingData.client_phone}\n` +
            `👨‍🏫 *Тренер:* ${trainingData.with_trainer ? 'С тренером' : 'Без тренера'}\n` +
            `🏂 *Тип:* ${trainingData.equipment_type === 'ski' ? 'Горные лыжи' : 'Сноуборд'}\n` +
            `⏱ *Длительность:* ${trainingData.duration} минут\n` +
            `🎯 *Тренажер:* №${trainingData.simulator_id}\n` +
            `💰 *Стоимость:* ${trainingData.price} руб.\n` +
            `📅 *Дата:* ${formattedDate}\n` +
            `⏰ *Время:* ${formattedTime}`;

        await bot.sendMessage(ADMIN_ID, message, { 
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Ошибка при отправке уведомления о новой индивидуальной записи:', error);
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

        await bot.sendMessage(ADMIN_ID, message, { 
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
    
    if (chatId !== parseInt(ADMIN_ID)) {
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

// Уведомление об отмене групповой тренировки
async function notifyAdminGroupTrainingCancellation({ clientName, clientPhone, date, time, groupName, trainerName, simulatorName, seatsLeft, refund, adminChatId }) {
    // Форматируем дату
    const dateObj = new Date(date);
    const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;
    
    // Форматируем время
    const [hours, minutes] = time.split(':');
    const formattedTime = `${hours}:${minutes}`;

    const message =
        `❌ *Отмена групповой тренировки*\n\n` +
        `👤 Клиент: ${clientName}\n` +
        `📞 Телефон: ${clientPhone}\n` +
        `📅 Дата: ${formattedDate}\n` +
        `⏰ Время: ${formattedTime}\n` +
        `👥 Группа: ${groupName}\n` +
        `👨‍🏫 Тренер: ${trainerName}\n` +
        `🎿 Тренажер: ${simulatorName}\n` +
        `🪑 Мест осталось: ${seatsLeft}\n` +
        `💰 Возврат: ${refund} руб.`;
    await bot.sendMessage(adminChatId, message, { parse_mode: 'Markdown' });
}

// Уведомление об отмене индивидуальной тренировки
async function notifyAdminIndividualTrainingCancellation({ clientName, clientPhone, date, time, simulatorName, refund, adminChatId }) {
    // Форматируем дату
    const dateObj = new Date(date);
    const formattedDate = `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}.${dateObj.getFullYear()}`;
    
    // Форматируем время
    const [hours, minutes] = time.split(':');
    const formattedTime = `${hours}:${minutes}`;

    const message =
        `❌ *Отмена индивидуальной тренировки*\n\n` +
        `👤 Клиент: ${clientName}\n` +
        `📞 Телефон: ${clientPhone}\n` +
        `📅 Дата: ${formattedDate}\n` +
        `⏰ Время: ${formattedTime}\n` +
        `🎿 Тренажер: ${simulatorName}\n` +
        `💰 Возврат: ${refund} руб.`;
    await bot.sendMessage(adminChatId, message, { parse_mode: 'Markdown' });
}

module.exports = {
    notifyScheduleCreated,
    notifyNewTrainingRequest,
    notifyNewIndividualTraining,
    notifyNewGroupTrainingParticipant,
    notifyAdminGroupTrainingCancellation,
    notifyAdminIndividualTrainingCancellation
}; 