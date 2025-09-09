require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { pool } = require('./db/index');
const { createNextMonthSchedule, CRON_SETTINGS } = require('./scripts/create-next-month-schedule');
const { getTomorrowTrainings } = require('./scripts/get-tomorrow-trainings');
const { notifyTomorrowTrainings } = require('./bot/admin-notify');
const scheduleRouter = require('./routes/schedule');
const simulatorsRouter = require('./routes/simulators');
const groupsRouter = require('./routes/groups');
const trainersRouter = require('./routes/trainers');
const trainingsRouter = require('./routes/trainings');
const pricesRouter = require('./routes/prices');
const clientsRouter = require('./routes/clients');
const smsRouter = require('./routes/sms');
const childrenRouter = require('./routes/children');
const financesRouter = require('./routes/finances');
const applicationsRouter = require('./routes/applications');
const adminAuthRouter = require('./routes/adminAuth');
const { verifyToken, verifyAuth } = require('./middleware/auth');
const cron = require('node-cron');
const fs = require('fs');

// Импортируем бота
require('./bot/client-bot');

const app = express();
const PORT = process.env.PORT;

// Настройка EJS (только для главной страницы)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Настройка middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware для проверки аутентификации
app.use(verifyAuth);

// Главная страница с EJS (только для корня)
app.get('/', (req, res) => {
    res.render('index', {
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        botUsername: process.env.BOT_USERNAME,
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
        pageTitle: 'Горностайл72 - Горнолыжный тренажёр в Тюмени'
    });
});

// Страница цен
app.get('/prices', (req, res) => {
    res.render('prices', {
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        botUsername: process.env.BOT_USERNAME,
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
        pageTitle: 'Цены на тренировки - Горностайл72'
    });
});

// Страница графика работы
app.get('/schedule', (req, res) => {
    res.render('schedule', {
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        botUsername: process.env.BOT_USERNAME,
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
        pageTitle: 'График работы - Горностайл72'
    });
});

// Страница правил записи
app.get('/rules', (req, res) => {
    res.render('rules', {
        adminPhone: process.env.ADMIN_PHONE,
        contactEmail: process.env.CONTACT_EMAIL,
        adminTelegramUsername: process.env.ADMIN_TELEGRAM_USERNAME,
        botUsername: process.env.BOT_USERNAME,
        telegramGroup: process.env.TELEGRAM_GROUP,
        vkGroup: process.env.VK_GROUP,
        yandexMetrikaId: process.env.YANDEX_METRIKA_ID,
        googleAnalyticsId: process.env.GOOGLE_ANALYTICS_ID,
        pageTitle: 'Правила записи - Горностайл72'
    });
});

// Статические файлы
app.use(express.static(path.join(__dirname, '../public')));

// Маршруты аутентификации
app.use('/api/admin', adminAuthRouter);

// Защищенные маршруты
app.use('/api/groups', verifyToken, groupsRouter);
app.use('/api/trainers', verifyToken, trainersRouter);
app.use('/api/trainings', verifyToken, trainingsRouter);
app.use('/api/schedule', verifyToken, scheduleRouter);
app.use('/api/simulators', verifyToken, simulatorsRouter);
app.use('/api/prices', verifyToken, pricesRouter);
app.use('/api/clients', verifyToken, clientsRouter);
app.use('/api/finances', verifyToken, financesRouter);
app.use('/api/sms', verifyToken, smsRouter);
app.use('/api/children', verifyToken, childrenRouter);
app.use('/api/applications', verifyToken, applicationsRouter);

// Публичный API для получения активных тренеров (для главной страницы)
app.get('/api/public/trainers', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                full_name, 
                sport_type, 
                description, 
                photo_url,
                birth_date,
                EXTRACT(YEAR FROM AGE(birth_date)) as age
            FROM trainers 
            WHERE is_active = true 
            ORDER BY full_name
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении тренеров для главной страницы:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

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
// console.log('\n=== Настройка cron-задачи ===');
// console.log('Текущие настройки:', CRON_SETTINGS);
// console.log('Cron-выражение:', cronExpression);
// console.log('Текущее время:', new Date().toLocaleString('ru-RU'));

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

// console.log('Следующий запуск запланирован на:', getNextRunTime().toLocaleString('ru-RU'));

// Запускаем задачу по расписанию
const task = cron.schedule(cronExpression, async () => {
    // console.log('\n=== Запуск создания расписания на следующий месяц ===');
    // console.log('Время запуска:', new Date().toLocaleString('ru-RU'));
    try {
        await createNextMonthSchedule();
        // console.log('Расписание успешно создано');
        // console.log('Следующий запуск запланирован на:', getNextRunTime().toLocaleString('ru-RU'));
    } catch (error) {
        // console.error('Ошибка при создании расписания:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Yekaterinburg" // Указываем часовой пояс
});

// Настройка cron-задачи для уведомлений о тренировках на завтра (каждый день в 22:00)
const tomorrowTrainingsCron = cron.schedule('0 22 * * *', async () => {
    console.log('\n=== Запуск проверки тренировок на завтра ===');
    console.log('Время запуска:', new Date().toLocaleString('ru-RU'));
    try {
        const trainings = await getTomorrowTrainings();
        await notifyTomorrowTrainings(trainings);
        console.log('Проверка тренировок на завтра завершена');
    } catch (error) {
        console.error('Ошибка при проверке тренировок на завтра:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Yekaterinburg" // Указываем часовой пояс
});

// Обработка ошибок
app.use((err, req, res, next) => {
    // console.error('Ошибка сервера:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Внутренняя ошибка сервера',
        details: err.message 
    });
});

// Обработка 404 ошибок
app.use((req, res) => {
    // console.log('404 - Маршрут не найден:', req.method, req.url);
    res.status(404).json({ 
        success: false, 
        error: 'Маршрут не найден',
        path: req.url,
        method: req.method
    });
});

app.listen(PORT, '0.0.0.0', () => {
    // console.log(`\nСервер запущен на порту ${PORT}`);
    // console.log('Cron-задача активна и ожидает следующего запуска');
});

module.exports = app; 