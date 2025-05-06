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
        const message = 
            '📝 *Заявка на Групповую тренировку*\n\n' +
            `👤 *ФИО:* ${requestData.client_name}\n` +
            `📱 *Телефон:* ${requestData.client_phone}\n` +
            (requestData.has_group ? 
                `👥 *Готовая группа:* ${requestData.group_size} человек\n` :
                `👥 *Ищет группу:* ${requestData.training_for}\n`) +
            `🔄 *Частота:* ${requestData.training_frequency === 'regular' ? 'Регулярно' : 'Разово'}\n` +
            `🏂 *Тип:* ${requestData.sport_type}\n` +
            `📊 *Уровень:* ${requestData.skill_level}/10\n` +
            `📅 *Дата:* ${requestData.preferred_date}\n` +
            `⏰ *Время:* ${requestData.preferred_time}`;

        await bot.sendMessage(ADMIN_ID, message, { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Одобрить', callback_data: `approve_${requestData.id}` },
                        { text: '❌ Отклонить', callback_data: `reject_${requestData.id}` }
                    ]
                ]
            }
        });
    } catch (error) {
        console.error('Ошибка при отправке уведомления о новой заявке:', error);
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

module.exports = {
    notifyScheduleCreated,
    notifyNewTrainingRequest
}; 