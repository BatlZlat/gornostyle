const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../db');

// Конфигурация бота
const BOT_TOKEN = '7406253231:AAGElwJIVE2pGFSusWuXvqs6gBunAEdcDLI';
const ADMIN_ID = 546668421;

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Создаем клавиатуру с кнопками
const keyboard = {
    reply_markup: {
        keyboard: [
            ['📅 Расписание на текущий месяц'],
            ['📅 Расписание на следующий месяц'],
            ['❓ Помощь']
        ],
        resize_keyboard: true
    }
};

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId === ADMIN_ID) {
        bot.sendMessage(chatId, 
            'Добро пожаловать в панель управления!\n\n' +
            'Я буду информировать вас о важных событиях в системе.\n' +
            'Используйте кнопки ниже для управления:',
            keyboard
        );
    } else {
        bot.sendMessage(chatId, 'Извините, у вас нет доступа к этому боту.');
    }
});

// Обработка нажатий на кнопки
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    switch (msg.text) {
        case '📅 Расписание на текущий месяц':
            await sendCurrentMonthSchedule(chatId);
            break;
        case '📅 Расписание на следующий месяц':
            await sendNextMonthSchedule(chatId);
            break;
        case '❓ Помощь':
            sendHelp(chatId);
            break;
    }
});

// Функция для отправки расписания текущего месяца
async function sendCurrentMonthSchedule(chatId) {
    try {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const result = await pool.query(
            `SELECT date, COUNT(*) as slots_count 
             FROM schedule 
             WHERE date BETWEEN $1 AND $2 
             GROUP BY date 
             ORDER BY date`,
            [firstDay.toISOString().split('T')[0], lastDay.toISOString().split('T')[0]]
        );

        let message = `📅 Расписание на ${getMonthName(now.getMonth())}:\n\n`;
        result.rows.forEach(row => {
            message += `${formatDate(row.date)}: ${row.slots_count} слотов\n`;
        });

        bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('Ошибка при получении расписания:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при получении расписания.');
    }
}

// Функция для отправки расписания следующего месяца
async function sendNextMonthSchedule(chatId) {
    try {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 2, 0);

        const result = await pool.query(
            `SELECT date, COUNT(*) as slots_count 
             FROM schedule 
             WHERE date BETWEEN $1 AND $2 
             GROUP BY date 
             ORDER BY date`,
            [firstDay.toISOString().split('T')[0], lastDay.toISOString().split('T')[0]]
        );

        let message = `📅 Расписание на ${getMonthName(now.getMonth() + 1)}:\n\n`;
        result.rows.forEach(row => {
            message += `${formatDate(row.date)}: ${row.slots_count} слотов\n`;
        });

        bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('Ошибка при получении расписания:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при получении расписания.');
    }
}

// Функция для отправки помощи
function sendHelp(chatId) {
    const helpMessage = 
        '🤖 Бот-информер администратора\n\n' +
        'Доступные команды:\n' +
        '📅 Расписание на текущий месяц - показывает расписание текущего месяца\n' +
        '📅 Расписание на следующий месяц - показывает расписание следующего месяца\n' +
        '❓ Помощь - показывает это сообщение\n\n' +
        'Бот автоматически уведомит вас о:\n' +
        '• Создании нового расписания\n' +
        '• Важных изменениях в системе';

    bot.sendMessage(chatId, helpMessage);
}

// Вспомогательные функции
function getMonthName(month) {
    const months = [
        'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];
    return months[month];
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit'
    });
}

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