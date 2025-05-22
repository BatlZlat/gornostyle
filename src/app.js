require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { pool } = require('./db/index');
const { createNextMonthSchedule, CRON_SETTINGS } = require('./scripts/create-next-month-schedule');
const scheduleRouter = require('./routes/schedule');
const simulatorsRouter = require('./routes/simulators');
const groupsRouter = require('./routes/groups');
const trainersRouter = require('./routes/trainers');
const trainingsRouter = require('./routes/trainings');
const pricesRouter = require('./routes/prices');
const clientsRouter = require('./routes/clients');
const smsRouter = require('./routes/sms');
const cron = require('node-cron');
const fs = require('fs');

// Импортируем бота
require('./bot/client-bot');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('Инициализация приложения...');
console.log('Загруженные маршруты:', {
    schedule: !!scheduleRouter,
    simulators: !!simulatorsRouter,
    groups: !!groupsRouter,
    trainers: !!trainersRouter,
    trainings: !!trainingsRouter
});

// Настройка middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Маршруты API
console.log('Регистрация маршрутов API...');
app.use('/api/schedule', scheduleRouter);
app.use('/api/simulators', simulatorsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/trainers', trainersRouter);
app.use('/api/trainings', trainingsRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/sms', smsRouter);

// API для управления ссылкой оплаты
app.get('/api/payment-link', (req, res) => {
    const paymentLink = process.env.PAYMENT_LINK || '';
    res.json({ link: paymentLink });
});

app.put('/api/payment-link', (req, res) => {
    const { link } = req.body;
    if (!link) {
        return res.status(400).json({ error: 'Ссылка не может быть пустой' });
    }

    // Читаем текущий .env файл
    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    // Обновляем или добавляем PAYMENT_LINK
    if (envContent.includes('PAYMENT_LINK=')) {
        envContent = envContent.replace(/PAYMENT_LINK=.*/, `PAYMENT_LINK=${link}`);
    } else {
        envContent += `\nPAYMENT_LINK=${link}`;
    }

    // Записываем обновленный контент
    fs.writeFileSync(envPath, envContent);

    // Обновляем переменную окружения
    process.env.PAYMENT_LINK = link;

    res.json({ success: true });
});

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nСервер запущен на порту ${PORT}`);
    console.log('Cron-задача активна и ожидает следующего запуска');
});

module.exports = app; 