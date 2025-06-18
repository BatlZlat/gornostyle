const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

// Импорт маршрутов
const userRoutes = require('./routes/userRoutes');
const simulatorRoutes = require('./routes/simulatorRoutes');
const bookingRoutes = require('./routes/bookingRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Маршруты API
app.use('/api/users', userRoutes);
app.use('/api/simulators', simulatorRoutes);
app.use('/api/bookings', bookingRoutes);

// Базовый маршрут
app.get('/', (req, res) => {
    res.send('Горнолыжный тренажерный комплекс API');
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Произошла внутренняя ошибка сервера'
    });
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
    // console.log(`Сервер запущен на порту ${PORT}`);
}); 