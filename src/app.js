const express = require('express');
const path = require('path');
const scheduleRouter = require('./routes/schedule');
const simulatorsRouter = require('./routes/simulators');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Маршруты
app.use(scheduleRouter);
app.use(simulatorsRouter);

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