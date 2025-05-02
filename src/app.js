const express = require('express');
const path = require('path');
const { pool } = require('./db/index');
const { setupBot } = require('./bot/admin-bot');
const { createNextMonthSchedule, CRON_SETTINGS } = require('./scripts/create-next-month-schedule');
const scheduleRouter = require('./routes/schedule');
const simulatorsRouter = require('./routes/simulators');
const groupsRouter = require('./routes/groups');
const trainersRouter = require('./routes/trainers');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('Инициализация приложения...');
console.log('Загруженные маршруты:', {
    schedule: !!scheduleRouter,
    simulators: !!simulatorsRouter,
    groups: !!groupsRouter,
    trainers: !!trainersRouter
});

// Настройка middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Маршруты API
console.log('Регистрация маршрутов API...');
app.use('/api/schedule', scheduleRouter);
app.use('/api/simulators', simulatorsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/trainers', trainersRouter);

// Настройка cron-задачи
const cronExpression = `0 ${CRON_SETTINGS.minute} ${CRON_SETTINGS.hour} ${CRON_SETTINGS.day} * *`;
console.log('\n=== Настройка cron-задачи ===');
console.log('Текущие настройки:', CRON_SETTINGS);
console.log('Cron-выражение:', cronExpression);
console.log('Текущее время:', new Date().toLocaleString('ru-RU'));

// Функция для проверки следующего запуска
function getNextRunTime() {
    const now = new Date();
    const nextRun = new Date();
    nextRun.setDate(CRON_SETTINGS.day);
    nextRun.setHours(CRON_SETTINGS.hour);
    nextRun.setMinutes(CRON_SETTINGS.minute);
    nextRun.setSeconds(0);
    
    // Если время уже прошло сегодня, планируем на следующий месяц
    if (nextRun <= now) {
        nextRun.setMonth(nextRun.getMonth() + 1);
    }
    
    return nextRun;
}

console.log('Следующий запуск запланирован на:', getNextRunTime().toLocaleString('ru-RU'));

// Запускаем задачу по расписанию
const task = cron.schedule(cronExpression, async () => {
    console.log('\n=== Запуск создания расписания на следующий месяц ===');
    console.log('Время запуска:', new Date().toLocaleString('ru-RU'));
    try {
        await createNextMonthSchedule();
        console.log('Расписание успешно создано');
        console.log('Следующий запуск запланирован на:', getNextRunTime().toLocaleString('ru-RU'));
    } catch (error) {
        console.error('Ошибка при создании расписания:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Yekaterinburg" // Указываем часовой пояс
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Внутренняя ошибка сервера',
        details: err.message 
    });
});

// Обработка 404 ошибок
app.use((req, res) => {
    console.log('404 - Маршрут не найден:', req.method, req.url);
    res.status(404).json({ 
        success: false, 
        error: 'Маршрут не найден',
        path: req.url,
        method: req.method
    });
});

app.listen(PORT, () => {
    console.log(`\nСервер запущен на порту ${PORT}`);
    console.log('Cron-задача активна и ожидает следующего запуска');
});

module.exports = app; 