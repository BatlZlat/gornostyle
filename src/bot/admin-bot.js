const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../db');

// Конфигурация бота
const BOT_TOKEN = '7406253231:AAGElwJIVE2pGFSusWuXvqs6gBunAEdcDLI';
const ADMIN_ID = 546668421;

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId === ADMIN_ID) {
        bot.sendMessage(chatId, 
            'Добро пожаловать в панель управления!\n\n' +
            'Я буду информировать вас о важных событиях в системе:\n' +
            '• Создание нового расписания\n' +
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

module.exports = {
    notifyScheduleCreated
}; 