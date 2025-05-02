const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { createNextMonthSchedule, CRON_SETTINGS } = require('./scripts/create-next-month-schedule');
const scheduleRouter = require('./routes/schedule');
const simulatorsRouter = require('./routes/simulators');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Маршруты
app.use('/api/schedule', scheduleRouter);
app.use('/api/simulators', simulatorsRouter);

// Настройка cron-задачи для создания расписания на следующий месяц
cron.schedule(`${CRON_SETTINGS.minute} ${CRON_SETTINGS.hour} ${CRON_SETTINGS.day} * *`, async () => {
    console.log('Запуск создания расписания на следующий месяц...');
    try {
        await createNextMonthSchedule();
        console.log('Расписание на следующий месяц успешно создано');
    } catch (error) {
        console.error('Ошибка при создании расписания на следующий месяц:', error);
    }
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        error: 'Внутренняя ошибка сервера' 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
}); 