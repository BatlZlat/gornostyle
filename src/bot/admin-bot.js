require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const { 
    notifyScheduleCreated, 
    notifyNewTrainingRequest, 
    notifyNewIndividualTraining, 
    notifyNewGroupTrainingParticipant, 
    notifyAdminGroupTrainingCancellation, 
    notifyAdminIndividualTrainingCancellation, 
    notifyAdminFailedPayment, 
    notifyAdminWalletRefilled, 
    notifyNewClient 
} = require('./admin-notify');

// Создаем экземпляр бота для обработки команд и callback-запросов
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
    const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => parseInt(id.trim()));
    
    if (adminIds.includes(chatId)) {
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

// Обработка callback-запросов
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const adminIds = process.env.ADMIN_TELEGRAM_ID.split(',').map(id => parseInt(id.trim()));
    
    if (!adminIds.includes(chatId)) {
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
    bot,
    notifyScheduleCreated,
    notifyNewTrainingRequest,
    notifyNewIndividualTraining,
    notifyNewGroupTrainingParticipant,
    notifyAdminGroupTrainingCancellation,
    notifyAdminIndividualTrainingCancellation,
    notifyAdminFailedPayment,
    notifyAdminWalletRefilled,
    notifyNewClient
}; 